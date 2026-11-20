package ca.shiftcircle.api.payroll;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Problem responses for time and payroll (docs/07 §4.5, ADR-017).
 *
 * <p>The database constraint failures are mapped in one place, {@code ApiProblemAdvice}: two advices
 * claiming the same exception, and one of them rethrowing what it did not recognise, aborted the
 * handler resolution and answered a raw 500 (dev-qa, 2026-11-20). The numeric overflow (SQLSTATE
 * 22003) is a bad request there, and the exclusion constraint is a conflict.
 */
@Order(30)
@RestControllerAdvice
public class PayrollProblemAdvice {

  @ExceptionHandler(MissingActualsException.class)
  public ResponseEntity<Map<String, Object>> missingActuals(MissingActualsException exception) {
    int count = exception.missing().size();
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "https://shiftcircle.local/problems/missing-actuals");
    body.put(
        "title", count + (count == 1 ? " shift has" : " shifts have") + " no actual recorded");
    body.put("status", HttpStatus.CONFLICT.value());
    body.put("detail", "Record the actuals before locking the period.");
    body.put("count", count);
    body.put("missing", exception.missing());
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(body);
  }

  @ExceptionHandler(LockedPeriodException.class)
  public ResponseEntity<Map<String, Object>> locked() {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "https://shiftcircle.local/problems/pay-period-locked");
    body.put("title", "This pay period is locked");
    body.put("status", HttpStatus.CONFLICT.value());
    body.put("detail", "Unlock it with a reason to make changes.");
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(body);
  }

  @ExceptionHandler(InvalidActualWindowException.class)
  public ResponseEntity<Map<String, Object>> invalidActualWindow(
      InvalidActualWindowException exception) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "https://shiftcircle.local/problems/invalid-actual-window");
    body.put("title", "The actual times are outside the shift window");
    body.put("status", HttpStatus.BAD_REQUEST.value());
    body.put("detail", exception.getMessage());
    return ResponseEntity.status(HttpStatus.BAD_REQUEST)
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(body);
  }

  @ExceptionHandler(NotLockedException.class)
  public ResponseEntity<Map<String, Object>> notLocked(NotLockedException exception) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "https://shiftcircle.local/problems/pay-period-not-locked");
    body.put("title", "This pay period is not locked");
    body.put("status", HttpStatus.CONFLICT.value());
    body.put("detail", exception.getMessage());
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(body);
  }
}
