package ca.shiftcircle.api.schedule;

import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Publishing a roster week (docs/07 §4.2): a supervisor publishes their unit's period once, and the
 * board's published state reflects it. Publishing is one-way in the prototype; corrections are
 * further assignments, which the board shows as unpublished changes.
 */
@Service
public class SchedulePeriodService {

  public record PublishedPeriod(UUID id, String status, String publishedAt) {}

  private final JdbcTemplate jdbc;
  private final ScopeGuard scopeGuard;

  public SchedulePeriodService(JdbcTemplate jdbc, ScopeGuard scopeGuard) {
    this.jdbc = jdbc;
    this.scopeGuard = scopeGuard;
  }

  @Transactional
  public PublishedPeriod publish(UUID periodId, AuthPrincipal principal) {
    Map<String, Object> period;
    try {
      period =
          jdbc.queryForMap(
              "SELECT s.id, s.status, u.code AS unit_code FROM schedule_period s"
                  + " JOIN unit u ON u.id = s.unit_id WHERE s.id = ?",
              periodId);
    } catch (EmptyResultDataAccessException missing) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Schedule period not found");
    }
    scopeGuard.requireUnit(principal, (String) period.get("unit_code"));
    if ("PUBLISHED".equals(period.get("status"))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "This period is already published");
    }

    int published =
        jdbc.update(
            "UPDATE schedule_period SET status = 'PUBLISHED', published_at = now(),"
                + " published_by = (SELECT id FROM app_user WHERE username = ?),"
                + " version = version + 1 WHERE id = ? AND status = 'DRAFT'",
            principal.username(),
            periodId);
    if (published == 0) {
      // Another request published it between the read and the update.
      throw new ResponseStatusException(HttpStatus.CONFLICT, "This period is already published");
    }
    jdbc.update(
        "INSERT INTO audit_event (actor_user_id, action, entity_type, entity_id, after)"
            + " VALUES ((SELECT id FROM app_user WHERE username = ?), 'publish_schedule_period',"
            + " 'schedule_period', ?, '{\"status\":\"PUBLISHED\"}'::jsonb)",
        principal.username(),
        periodId);
    String publishedAt =
        jdbc
            .queryForObject(
                "SELECT published_at FROM schedule_period WHERE id = ?",
                java.sql.Timestamp.class,
                periodId)
            .toInstant()
            .toString();
    return new PublishedPeriod(periodId, "PUBLISHED", publishedAt);
  }
}
