package ca.shiftcircle.rules.model;

import ca.shiftcircle.rules.facts.RuleOutcome;
import java.util.Map;

/**
 * One row of a decision table: the non-technical admin's unit of change.
 *
 * @param code rule code from the mock agreement, e.g. {@code U-01}
 * @param table which decision table the row belongs to
 * @param enabled a disabled row produces no rule
 * @param params the table's own columns (see {@code column_schema} in the database)
 * @param severity outcome when the row fires
 * @param overridePolicy what a supervisor may do about it
 * @param message plain-language message shown to the user
 * @param source where the rule comes from (SEA, PSGE, MOCK, ...)
 * @param placeholder true when the value is invented for the prototype and needs validation
 * @param sortOrder display order inside the table
 */
public record RuleRow(
    String code,
    RuleTableCode table,
    boolean enabled,
    Map<String, Object> params,
    RuleOutcome severity,
    OverridePolicy overridePolicy,
    String message,
    String source,
    boolean placeholder,
    int sortOrder) {

  public RuleRow {
    // A row read back from PostgreSQL can carry no params at all (SQL NULL, a bad restore). Treat
    // it as empty and let the validator report a plain violation; never throw from the model.
    params =
        java.util.Collections.unmodifiableMap(
            params == null ? new java.util.LinkedHashMap<>() : new java.util.LinkedHashMap<>(params));
  }

  public double number(String key) {
    Object value = params.get(key);
    if (value == null) {
      throw new IllegalArgumentException(code + ": missing numeric column " + key);
    }
    return ((Number) value).doubleValue();
  }

  public String text(String key) {
    Object value = params.get(key);
    if (value == null) {
      throw new IllegalArgumentException(code + ": missing column " + key);
    }
    return value.toString();
  }
}
