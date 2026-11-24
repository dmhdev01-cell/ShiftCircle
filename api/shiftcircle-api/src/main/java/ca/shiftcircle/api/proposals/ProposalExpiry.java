package ca.shiftcircle.api.proposals;

import ca.shiftcircle.api.time.BusinessClock;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * A waiting proposal item expires at its shift start, by the business clock (plan §1.2).
 *
 * <p>{@link #apply()} is called inside every read and decision of a proposal, so nobody sees or
 * decides a shift that has already started, and by an hourly sweep so the audit trail and the
 * counts do not wait for someone to look. The update is one statement, so it is safe to run twice:
 * an item is expired once, audited once, with no actor (the system).
 */
@Service
public class ProposalExpiry {

  private static final Logger log = LoggerFactory.getLogger(ProposalExpiry.class);

  private final JdbcTemplate jdbc;
  private final BusinessClock clock;
  private final ObjectMapper mapper = new ObjectMapper();

  public ProposalExpiry(JdbcTemplate jdbc, BusinessClock clock) {
    this.jdbc = jdbc;
    this.clock = clock;
  }

  /** Expire every waiting item whose shift has started (the sweep). Returns how many. */
  @Transactional
  public int apply() {
    return expire(null);
  }

  /**
   * Expire only this officer's waiting items. Request paths use it: they are about to read or
   * change this officer's proposals, and a global write on every read would make officers wait on
   * each other's rows at a shift boundary.
   */
  @Transactional
  public int apply(UUID employeeId) {
    return expire(employeeId);
  }

  private int expire(UUID employeeId) {
    Timestamp now = Timestamp.from(clock.now());
    // Rows are taken in id order and a busy row is skipped, so two overlapping runs never wait on
    // or deadlock with each other; the run that holds a row expires it.
    List<Map<String, Object>> expired =
        jdbc.queryForList(
            "UPDATE proposal_item SET decision = 'EXPIRED', decided_at = ?"
                + " WHERE id IN (SELECT id FROM proposal_item WHERE decision = 'PENDING'"
                + " AND start_at <= ?"
                + (employeeId == null ? "" : " AND employee_id = ?")
                + " ORDER BY id FOR UPDATE SKIP LOCKED)"
                + " RETURNING id, proposal_id, employee_id, start_at",
            employeeId == null
                ? new Object[] {now, now}
                : new Object[] {now, now, employeeId});
    Set<UUID> proposals = new TreeSet<>();
    for (Map<String, Object> row : expired) {
      UUID proposalId = (UUID) row.get("proposal_id");
      proposals.add(proposalId);
      Map<String, Object> after = new LinkedHashMap<>();
      after.put("itemId", row.get("id").toString());
      after.put("employeeId", row.get("employee_id").toString());
      after.put("startAt", ((Timestamp) row.get("start_at")).toInstant().toString());
      after.put("decision", "EXPIRED");
      audit(null, "expire_proposal_item", "proposal", proposalId, after);
    }
    for (UUID proposalId : proposals) {
      jdbc.update(
          "UPDATE proposal SET version = version + 1, status ="
              + " CASE WHEN EXISTS (SELECT 1 FROM proposal_item WHERE proposal_id = proposal.id"
              + "                   AND decision = 'PENDING') THEN 'WAITING'"
              + "      WHEN EXISTS (SELECT 1 FROM proposal_item WHERE proposal_id = proposal.id"
              + "                   AND decision IN ('ACCEPTED', 'DECLINED')) THEN 'DECIDED'"
              + "      ELSE 'EXPIRED' END"
              + " WHERE id = ? AND status = 'WAITING'",
          proposalId);
    }
    return expired.size();
  }

  /** The hourly sweep. A failure is logged and the next hour tries again. */
  @Scheduled(initialDelay = 3_600_000L, fixedDelay = 3_600_000L)
  void sweep() {
    try {
      int count = apply();
      if (count > 0) {
        log.info("Proposal expiry sweep: {} waiting item(s) expired", count);
      }
    } catch (RuntimeException failure) {
      // The demo reset rebuilds the schema; a sweep that lands in the middle just tries again.
      log.warn("Proposal expiry sweep skipped: {}", failure.getMessage());
    }
  }

  private void audit(
      String actor, String action, String entityType, UUID entityId, Map<String, Object> after) {
    jdbc.update(
        "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, after)"
            + " VALUES ((SELECT id FROM app_user WHERE username = ?), ?, ?, ?, ?::jsonb)",
        actor,
        action,
        entityType,
        entityId,
        mapper.writeValueAsString(after));
  }
}
