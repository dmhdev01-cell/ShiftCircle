package ca.shiftcircle.api.audit;

import ca.shiftcircle.api.security.AuthPrincipal;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * The audit trail, read only (docs/07 §4.8, docs/09 §2).
 *
 * <p>A supervisor sees the events of their units: an event is visible when the entity it names
 * belongs to a unit in scope. A facility-wide pay period is visible to any supervisor with a scope,
 * because that is who may lock it. Rule changes are not a supervisor's business; an auditor sees
 * everything. The audit table itself refuses UPDATE and DELETE.
 */
@Service
public class AuditQuery {

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final int DEFAULT_LIMIT = 50;
  private static final int MAX_LIMIT = 200;

  public record Actor(String username, String displayName) {}

  public record Event(
      long id,
      String occurredAt,
      Actor actor,
      String action,
      String entityType,
      UUID entityId,
      Object before,
      Object after,
      UUID ruleSetVersionId,
      UUID overrideId,
      String correlationId) {}

  /** One page, newest recorded first. Pass {@code nextBeforeId} back as {@code beforeId}. */
  public record Page(List<Event> items, Long nextBeforeId) {}

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper = new ObjectMapper();

  public AuditQuery(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public Page query(
      AuthPrincipal principal,
      String actor,
      String action,
      String entityType,
      UUID entityId,
      LocalDate from,
      LocalDate to,
      Long beforeId,
      Integer limit) {
    int size = limit == null ? DEFAULT_LIMIT : Math.min(Math.max(limit, 1), MAX_LIMIT);
    StringBuilder sql =
        new StringBuilder(
            "SELECT a.id, a.occurred_at, a.action, a.entity_type, a.entity_id,"
                + " a.before::text AS before_json, a.after::text AS after_json,"
                + " a.rule_set_version_id, a.override_id, a.correlation_id,"
                + " u.username AS actor_username, u.display_name AS actor_display_name"
                + " FROM audit_event a LEFT JOIN app_user u ON u.id = a.actor_user_id"
                + " WHERE 1 = 1");
    List<Object> args = new ArrayList<>();

    if (actor != null && !actor.isBlank()) {
      sql.append(" AND a.actor_user_id = (SELECT id FROM app_user WHERE username = ?)");
      args.add(actor.trim().toLowerCase(Locale.ROOT));
    }
    if (action != null && !action.isBlank()) {
      sql.append(" AND a.action = ?");
      args.add(action.trim());
    }
    if (entityType != null && !entityType.isBlank()) {
      sql.append(" AND a.entity_type = ?");
      args.add(entityType.trim());
    }
    if (entityId != null) {
      sql.append(" AND a.entity_id = ?");
      args.add(entityId);
    }
    if (from != null) {
      sql.append(" AND a.occurred_at >= ?");
      args.add(Timestamp.from(from.atStartOfDay(REGINA).toInstant()));
    }
    if (to != null) {
      sql.append(" AND a.occurred_at < ?");
      args.add(Timestamp.from(to.plusDays(1).atStartOfDay(REGINA).toInstant()));
    }
    if (beforeId != null) {
      sql.append(" AND a.id < ?");
      args.add(beforeId);
    }
    appendScope(sql, args, principal);

    sql.append(" ORDER BY a.id DESC LIMIT ?");
    args.add(size + 1);

    List<Event> rows = jdbc.query(sql.toString(), (rs, row) -> map(rs), args.toArray());
    boolean more = rows.size() > size;
    List<Event> items = more ? new ArrayList<>(rows.subList(0, size)) : rows;
    Long nextBeforeId = more ? items.get(items.size() - 1).id() : null;
    return new Page(items, nextBeforeId);
  }

  private void appendScope(StringBuilder sql, List<Object> args, AuthPrincipal principal) {
    if (principal.hasRole("AUDITOR")) {
      return;
    }
    // A supervisor's scope is a list of unit codes; the unit each audited entity belongs to
    // decides visibility. "-" cannot match a real code, so an empty scope sees no units.
    String units =
        principal.units().isEmpty() ? "-" : String.join(",", principal.units());
    sql.append(
        " AND ("
            + " (a.entity_type = 'shift_assignment' AND EXISTS ("
            + "   SELECT 1 FROM shift_assignment s JOIN unit un ON un.id = s.unit_id"
            + "   WHERE s.id = a.entity_id AND un.code = ANY(string_to_array(?, ','))))"
            + " OR (a.entity_type = 'open_shift' AND EXISTS ("
            + "   SELECT 1 FROM open_shift o JOIN unit un ON un.id = o.unit_id"
            + "   WHERE o.id = a.entity_id AND un.code = ANY(string_to_array(?, ','))))"
            + " OR (a.entity_type = 'time_entry' AND EXISTS ("
            + "   SELECT 1 FROM time_entry te"
            + "   JOIN shift_assignment s ON s.id = te.shift_assignment_id"
            + "   JOIN unit un ON un.id = s.unit_id"
            + "   WHERE te.id = a.entity_id AND un.code = ANY(string_to_array(?, ','))))"
            + " OR (a.entity_type = 'overtime_offer' AND EXISTS ("
            + "   SELECT 1 FROM overtime_offer f JOIN employee e ON e.id = f.employee_id"
            + "   JOIN unit un ON un.id = e.home_unit_id"
            + "   WHERE f.id = a.entity_id AND un.code = ANY(string_to_array(?, ','))))"
            + " OR (a.entity_type = 'pay_period' AND ?)"
            + ")");
    args.add(units);
    args.add(units);
    args.add(units);
    args.add(units);
    args.add(!principal.units().isEmpty());
  }

  private Event map(java.sql.ResultSet rs) throws java.sql.SQLException {
    String username = rs.getString("actor_username");
    return new Event(
        rs.getLong("id"),
        rs.getTimestamp("occurred_at").toInstant().toString(),
        username == null ? null : new Actor(username, rs.getString("actor_display_name")),
        rs.getString("action"),
        rs.getString("entity_type"),
        rs.getObject("entity_id", UUID.class),
        json(rs.getString("before_json")),
        json(rs.getString("after_json")),
        rs.getObject("rule_set_version_id", UUID.class),
        rs.getObject("override_id", UUID.class),
        rs.getString("correlation_id"));
  }

  private Object json(String text) {
    if (text == null) {
      return null;
    }
    try {
      return mapper.readValue(text, Object.class);
    } catch (Exception parseFailure) {
      // jsonb cannot hold invalid JSON; falling back to the text keeps the viewer readable.
      return text;
    }
  }
}
