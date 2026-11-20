package ca.shiftcircle.api.rules;

import java.util.List;

/**
 * A rule refused a change (docs/07 §3). The advice turns this into a problem+json body carrying
 * {@code ruleResults}, never a generic 500.
 */
public class RuleViolationException extends RuntimeException {

  public enum Kind {
    BLOCKED("blocked-by-rules"),
    WARNINGS("warnings-need-acknowledgement");

    private final String slug;

    Kind(String slug) {
      this.slug = slug;
    }

    public String slug() {
      return slug;
    }
  }

  private final Kind kind;
  private final RuleCheckService.OutcomeView outcome;

  public RuleViolationException(Kind kind, RuleCheckService.OutcomeView outcome) {
    super(kind.slug());
    this.kind = kind;
    this.outcome = outcome;
  }

  public Kind kind() {
    return kind;
  }

  public RuleCheckService.OutcomeView outcome() {
    return outcome;
  }

  public List<RuleCheckService.ResultView> results() {
    return outcome.ruleResults();
  }
}
