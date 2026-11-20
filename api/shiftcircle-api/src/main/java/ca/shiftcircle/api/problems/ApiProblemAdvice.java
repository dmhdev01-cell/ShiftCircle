package ca.shiftcircle.api.problems;

import java.sql.SQLException;
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

  /**
   * Every database constraint failure comes back as a problem document.
   *
   * <p>One place maps them, and nothing rethrows: two advices claimed
   * {@code DataIntegrityViolationException}, and the payroll one rethrew the SQLSTATEs it did not
   * recognise. The rethrow aborted the handler resolution, so the generic conflict answer never
   * ran and an emergency override that overlapped an existing shift reached the exclusion
   * constraint and answered a raw 500 (dev-qa, 2026-11-20).
   */
  @ExceptionHandler(DataIntegrityViolationException.class)
  public ResponseEntity<Map<String, Object>> onConflict(DataIntegrityViolationException exception) {
    // The database CHECK is the last line behind the app's maker/checker rule. If it fires, the
    // caller must see a refusal, not a 500 with a driver message (defense in depth).
    if (mentionsMakerChecker(exception)) {
      return problem(
          HttpStatus.FORBIDDEN,
          "The author of a rule version cannot approve it",
          "The database refused the approval: a version must be approved by someone other than"
              + " its author.");
    }
    String state = sqlState(exception);
    if ("22003".equals(state)) {
      // A numeric overflow is a bad request, not a server failure (docs/07 §4.5).
      return problem(
          HttpStatus.BAD_REQUEST,
          "invalid-hours",
          "The hours are out of range",
          "The actual times would record more hours than a pay entry can hold.");
    }
    if ("23P01".equals(state)) {
      // The exclusion constraint: one officer cannot be in two places at once.
      return problem(
          HttpStatus.CONFLICT,
          "shift-conflict",
          "This officer already has a shift at that time",
          "Move or cancel the other shift first.");
    }
    if ("23505".equals(state)) {
      return problem(
          HttpStatus.CONFLICT,
          "duplicate-record",
          "That record already exists",
          "Reload and try again.");
    }
    return problem(
        HttpStatus.CONFLICT,
        "State conflict",
        "The change conflicts with another saved change. Reload and try again.");
  }

  /** The SQLSTATE of the driver error behind the exception, if there is one. */
  private static String sqlState(Throwable error) {
    Throwable current = error;
    while (current != null) {
      if (current instanceof SQLException sql && sql.getSQLState() != null) {
        return sql.getSQLState();
      }
      current = current.getCause();
    }
    return null;
  }

  private static boolean mentionsMakerChecker(Throwable error) {
    Throwable cause = error;
    while (cause != null) {
      String message = cause.getMessage();
      if (message != null && message.contains("rule_set_version_maker_checker")) {
        return true;
      }
      cause = cause.getCause();
    }
    return false;
  }

  @ExceptionHandler(ca.shiftcircle.api.overtime.CandidateUnavailableException.class)
  public ResponseEntity<Map<String, Object>> onUnavailable(
      ca.shiftcircle.api.overtime.CandidateUnavailableException exception) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "https://shiftcircle.local/problems/officer-unavailable");
    body.put("title", "Officer unavailable for this shift");
    body.put("status", HttpStatus.UNPROCESSABLE_CONTENT.value());
    body.put("detail", exception.getMessage());
    return ResponseEntity.status(HttpStatus.UNPROCESSABLE_CONTENT)
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(body);
  }

  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class,
    MissingServletRequestParameterException.class
  })
  public ResponseEntity<Map<String, Object>> onBadRequest(Exception exception) {
    if (exception instanceof MethodArgumentTypeMismatchException mismatch) {
      return problem(
          HttpStatus.BAD_REQUEST,
          "Bad request",
          "The value '" + mismatch.getValue() + "' for '" + mismatch.getName() + "' is not valid.");
    }
    if (exception instanceof MissingServletRequestParameterException missing) {
      return problem(
          HttpStatus.BAD_REQUEST, "Bad request", "The field '" + missing.getParameterName() + "' is required.");
    }
    return problem(
        HttpStatus.BAD_REQUEST, "Bad request", "The request body or its values could not be read.");
  }

  private ResponseEntity<Map<String, Object>> problem(
      HttpStatus status, String title, String detail) {
    return problem(status, String.valueOf(status.value()), title, detail);
  }

  /** A problem document with its own type slug, so the caller can recognise the refusal. */
  private ResponseEntity<Map<String, Object>> problem(
      HttpStatus status, String slug, String title, String detail) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "https://shiftcircle.local/problems/" + slug);
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
