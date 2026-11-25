package ca.shiftcircle.api.reports;

import ca.shiftcircle.api.security.ScopeGuard;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The reports endpoints (docs/07 §4.6). Each one answers JSON, or CSV when the request asks for
 * {@code text/csv}; the web's export uses the same path with that header.
 *
 * <p>Roles per docs/09 §2: coverage, overtime and overrides are supervisor/auditor; hours also
 * allows an employee, who then sees only their own row.
 */
@RestController
@RequestMapping("/api/v1")
public class ReportsController {

  private final ReportsService reports;
  private final ScopeGuard scopeGuard;

  public ReportsController(ReportsService reports, ScopeGuard scopeGuard) {
    this.reports = reports;
    this.scopeGuard = scopeGuard;
  }

  @GetMapping("/reports/coverage")
  @PreAuthorize("hasAnyRole('SUPERVISOR','AUDITOR')")
  public ResponseEntity<?> coverage(
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(required = false) String unitId,
      @RequestParam(required = false, defaultValue = "week") String groupBy,
      @RequestHeader(value = HttpHeaders.ACCEPT, required = false) String accept) {
    if (csv(accept)) {
      return file(
          "coverage-by-week.csv",
          reports.coverageCsv(scopeGuard.principal(), from, to, groupBy, unitId));
    }
    return ResponseEntity.ok(reports.coverage(scopeGuard.principal(), from, to, groupBy, unitId));
  }

  @GetMapping("/reports/hours")
  @PreAuthorize("hasAnyRole('SUPERVISOR','AUDITOR','EMPLOYEE')")
  public ResponseEntity<?> hours(
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(required = false) String unitId,
      @RequestParam(required = false) UUID employeeId,
      @RequestParam(required = false) String position,
      @RequestHeader(value = HttpHeaders.ACCEPT, required = false) String accept) {
    if (csv(accept)) {
      return file(
          "hours-by-officer.csv",
          reports.hoursCsv(scopeGuard.principal(), from, to, unitId, employeeId, position));
    }
    return ResponseEntity.ok(
        reports.hours(scopeGuard.principal(), from, to, unitId, employeeId, position));
  }

  @GetMapping("/reports/overtime")
  @PreAuthorize("hasAnyRole('SUPERVISOR','AUDITOR')")
  public ResponseEntity<?> overtime(
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(required = false) String unitId,
      @RequestParam(required = false) Integer top,
      @RequestParam(required = false) UUID employeeId,
      @RequestParam(required = false) String position,
      @RequestHeader(value = HttpHeaders.ACCEPT, required = false) String accept) {
    if (employeeId != null) {
      throw new org.springframework.web.server.ResponseStatusException(
          org.springframework.http.HttpStatus.BAD_REQUEST,
          "employeeId is only used by the hours report");
    }
    if (csv(accept)) {
      return file(
          "overtime-by-officer.csv",
          reports.overtimeCsv(scopeGuard.principal(), from, to, unitId, top, position));
    }
    return ResponseEntity.ok(
        reports.overtime(scopeGuard.principal(), from, to, unitId, top, position));
  }

  @GetMapping("/reports/overrides")
  @PreAuthorize("hasAnyRole('SUPERVISOR','AUDITOR')")
  public ResponseEntity<?> overrides(
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(required = false) String unitId,
      @RequestParam(required = false) UUID employeeId,
      @RequestHeader(value = HttpHeaders.ACCEPT, required = false) String accept) {
    if (employeeId != null) {
      throw new org.springframework.web.server.ResponseStatusException(
          org.springframework.http.HttpStatus.BAD_REQUEST,
          "employeeId is only used by the hours report");
    }
    if (csv(accept)) {
      return file(
          "emergency-overrides.csv",
          reports.overridesCsv(scopeGuard.principal(), from, to, unitId));
    }
    return ResponseEntity.ok(reports.overrides(scopeGuard.principal(), from, to, unitId));
  }

  private static boolean csv(String accept) {
    return accept != null && accept.toLowerCase(java.util.Locale.ROOT).contains("text/csv");
  }

  private static ResponseEntity<byte[]> file(String fileName, String content) {
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType("text/csv"))
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment().filename(fileName).build().toString())
        .body(content.getBytes(StandardCharsets.UTF_8));
  }
}
