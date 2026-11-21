package ca.shiftcircle.api.planner;

import ca.shiftcircle.api.demo.DemoOperationLock;
import ca.shiftcircle.api.schedule.ScheduleQuery;
import ca.shiftcircle.api.security.ScopeGuard;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The quarter planner (docs/07 §4.9). Facility-wide; only PLANNER may call it. */
@RestController
@RequestMapping("/api/v1/planner")
@PreAuthorize("hasRole('PLANNER')")
public class PlannerController {

  private final PlannerService planner;
  private final ScopeGuard scopeGuard;
  private final DemoOperationLock demoLock;

  public PlannerController(
      PlannerService planner, ScopeGuard scopeGuard, DemoOperationLock demoLock) {
    this.planner = planner;
    this.scopeGuard = scopeGuard;
    this.demoLock = demoLock;
  }

  @org.springframework.web.bind.annotation.ExceptionHandler(PlannerConflictException.class)
  public ResponseEntity<Object> conflict(PlannerConflictException conflict) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
        .body(
            java.util.Map.of(
                "type", "https://shiftcircle.local/problems/409",
                "title", conflict.getMessage(),
                "status", 409,
                "reason", conflict.reason()));
  }

  /** A planner marks a future absence; the next generate skips that officer on that date. */
  @PostMapping("/absences")
  public ResponseEntity<Map<String, Object>> planAbsence(@RequestBody PlannedAbsence input) {
    PlannerViews.PlannedAbsenceResult result =
        planner.planAbsence(
            input.employeeId(), input.date(), input.type(), scopeGuard.principal());
    return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
        .body(result.body());
  }

  public record PlannedAbsence(UUID employeeId, java.time.LocalDate date, String type) {}

  @GetMapping("/plan")
  public PlannerViews.PlanState plan() {
    return planner.state();
  }

  @PostMapping("/drafts")
  @ResponseStatus(HttpStatus.CREATED)
  public PlannerViews.DraftSummary generate(
      @RequestBody(required = false) PlannerViews.DraftCreation creation) {
    if (!demoLock.tryAcquire()) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "A demo reset or another planner run is in progress");
    }
    try {
      return planner.generate(
          creation == null ? new PlannerViews.DraftCreation(0, null) : creation,
          scopeGuard.principal());
    } finally {
      demoLock.release();
    }
  }

  @GetMapping("/drafts/{id}")
  public PlannerViews.DraftSummary draft(@PathVariable UUID id) {
    return planner.draft(id);
  }

  @GetMapping("/drafts/{id}/gaps")
  public List<PlannerViews.GapView> gaps(@PathVariable UUID id) {
    return planner.gaps(id);
  }

  /** The Roster tab: the same shape as the planning board, built from the draft's own rows. */
  @GetMapping("/drafts/{id}/schedule")
  public ScheduleQuery.SchedulePayload schedule(
      @PathVariable UUID id,
      @RequestParam UUID unitId,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
    return planner.schedule(id, unitId, from, to);
  }

  /** The Coverage strip across every unit, one entry per unit. */
  @GetMapping("/drafts/{id}/coverage")
  public List<PlannerViews.UnitCoverage> coverage(
      @PathVariable UUID id,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
    return planner.draftCoverage(id, from, to);
  }

  @GetMapping("/drafts/{id}/warnings")
  public List<PlannerViews.WarningGroup> warnings(@PathVariable UUID id) {
    return planner.warnings(id);
  }

  @GetMapping("/drafts/{id}/commit-preview")
  public PlannerViews.CommitPreview preview(@PathVariable UUID id) {
    return planner.preview(id);
  }

  @PostMapping("/drafts/{id}/commit")
  public ResponseEntity<Object> commit(
      @PathVariable UUID id,
      @RequestHeader(value = "If-Match", required = false) String ifMatch,
      @RequestBody(required = false) PlannerViews.CommitInput input) {
    if (!demoLock.tryAcquire()) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "A demo reset or another planner run is in progress");
    }
    try {
      PlannerService.CommitAttempt attempt =
          planner.commit(id, input, version(ifMatch), scopeGuard.principal());
      return ResponseEntity.status(attempt.status()).body(attempt.body());
    } finally {
      demoLock.release();
    }
  }

  @PostMapping("/drafts/{id}/discard")
  public PlannerViews.DiscardResult discard(@PathVariable UUID id) {
    if (!demoLock.tryAcquire()) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "A demo reset or another planner run is in progress");
    }
    try {
      return planner.discard(id, scopeGuard.principal());
    } finally {
      demoLock.release();
    }
  }

  @GetMapping("/drafts/{id}/compare")
  public PlannerViews.CompareView compare(@PathVariable UUID id) {
    return planner.compare(id);
  }

  @GetMapping("/preferences")
  public List<PlannerViews.PreferenceView> preferences(
      @RequestParam(required = false) String unitId) {
    return planner.preferences(unitId);
  }

  /** The per-officer pattern: an 8 h officer only; a 12 h crew pattern is read-only. */
  @PutMapping("/preferences/{employeeId}/pattern")
  public PlannerViews.PreferenceView setPattern(
      @PathVariable UUID employeeId, @RequestBody PatternInput input) {
    return planner.setOfficerPattern(employeeId, input.pattern(), scopeGuard.principal());
  }

  public record PatternInput(String pattern) {}

  private static Integer version(String ifMatch) {
    if (ifMatch == null || ifMatch.isBlank()) {
      return null;
    }
    String value = ifMatch.trim();
    if (value.startsWith("W/")) {
      value = value.substring(2);
    }
    value = value.replace("\"", "");
    try {
      return Integer.valueOf(value);
    } catch (NumberFormatException notAVersion) {
      return null;
    }
  }
}
