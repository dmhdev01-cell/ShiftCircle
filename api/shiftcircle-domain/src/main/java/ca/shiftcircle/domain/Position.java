package ca.shiftcircle.domain;

/**
 * The position (rank) a person holds: the mirror of the {@code position} reference table
 * (docs/06-data-model.md §3.1).
 *
 * <p>The employee's {@code classification} column keeps its name and now points at a row of that
 * table, so a new rank is a row and not a schema change. Two ranks exist today: a correctional
 * officer ({@code CO}) and a correctional supervisor ({@code CS}).
 *
 * <p>The rank's name is not in this enum: it is editable text in the database, and the API reads it
 * from there. What is here is the code, the rank order and the flag the rules need.
 *
 * <p>The table is the source of truth and can hold a rank this build has no constant for (a
 * Lieutenant added by a later release). A lookup for an unknown code therefore finds nothing
 * instead of throwing, and {@link #fromCodeOrDefault(String)} is what the planner uses: a rank the
 * api cannot name is treated as the lowest, non-supervisory one, so it can never make the planner
 * treat someone as a supervisor by accident.
 *
 * <p>No framework dependencies: this module must stay usable from the rules module and from plain
 * unit tests.
 */
public enum Position {
  CO("CO", 1, false),
  CS("CS", 2, true);

  private final String code;
  private final int rankOrder;
  private final boolean supervisory;

  Position(String code, int rankOrder, boolean supervisory) {
    this.code = code;
    this.rankOrder = rankOrder;
    this.supervisory = supervisory;
  }

  /** The code stored in {@code employee.classification}. */
  public String code() {
    return code;
  }

  /** Orders the ranks, lowest first. */
  public int rankOrder() {
    return rankOrder;
  }

  /** True for the supervisory ranks: a supervisor post wants one of these. */
  public boolean isSupervisory() {
    return supervisory;
  }

  /**
   * The position with this code, or {@code null} when this build does not know the code.
   *
   * <p>The rank table is the source of truth, so a code it holds that this build has no constant
   * for is a normal thing to meet, not an error. Use {@link #fromCodeOrDefault(String)} where a
   * rank is needed.
   */
  public static Position fromCode(String code) {
    for (Position position : values()) {
      if (position.code.equals(code)) {
        return position;
      }
    }
    return null;
  }

  /**
   * The position for a code from the database. A code this build does not know falls back to
   * {@link #CO}, the lowest and non-supervisory rank, so an unknown rank never makes the planner
   * treat someone as a supervisor. The rank's name is read from the database, so nothing shows a
   * wrong name either.
   */
  public static Position fromCodeOrDefault(String code) {
    Position position = fromCode(code);
    return position == null ? CO : position;
  }
}
