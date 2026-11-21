package ca.shiftcircle.api.payroll;

import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Time and payroll endpoints (docs/07 §4.5). Roles and scope are enforced here and in the service. */
@RestController
@RequestMapping("/api/v1")
public class PayrollController {

  private final PayrollService payroll;
  private final ScopeGuard scopeGuard;

  public PayrollController(PayrollService payroll, ScopeGuard scopeGuard) {
    this.payroll = payroll;
    this.scopeGuard = scopeGuard;
  }

  @GetMapping("/pay-periods")
  @PreAuthorize("hasAnyRole('SUPERVISOR','AUDITOR')")
  public List<PayrollViews.PayPeriodView> payPeriods() {
    return payroll.payPeriods(scopeGuard.principal());
  }

  @GetMapping("/pay-periods/{id}/time-entries")
  @PreAuthorize("hasAnyRole('SUPERVISOR','AUDITOR','EMPLOYEE')")
  public List<PayrollViews.TimeEntryView> timeEntries(
      @PathVariable UUID id, @RequestParam(required = false) UUID employeeId) {
    return payroll.timeEntries(id, employeeId, scopeGuard.principal());
  }

  /** {@code id} is the rostered shift's id: the time entry may not exist until the actual is saved. */
  @PutMapping("/time-entries/{id}")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public PayrollViews.RecordActualResult recordActual(
      @PathVariable UUID id, @RequestBody PayrollInputs.RecordActual input) {
    AuthPrincipal principal = scopeGuard.principal();
    return payroll.recordActual(id, input, principal);
  }

  /** Returns the shift to "needs actual": the actual/absence is removed, not replaced by a guess. */
  @DeleteMapping("/time-entries/{id}")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public PayrollViews.RecordActualResult clearActual(@PathVariable UUID id) {
    return payroll.clearActual(id, scopeGuard.principal());
  }

  @PostMapping("/absences")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize("hasRole('SUPERVISOR')")
  public Map<String, Object> recordAbsence(@RequestBody PayrollInputs.Absence input) {
    PayrollViews.RecordActualResult result =
        payroll.recordAbsence(input, scopeGuard.principal());
    return Map.of("assignmentId", input.assignmentId().toString(), "entry", result.entry());
  }

  @PostMapping("/pay-periods/{id}/lock")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public PayrollViews.PayPeriodView lock(@PathVariable UUID id) {
    return payroll.lock(id, scopeGuard.principal());
  }

  @PostMapping("/pay-periods/{id}/unlock")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public PayrollViews.PayPeriodView unlock(
      @PathVariable UUID id, @RequestBody PayrollInputs.Unlock input) {
    return payroll.unlock(id, input.reason(), scopeGuard.principal());
  }

  @GetMapping("/pay-periods/{id}/payroll-export")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public ResponseEntity<byte[]> payrollExport(@PathVariable UUID id) {
    PayrollViews.PayrollFile file = payroll.export(id, scopeGuard.principal());
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType("text/csv"))
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment().filename(file.fileName()).build().toString())
        .body(file.content().getBytes(StandardCharsets.UTF_8));
  }
}
