package ca.shiftcircle.api.csv;

/**
 * One CSV cell for the downloadable reports and the payroll export.
 *
 * <p>RFC 4180 quoting only where the value needs it, and a leading {@code =}, {@code +}, {@code -},
 * {@code @}, TAB or CR is neutralised with a single quote so a spreadsheet cannot evaluate a
 * hostile employee number, name or note as a formula (review-r2 P2). One helper, so the payroll
 * and report exports can never drift apart.
 */
public final class Csv {

  private Csv() {}

  public static String cell(String value) {
    String clean = value == null ? "" : value;
    if (!clean.isEmpty() && "=+-@\t\r".indexOf(clean.charAt(0)) >= 0) {
      clean = "'" + clean;
    }
    if (clean.indexOf(',') < 0
        && clean.indexOf('"') < 0
        && clean.indexOf('\t') < 0
        && clean.indexOf('\n') < 0
        && clean.indexOf('\r') < 0) {
      return clean;
    }
    return '"' + clean.replace("\"", "\"\"") + '"';
  }
}
