package ca.shiftcircle.api.problems;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.SQLException;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.ResponseEntity;

/**
 * The overlap constraint is the last line of defence behind the officer lock; if it fires, the
 * caller must see a 409 conflict, never a 500 or a driver message (review-r2 S3).
 *
 * <p>Every SQLSTATE the api can meet is mapped here, and nothing is rethrown: the payroll advice
 * used to rethrow the states it did not recognise, which aborted the handler resolution and
 * answered a raw 500 (dev-qa, 2026-11-20).
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
  void theExclusionConstraintNamesTheConflictWithoutTheSql() {
    ResponseEntity<Map<String, Object>> response =
        advice.onConflict(
            new DataIntegrityViolationException(
                "could not execute statement", new SQLException("conflict", "23P01")));

    assertThat(response.getStatusCode().value()).isEqualTo(409);
    assertThat(response.getBody())
        .containsEntry("type", "https://shiftcircle.local/problems/shift-conflict");
    assertThat(response.getBody().get("title").toString()).contains("already has a shift");
    assertThat(response.getBody().toString())
        .doesNotContain("23P01")
        .doesNotContain("could not execute statement");
  }

  @Test
  void aUniqueConstraintBecomesA409Problem() {
    ResponseEntity<Map<String, Object>> response =
        advice.onConflict(
            new DataIntegrityViolationException(
                "duplicate key", new SQLException("duplicate key", "23505")));

    assertThat(response.getStatusCode().value()).isEqualTo(409);
    assertThat(response.getBody())
        .containsEntry("type", "https://shiftcircle.local/problems/duplicate-record");
    assertThat(response.getBody().toString()).doesNotContain("23505");
  }

  @Test
  void aNumericOverflowIsABadRequestNotAServerError() {
    ResponseEntity<Map<String, Object>> response =
        advice.onConflict(
            new DataIntegrityViolationException(
                "numeric field overflow", new SQLException("numeric field overflow", "22003")));

    assertThat(response.getStatusCode().value()).isEqualTo(400);
    assertThat(response.getBody())
        .containsEntry("type", "https://shiftcircle.local/problems/invalid-hours");
    assertThat(response.getHeaders().getContentType().toString())
        .contains("application/problem+json");
  }

  @Test
  void aCheckConstraintStaysAConflict() {
    // The locked-pay-period trigger raises a check violation: a state conflict, not a bad request.
    ResponseEntity<Map<String, Object>> response =
        advice.onConflict(
            new DataIntegrityViolationException(
                "pay period is locked", new SQLException("check", "23514")));

    assertThat(response.getStatusCode().value()).isEqualTo(409);
    assertThat(response.getBody().toString()).doesNotContain("23514");
  }

  @Test
  void theMakerCheckerConstraintStaysAForbidden() {
    ResponseEntity<Map<String, Object>> response =
        advice.onConflict(
            new DataIntegrityViolationException(
                "rule_set_version_maker_checker", new SQLException("check", "23514")));

    assertThat(response.getStatusCode().value()).isEqualTo(403);
    assertThat(response.getBody().toString()).doesNotContain("rule_set_version_maker_checker");
  }

  @Test
  void aMissingRowBecomesA404Problem() {
    ResponseEntity<Map<String, Object>> response =
        advice.onMissing(new EmptyResultDataAccessException(1));

    assertThat(response.getStatusCode().value()).isEqualTo(404);
    assertThat(response.getBody().get("title")).isEqualTo("Not found");
  }
}
