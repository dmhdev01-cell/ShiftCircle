package ca.shiftcircle.api.demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S6 / PR #7 security LOW-1: the public {@code /version} reads {@code activeDataset()}, so it must
 * not query the database on every call and must never fail when the database cannot answer.
 */
class DemoActiveDatasetTest {

  private static DemoResetService service(JdbcTemplate jdbc) {
    return new DemoResetService(null, jdbc, List.of(), null, null, new DemoOperationLock());
  }

  @Test
  void readsTheLastResetOnceThenAnswersFromMemory() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("120"));
    DemoResetService reset = service(jdbc);

    assertThat(reset.activeDataset()).isEqualTo("120");
    assertThat(reset.activeDataset()).isEqualTo("120");
    verify(jdbc, times(1)).queryForList(anyString(), eq(String.class));
  }

  @Test
  void noResetRowMeansTheSeededDataset100() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of());

    assertThat(service(jdbc).activeDataset()).isEqualTo("100");
  }

  @Test
  void aDatabaseErrorFallsBackTo100AndIsNotCached() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForList(anyString(), eq(String.class)))
        .thenThrow(new DataAccessResourceFailureException("db down"))
        .thenReturn(List.of("150"));
    DemoResetService reset = service(jdbc);

    assertThat(reset.activeDataset()).as("never a 500 on /version").isEqualTo("100");
    assertThat(reset.activeDataset()).as("the next call reads again").isEqualTo("150");
  }
}
