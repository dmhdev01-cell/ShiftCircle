package ca.shiftcircle.api.payroll;

import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Problem responses for time and payroll (docs/07 §4.5, ADR-017). */
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

  /** A numeric overflow (SQLSTATE 22003) is a bad request, not a server failure. */
  @ExceptionHandler(DataIntegrityViolationException.class)
  public ResponseEntity<Map<String, Object>> invalidHours(DataIntegrityViolationException exception) {
    if (!hasSqlState(exception, "22003")) {
      throw exception;
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "https://shiftcircle.local/problems/invalid-hours");
    body.put("title", "The hours are out of range");
    body.put("status", HttpStatus.BAD_REQUEST.value());
    body.put("detail", "The actual times would record more hours than a pay entry can hold.");
    return ResponseEntity.status(HttpStatus.BAD_REQUEST)
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(body);
  }

  private static boolean hasSqlState(Throwable error, String state) {
    Throwable current = error;
    while (current != null) {
      if (current instanceof SQLException sql && state.equals(sql.getSQLState())) {
        return true;
      }
      current = current.getCause();
    }
    return false;
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
