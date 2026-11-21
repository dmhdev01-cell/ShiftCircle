package ca.shiftcircle.api.planner;

import ca.shiftcircle.api.security.ScopeGuard;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The quarter planner (docs/07 §4.9). Facility-wide; only PLANNER may call it. */
@RestController
@RequestMapping("/api/v1/planner")
@PreAuthorize("hasRole('PLANNER')")
public class PlannerController {

  private final PlannerService planner;
  private final ScopeGuard scopeGuard;

  public PlannerController(PlannerService planner, ScopeGuard scopeGuard) {
    this.planner = planner;
    this.scopeGuard = scopeGuard;
  }

  @GetMapping("/plan")
  public PlannerViews.PlanState plan() {
    return planner.state();
  }

  @PostMapping("/drafts")
  @ResponseStatus(HttpStatus.CREATED)
  public PlannerViews.DraftSummary generate(
      @RequestBody(required = false) PlannerViews.DraftCreation creation) {
    return planner.generate(
        creation == null ? new PlannerViews.DraftCreation(0, null) : creation,
        scopeGuard.principal());
  }

  @GetMapping("/drafts/{id}")
  public PlannerViews.DraftSummary draft(@PathVariable UUID id) {
    return planner.draft(id);
  }

  @GetMapping("/drafts/{id}/gaps")
  public List<PlannerViews.GapView> gaps(@PathVariable UUID id) {
    return planner.gaps(id);
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
    PlannerService.CommitAttempt attempt =
        planner.commit(id, input, version(ifMatch), scopeGuard.principal());
    return ResponseEntity.status(attempt.status()).body(attempt.body());
  }

  @PostMapping("/drafts/{id}/discard")
  public PlannerViews.DiscardResult discard(@PathVariable UUID id) {
    return planner.discard(id, scopeGuard.principal());
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
