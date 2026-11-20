package ca.shiftcircle.rules.rank;

import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.model.RuleSet;
import ca.shiftcircle.rules.model.RuleTableCode;
import java.util.ArrayList;
import java.util.List;

/**
 * The overtime-ranking policy a rule set defines (rows O-01 to O-03, docs/05 §2F).
 *
 * <p>The order comes from the {@code orderBy} column, ties are broken in that same order, and the
 * remaining flags say what happens to an officer a Block rule would stop. The defaults are the
 * published v1 policy, so a rule set that disables every O row still ranks fairly.
 *
 * @param orderBy sort keys, most significant first
 * @param skipIfBlocked true when a Block result means "skipped"; the ranker always enforces this,
 *     because an offer must never be made for a shift the rules would block
 * @param keepPlace true when a skipped officer keeps their fairness position instead of dropping to
 *     the end (O-03: skipped, not penalised)
 */
public record RankingPolicy(List<SortKey> orderBy, boolean skipIfBlocked, boolean keepPlace) {

  /** The sort keys the fact builders can actually produce (docs/04 §5a). */
  public enum SortKey {
    /** Fewest overtime hours this quarter first (ADR-016). */
    OT_HOURS_QUARTER_ASC,
    /** Earliest seniority date first. */
    SENIORITY_ASC
  }

  public RankingPolicy {
    orderBy = orderBy == null || orderBy.isEmpty() ? defaults() : List.copyOf(orderBy);
  }

  public static List<SortKey> defaults() {
    return List.of(SortKey.OT_HOURS_QUARTER_ASC, SortKey.SENIORITY_ASC);
  }

  /** The published v1 policy. */
  public static RankingPolicy v1() {
    return new RankingPolicy(defaults(), true, true);
  }

  /**
   * Reads the policy from the enabled OT_RANKING rows.
   *
   * <p>Rows are merged so a table split across O-01..O-03 behaves as one policy. Unknown sort keys
   * are ignored rather than guessed at; the publish pipeline rejects them at build time (step 11).
   */
  public static RankingPolicy from(RuleSet ruleSet) {
    List<SortKey> order = new ArrayList<>();
    boolean sawOrder = false;
    Boolean skip = null;
    Boolean keep = null;

    for (RuleRow row : ruleSet.enabledRows()) {
      if (row.table() != RuleTableCode.OT_RANKING) {
        continue;
      }
      Object rawOrder = row.params().get("orderBy");
      if (!sawOrder && rawOrder instanceof List<?> values && !values.isEmpty()) {
        for (Object value : values) {
          SortKey key = sortKey(String.valueOf(value));
          if (key != null) {
            order.add(key);
          }
        }
        sawOrder = true;
      }
      skip = merge(skip, row.params().get("skipIfBlocked"));
      keep = merge(keep, row.params().get("keepPlace"));
    }

    return new RankingPolicy(order, skip == null || skip, keep == null || keep);
  }

  private static Boolean merge(Boolean current, Object value) {
    if (!(value instanceof Boolean flag)) {
      return current;
    }
    return current == null ? flag : current || flag;
  }

  private static SortKey sortKey(String value) {
    try {
      return SortKey.valueOf(value);
    } catch (IllegalArgumentException unknown) {
      return null;
    }
  }
}
