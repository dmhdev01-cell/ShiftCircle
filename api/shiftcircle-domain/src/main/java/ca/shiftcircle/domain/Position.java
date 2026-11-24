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

  /** The rank order, lowest first. Seniority inside a rank is compared with it. */
  public int rankOrder() {
    return rankOrder;
  }

  /** True for the supervisory ranks: a supervisor post wants one of these. */
  public boolean isSupervisory() {
    return supervisory;
  }

  /**
   * The position with this code.
   *
   * @throws IllegalArgumentException for a code that is not a position; the database's foreign key
   *     makes that impossible, so an unknown code is a bug, not a case to carry through the app
   */
  public static Position fromCode(String code) {
    for (Position position : values()) {
      if (position.code.equals(code)) {
        return position;
      }
    }
    throw new IllegalArgumentException("Unknown position: " + code);
  }
}
