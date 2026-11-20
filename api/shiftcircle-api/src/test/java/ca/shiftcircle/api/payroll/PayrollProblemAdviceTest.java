package ca.shiftcircle.api.payroll;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * The problem mapping for a bad actual (review-r2 P3).
 *
 * <p>The database constraint failures are not here: one advice maps them all
 * ({@code ca.shiftcircle.api.problems.ApiProblemAdvice}), because two advices claiming the same
 * exception, with one of them rethrowing, answered a raw 500 instead of a problem document
 * (dev-qa, 2026-11-20).
 */
class PayrollProblemAdviceTest {

  private final PayrollProblemAdvice advice = new PayrollProblemAdvice();

  @Test
  void aLockedPeriodIsAConflict() {
    ResponseEntity<Map<String, Object>> response = advice.locked();

    assertThat(response.getStatusCode().value()).isEqualTo(409);
    assertThat(response.getBody())
        .containsEntry("type", "https://shiftcircle.local/problems/pay-period-locked");
    assertThat(response.getHeaders().getContentType().toString())
        .contains("application/problem+json");
  }
}
