package ca.shiftcircle.rules.model;

/**
 * The nine decision tables (docs/04-rules-engine.md §5). Each one has a Drools template the rules
 * admin never edits, and rows the admin does edit.
 */
public enum RuleTableCode {
  REST("REST", "rest-between-shifts.drt"),
  MAX_HOURS("MAX_HOURS", "max-hours-in-window.drt"),
  CONSECUTIVE("CONSECUTIVE", "max-consecutive.drt"),
  LONG_SHIFTS("LONG_SHIFTS", "long-shifts-in-window.drt"),
  DAYS_OFF("DAYS_OFF", "min-consecutive-days-off.drt"),
  PAY("PAY", "pay-classification.drt"),
  OT_RANKING("OT_RANKING", "overtime-ranking.drt"),
  SHIFT_LENGTHS("SHIFT_LENGTHS", "shift-lengths.drt"),
  /** Who can work a post (release v1.3, R-01/R-02): a position against the post's kind. */
  POSTS("POSTS", "post-eligibility.drt");

  private final String code;
  private final String templateFile;

  RuleTableCode(String code, String templateFile) {
    this.code = code;
    this.templateFile = templateFile;
  }

  public String code() {
    return code;
  }

  /** DRT resource on the classpath. */
  public String templateResource() {
    return "/rule-templates/" + templateFile;
  }

  public static RuleTableCode fromCode(String code) {
    for (RuleTableCode table : values()) {
      if (table.code.equals(code)) {
        return table;
      }
    }
    throw new IllegalArgumentException("Unknown rule table: " + code);
  }
}
