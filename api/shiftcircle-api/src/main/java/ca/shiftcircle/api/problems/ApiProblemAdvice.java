package ca.shiftcircle.api.problems;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;

/**
 * RFC 9457 problem responses for input the API cannot use (review-r2 S3).
 *
 * <p>Unknown or out-of-scope identifiers answer 404, a malformed or incomplete request answers 400,
 * and a database conflict answers 409. The body never carries a stack trace or an internal class
 * name; the detail is written for the person using the screen.
 */
@RestControllerAdvice
public class ApiProblemAdvice {

  @ExceptionHandler(ResponseStatusException.class)
  public ResponseEntity<Map<String, Object>> onStatus(ResponseStatusException exception) {
    HttpStatus status = HttpStatus.valueOf(exception.getStatusCode().value());
    String title = exception.getReason() == null ? status.getReasonPhrase() : exception.getReason();
    return problem(status, title, null);
  }

  @ExceptionHandler(EmptyResultDataAccessException.class)
  public ResponseEntity<Map<String, Object>> onMissing(EmptyResultDataAccessException exception) {
    return problem(HttpStatus.NOT_FOUND, "Not found", null);
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  public ResponseEntity<Map<String, Object>> onConflict(DataIntegrityViolationException exception) {
    return problem(
        HttpStatus.CONFLICT,
        "State conflict",
        "The change conflicts with another saved change. Reload and try again.");
  }

  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class,
    MissingServletRequestParameterException.class
  })
  public ResponseEntity<Map<String, Object>> onBadRequest(Exception exception) {
    return problem(
        HttpStatus.BAD_REQUEST, "Bad request", "The request body or its values could not be read.");
  }

  private ResponseEntity<Map<String, Object>> problem(
      HttpStatus status, String title, String detail) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "https://shiftcircle.local/problems/" + status.value());
    body.put("title", title);
    body.put("status", status.value());
    if (detail != null) {
      body.put("detail", detail);
    }
    return ResponseEntity.status(status)
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(body);
  }
}
