package ca.shiftcircle.api.problems;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.ResponseEntity;

/**
 * The overlap constraint is the last line of defence behind the officer lock; if it fires, the
 * caller must see a 409 conflict, never a 500 or a driver message (review-r2 S3).
 */
class ApiProblemAdviceTest {

  private final ApiProblemAdvice advice = new ApiProblemAdvice();

  @Test
  void anOverlapConstraintBecomesA409Problem() {
    ResponseEntity<Map<String, Object>> response =
        advice.onConflict(new DataIntegrityViolationException("no_overlapping_shifts"));

    assertThat(response.getStatusCode().value()).isEqualTo(409);
    assertThat(response.getHeaders().getContentType().toString())
        .contains("application/problem+json");
    assertThat(response.getBody().get("type")).isEqualTo("https://shiftcircle.local/problems/409");
    assertThat(response.getBody().get("status")).isEqualTo(409);
    assertThat(response.getBody().toString()).doesNotContain("no_overlapping_shifts");
  }

  @Test
  void aMissingRowBecomesA404Problem() {
    ResponseEntity<Map<String, Object>> response =
        advice.onMissing(new EmptyResultDataAccessException(1));

    assertThat(response.getStatusCode().value()).isEqualTo(404);
    assertThat(response.getBody().get("title")).isEqualTo("Not found");
  }
}
