package ca.shiftcircle.api.overtime;

import ca.shiftcircle.api.security.ScopeGuard;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Overtime endpoints (docs/07 §4.3): open shifts, the ranked list, offers, the employee's answer
 * and the supervisor's confirmation. S-04 (ADR-019): every create/offer/confirm is a supervisor
 * action and is audited by the service.
 */
@RestController
@RequestMapping("/api/v1")
public class OvertimeController {

  private final OvertimeService overtime;
  private final ScopeGuard scopeGuard;

  public OvertimeController(OvertimeService overtime, ScopeGuard scopeGuard) {
    this.overtime = overtime;
    this.scopeGuard = scopeGuard;
  }

  @GetMapping("/open-shifts")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public List<OvertimeService.OpenShiftView> openShifts(
      @RequestParam(required = false) UUID unitId,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      @RequestParam(required = false) String status) {
    return overtime.openShifts(scopeGuard.principal(), unitId, from, to, status);
  }

  @PostMapping("/open-shifts")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize("hasRole('SUPERVISOR')")
  public OvertimeService.OpenShiftView create(
      @RequestBody OvertimeService.CreateOpenShiftRequest request) {
    return overtime.createOpenShift(request, scopeGuard.principal());
  }

  @GetMapping("/open-shifts/{id}/candidates")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public OvertimeService.CandidatesPayload candidates(@PathVariable UUID id) {
    return overtime.candidates(id, scopeGuard.principal());
  }

  @PostMapping("/open-shifts/{id}/offers")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public List<OvertimeService.OfferRecordView> offer(
      @PathVariable UUID id, @RequestBody OvertimeService.OfferRequest request) {
    return overtime.offer(id, request, scopeGuard.principal());
  }

  @PostMapping("/open-shifts/{id}/assign")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public Map<String, Object> assign(
      @PathVariable UUID id, @RequestBody OvertimeService.DirectAssignRequest request) {
    return overtime.assignDirect(id, request, scopeGuard.principal());
  }

  @GetMapping("/me/offers")
  public List<OvertimeService.MyOfferView> myOffers(
      @RequestParam(required = false) String status) {
    return overtime.myOffers(scopeGuard.principal(), status);
  }

  @PostMapping("/offers/{id}/accept")
  public OvertimeService.MyOfferView accept(@PathVariable UUID id) {
    return overtime.respond(id, true, scopeGuard.principal());
  }

  @PostMapping("/offers/{id}/decline")
  public OvertimeService.MyOfferView decline(@PathVariable UUID id) {
    return overtime.respond(id, false, scopeGuard.principal());
  }

  @PostMapping("/offers/{id}/confirm")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public OvertimeService.OfferRecordView confirm(@PathVariable UUID id) {
    return overtime.confirm(id, scopeGuard.principal());
  }
}
