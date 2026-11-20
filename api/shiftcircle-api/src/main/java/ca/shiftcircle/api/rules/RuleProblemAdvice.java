package ca.shiftcircle.api.rules;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** RFC 9457-style problem responses for rule refusals (docs/07 §2–3). */
@Order(20)
@RestControllerAdvice
public class RuleProblemAdvice {

  @ExceptionHandler(RuleViolationException.class)
  public ResponseEntity<Map<String, Object>> handle(RuleViolationException exception) {
    RuleCheckService.OutcomeView outcome = exception.outcome();
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "https://shiftcircle.local/problems/" + exception.kind().slug());
    body.put(
        "title",
        exception.kind() == RuleViolationException.Kind.WARNINGS
            ? "Warnings need acknowledgement"
            : "This change breaks " + blockingCount(outcome) + " rule(s)");
    body.put("status", HttpStatus.UNPROCESSABLE_CONTENT.value());
    body.put("outcome", outcome.outcome());
    body.put("ruleSetVersion", outcome.ruleSetVersion());
    body.put("overridable", outcome.overridable());
    body.put("ruleResults", outcome.ruleResults());
    return ResponseEntity.status(HttpStatus.UNPROCESSABLE_CONTENT)
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(body);
  }

  private static long blockingCount(RuleCheckService.OutcomeView outcome) {
    return outcome.ruleResults().stream().filter(r -> "BLOCK".equals(r.outcome())).count();
  }
}
