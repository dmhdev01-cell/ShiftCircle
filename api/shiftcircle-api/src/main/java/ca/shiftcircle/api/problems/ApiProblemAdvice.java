package ca.shiftcircle.api.problems;

import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.ErrorResponse;
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
 *
 * <p>This advice is the last one consulted ({@code @Order}), because it holds the catch-all: the
 * other advices own their own exception types and must answer first.
 */
@Order(40)
@RestControllerAdvice
public class ApiProblemAdvice {

  private static final Logger log = LoggerFactory.getLogger(ApiProblemAdvice.class);
  private static final Pattern CONSTRAINT_NAME = Pattern.compile("constraint \"([^\"]+)\"");

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
    // A refusal the caller cannot see behind is a refusal the operator cannot diagnose either.
    // The SQLSTATE and the constraint name stay in the log; the body gets plain words only.
    String state = sqlState(exception);
    String constraint = constraintName(exception);
    log.warn(
        "database conflict sqlState={} constraint={} answered with a problem document",
        state,
        constraint);
    // The database CHECK is the last line behind the app's maker/checker rule. If it fires, the
    // caller must see a refusal, not a 500 with a driver message (defense in depth).
    if (mentionsMakerChecker(exception)) {
      return problem(
          HttpStatus.FORBIDDEN,
          "The author of a rule version cannot approve it",
          "The database refused the approval: a version must be approved by someone other than"
              + " its author.");
    }
    if ("22003".equals(state)) {
      // A numeric overflow is a bad request, not a server failure (docs/07 §4.5).
      return problem(
          HttpStatus.BAD_REQUEST,
          "invalid-hours",
          "The hours are out of range",
          "The actual times would record more hours than a pay entry can hold.");
    }
    if ("23P01".equals(state) && "pay_period_no_overlap".equals(constraint)) {
      // A plan period tried to overlap an existing pay period; this is not an officer conflict.
      return problem(
          HttpStatus.CONFLICT,
          "pay-period-overlap",
          "The pay periods for this plan overlap periods that already exist",
          "Reset the demo data or choose a different quarter.");
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

  /** The field name an unknown-property failure carries, from the type or the message. */
  private static String unrecognizedField(Throwable error) {
    Throwable cause = error;
    while (cause != null) {
      if (cause instanceof tools.jackson.databind.exc.UnrecognizedPropertyException unknown) {
        return unknown.getPropertyName();
      }
      String message = cause.getMessage();
      if (message != null) {
        Matcher matcher = UNRECOGNIZED_FIELD.matcher(message);
        if (matcher.find()) {
          return matcher.group(1);
        }
      }
      cause = cause.getCause();
    }
    return null;
  }

  private static final Pattern UNRECOGNIZED_FIELD =
      Pattern.compile("Unrecognized field \"([^\"]+)\"");

  /** The constraint name a PostgreSQL driver puts in its message, for the log only. */
  private static String constraintName(Throwable error) {
    Throwable current = error;
    while (current != null) {
      String message = current.getMessage();
      if (message != null) {
        Matcher matcher = CONSTRAINT_NAME.matcher(message);
        if (matcher.find()) {
          return matcher.group(1);
        }
      }
      current = current.getCause();
    }
    return "unknown";
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
    String unknownField = unrecognizedField(exception);
    if (unknownField != null) {
      return problem(
          HttpStatus.BAD_REQUEST,
          "Bad request",
          "The field '" + unknownField + "' is not part of this request.");
    }
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

  /**
   * A role or scope refusal from Spring Security. It answers a problem document here; without this
   * handler the security filter would answer an empty body.
   */
  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<Map<String, Object>> onAccessDenied() {
    return problem(
        HttpStatus.FORBIDDEN,
        "Not allowed",
        "This account may not do that. Ask a supervisor with the right scope.");
  }

  /**
   * Not signed in. The security filter answers this one before the advice sees it; this is the
   * backstop for an authentication failure raised further in.
   */
  @ExceptionHandler(AuthenticationException.class)
  public ResponseEntity<Map<String, Object>> onUnauthenticated() {
    return problem(HttpStatus.UNAUTHORIZED, "Not signed in", "Sign in and try again.");
  }

  /**
   * Everything else. Spring's own web exceptions already know their status (405 for a wrong verb,
   * 415 for a wrong media type), and they keep it. Anything left is a server failure: the answer
   * says so and nothing else, so no internals reach the caller. The failure is logged at ERROR with
   * its stack, under the same trace id the caller is given, so the operator can find it.
   */
  @ExceptionHandler(Exception.class)
  public ResponseEntity<Map<String, Object>> onUnexpected(Exception exception) {
    if (exception instanceof ErrorResponse errorResponse) {
      HttpStatus status = HttpStatus.valueOf(errorResponse.getStatusCode().value());
      if (!status.is5xxServerError()) {
        return problem(status, status.getReasonPhrase(), null);
      }
    }
    String traceId = UUID.randomUUID().toString();
    log.error(
        "unexpected failure traceId={}; the caller sees only the problem document",
        traceId,
        exception);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "https://shiftcircle.local/problems/500");
    body.put("title", "Something went wrong");
    body.put("status", HttpStatus.INTERNAL_SERVER_ERROR.value());
    body.put(
        "detail",
        "The request could not be completed. Quote traceId " + traceId + " when you report it.");
    body.put("traceId", traceId);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(body);
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
