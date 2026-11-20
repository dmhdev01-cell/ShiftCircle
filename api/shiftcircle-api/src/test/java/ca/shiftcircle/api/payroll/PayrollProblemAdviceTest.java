package ca.shiftcircle.api.payroll;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.SQLException;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;

/** The problem mapping for a bad actual (review-r2 P3). */
class PayrollProblemAdviceTest {

  private final PayrollProblemAdvice advice = new PayrollProblemAdvice();

  @Test
  void aNumericOverflowIsABadRequestNotAServerError() {
    ResponseEntity<Map<String, Object>> response =
        advice.invalidHours(
            new DataIntegrityViolationException(
                "numeric field overflow", new SQLException("numeric field overflow", "22003")));

    assertThat(response.getStatusCode().value()).isEqualTo(400);
    assertThat(response.getBody())
        .containsEntry("type", "https://shiftcircle.local/problems/invalid-hours");
    assertThat(response.getHeaders().getContentType().toString())
        .contains("application/problem+json");
  }
}
