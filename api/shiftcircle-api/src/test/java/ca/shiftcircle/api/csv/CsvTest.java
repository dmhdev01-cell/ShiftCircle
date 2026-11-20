package ca.shiftcircle.api.csv;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** The one CSV cell helper (review-r2 P2, M2). */
class CsvTest {

  @Test
  void plainValuesAreNotQuoted() {
    assertThat(Csv.cell("E-001")).isEqualTo("E-001");
    assertThat(Csv.cell("")).isEmpty();
    assertThat(Csv.cell(null)).isEmpty();
  }

  @Test
  void commasQuotesAndLineBreaksAreQuoted() {
    assertThat(Csv.cell("E,1")).isEqualTo("\"E,1\"");
    assertThat(Csv.cell("E\"2")).isEqualTo("\"E\"\"2\"");
    assertThat(Csv.cell("a\nb")).isEqualTo("\"a\nb\"");
  }

  @Test
  void spreadsheetFormulasAreNeutralised() {
    assertThat(Csv.cell("=2+5*10")).isEqualTo("'=2+5*10");
    assertThat(Csv.cell("+1")).isEqualTo("'+1");
    assertThat(Csv.cell("-1")).isEqualTo("'-1");
    assertThat(Csv.cell("@cmd")).isEqualTo("'@cmd");
    assertThat(Csv.cell("\t=2+5*10")).isEqualTo("\"'\t=2+5*10\"");
    assertThat(Csv.cell("\r=1")).isEqualTo("\"'\r=1\"");
    assertThat(Csv.cell("\n=1")).as("a leading line feed is neutralised too").isEqualTo("\"'\n=1\"");
  }
}
