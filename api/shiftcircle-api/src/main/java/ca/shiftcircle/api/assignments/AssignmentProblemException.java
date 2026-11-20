package ca.shiftcircle.api.assignments;

/** A move or cancel that cannot proceed because of the shift's state (docs/07 §4.2). */
public class AssignmentProblemException extends RuntimeException {

  public enum Kind {
    IF_MATCH_REQUIRED(
        428,
        "if-match-required",
        "If-Match is required",
        "Send the version you read, as If-Match: \"3\"."),
    STALE_VERSION(
        412,
        "stale-version",
        "This shift changed since you read it",
        "Reload the board and try again."),
    SHIFT_STARTED(
        409,
        "shift-started",
        "This shift has started",
        "Past shifts are corrected in Time & attendance, not on the schedule."),
    ALREADY_CANCELLED(409, "already-cancelled", "This shift is already cancelled", "Reload the board."),
    FILLS_OPEN_SHIFT(
        409,
        "fills-open-shift",
        "This shift fills an open shift",
        "Cancel it and assign the open shift again instead of moving it."),
    ACTUAL_RECORDED(
        409,
        "actual-recorded",
        "This shift has actual time recorded",
        "Correct the actual in Time & attendance instead of cancelling the shift."),
    ABSENCE_RECORDED(
        409,
        "absence-recorded",
        "This shift has an absence recorded",
        "Correct the absence in Time & attendance instead of cancelling the shift.");

    private final int status;
    private final String slug;
    private final String title;
    private final String detail;

    Kind(int status, String slug, String title, String detail) {
      this.status = status;
      this.slug = slug;
      this.title = title;
      this.detail = detail;
    }

    public int status() {
      return status;
    }

    public String slug() {
      return slug;
    }

    public String title() {
      return title;
    }

    public String detail() {
      return detail;
    }
  }

  private final Kind kind;
  private final String detail;

  public AssignmentProblemException(Kind kind) {
    this(kind, kind.detail());
  }

  public AssignmentProblemException(Kind kind, String detail) {
    super(kind.title());
    this.kind = kind;
    this.detail = detail;
  }

  public Kind kind() {
    return kind;
  }

  public String detail() {
    return detail;
  }
}
