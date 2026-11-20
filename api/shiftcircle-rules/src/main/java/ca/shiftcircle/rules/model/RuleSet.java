package ca.shiftcircle.rules.model;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * One published rule-set version: the rows the engine compiles.
 *
 * @param version published version label, e.g. {@code v1}
 * @param rows every enabled and disabled row; the compiler skips disabled rows
 */
public record RuleSet(String version, List<RuleRow> rows) {

  public RuleSet {
    rows = List.copyOf(rows);
  }

  public List<RuleRow> enabledRows() {
    return rows.stream().filter(RuleRow::enabled).toList();
  }

  public Set<String> ruleCodes() {
    return rows.stream().map(RuleRow::code).collect(Collectors.toUnmodifiableSet());
  }
}
