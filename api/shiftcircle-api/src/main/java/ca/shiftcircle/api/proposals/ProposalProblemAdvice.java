package ca.shiftcircle.api.proposals;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** RFC 9457 problem responses for proposals (docs/07 §4.4). */
@Order(10)
@RestControllerAdvice
public class ProposalProblemAdvice {

  @ExceptionHandler(ProposalProblemException.class)
  public ResponseEntity<Map<String, Object>> onProposalProblem(ProposalProblemException exception) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("type", "https://shiftcircle.local/problems/" + exception.slug());
    body.put("title", exception.title());
    body.put("status", exception.status());
    body.put("detail", exception.detail());
    body.putAll(exception.extra());
    return ResponseEntity.status(HttpStatus.valueOf(exception.status()))
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(body);
  }
}
