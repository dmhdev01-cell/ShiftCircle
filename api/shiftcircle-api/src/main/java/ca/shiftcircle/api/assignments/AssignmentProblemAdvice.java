package ca.shiftcircle.api.assignments;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** RFC 9457 problem responses for moving and cancelling shifts (docs/07 §4.2). */
@Order(10)
@RestControllerAdvice
public class AssignmentProblemAdvice {

  @ExceptionHandler(AssignmentProblemException.class)
  public ResponseEntity<Map<String, Object>> onAssignmentProblem(
      AssignmentProblemException exception) {
    AssignmentProblemException.Kind kind = exception.kind();
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "https://shiftcircle.local/problems/" + kind.slug());
    body.put("title", kind.title());
    body.put("status", kind.status());
    body.put("detail", exception.detail());
    return ResponseEntity.status(HttpStatus.valueOf(kind.status()))
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(body);
  }
}
