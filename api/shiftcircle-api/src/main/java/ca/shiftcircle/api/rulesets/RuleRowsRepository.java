package ca.shiftcircle.api.rulesets;

import ca.shiftcircle.rules.model.OverridePolicy;
import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.model.RuleSet;
import ca.shiftcircle.rules.model.RuleTableCode;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

/**
 * Reads rule rows from PostgreSQL, the runtime source once a version is published.
 *
 * <p>Used by the boot-time rule holder and by the admin screens, so both see exactly the rows the
 * compiler sees. Values in {@code params} are stored as jsonb and parsed here.
 */
@Repository
public class RuleRowsRepository {

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper = new ObjectMapper();

  public RuleRowsRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  /** The published rows, or the v1 fixture when the database has no published version yet. */
  public RuleSet publishedRuleSet() {
    try {
      List<Map<String, Object>> published =
          jdbc.queryForList(
              "SELECT id, version FROM rule_set_version WHERE status = 'PUBLISHED'"
                  + " ORDER BY effective_from DESC LIMIT 1");
      if (published.isEmpty()) {
        return RuleRowsV1.ruleSet();
      }
      return new RuleSet(
          "v" + published.get(0).get("version"),
          rows((UUID) published.get(0).get("id"), null));
    } catch (RuntimeException e) {
      // A first boot before migrations should still start; readiness then reports the problem.
      return RuleRowsV1.ruleSet();
    }
  }

  public List<RuleRow> rows(UUID versionId, RuleTableCode only) {
    String sql =
        "SELECT r.code, t.code AS table_code, r.enabled, r.params::text AS params, r.severity,"
            + " r.override_policy, r.message, r.source, r.is_placeholder, r.sort_order"
            + " FROM rule_row r JOIN rule_table t ON t.id = r.rule_table_id"
            + " WHERE r.rule_set_version_id = ?"
            + (only == null ? "" : " AND t.code = ?")
            + " ORDER BY t.code, r.sort_order, r.code";
    Object[] args =
        only == null ? new Object[] {versionId} : new Object[] {versionId, only.code()};
    return jdbc.query(
        sql,
        (rs, rowNum) ->
            new RuleRow(
                rs.getString("code"),
                RuleTableCode.fromCode(rs.getString("table_code")),
                rs.getBoolean("enabled"),
                readMap(rs.getString("params")),
                RuleOutcome.valueOf(rs.getString("severity")),
                OverridePolicy.valueOf(rs.getString("override_policy")),
                rs.getString("message"),
                rs.getString("source"),
                rs.getBoolean("is_placeholder"),
                rs.getInt("sort_order")),
        args);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> readMap(String json) {
    if (json == null || json.isBlank()) {
      return Map.of();
    }
    return mapper.readValue(json, Map.class);
  }
}
