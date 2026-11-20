package ca.shiftcircle.rules.tables;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The "Rest between shifts" decision table (docs/04-rules-engine.md §4-5).
 *
 * <p>Each map is one row a non-technical rules admin can edit; the technical template is hidden.
 * Values here mirror the v1 defaults in docs/05-union-rules.md and will move to PostgreSQL when the
 * rules tables land.
 */
public final class RestBetweenShiftsRows {

  public static final String TEMPLATE = "/rule-templates/rest-between-shifts.drt";

  private RestBetweenShiftsRows() {}

  /** v1 defaults, currently only U-01 (the spike proves one row end to end). */
  public static List<Map<String, Object>> v1Defaults() {
    return List.of(u01());
  }

  public static Map<String, Object> u01() {
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("ruleId", "U-01");
    // Regex: ".*" is the "any shift kind" wildcard the grid shows as "Any shift".
    row.put("afterShiftKind", ".*");
    row.put("windowHours", 24);
    row.put("minRestHours", 8);
    row.put("outcome", "BLOCK");
    row.put("overridePolicy", "EMERGENCY");
    row.put(
        "message", "Less than 8 hours rest in 24 hours (Employment Act minimum).");
    return row;
  }
}
