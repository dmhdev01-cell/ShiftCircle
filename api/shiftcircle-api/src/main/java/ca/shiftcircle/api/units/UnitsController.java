package ca.shiftcircle.api.units;

import ca.shiftcircle.api.security.ScopeGuard;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Units, closures and staffing (P4-UNIT-SPEC §7); the facility planner only. */
@RestController
@RequestMapping("/api/v1/planner")
@PreAuthorize("hasRole('PLANNER')")
public class UnitsController {

  private final UnitsService units;
  private final ScopeGuard scopeGuard;

  public UnitsController(UnitsService units, ScopeGuard scopeGuard) {
    this.units = units;
    this.scopeGuard = scopeGuard;
  }

  @GetMapping("/units")
  public List<UnitsViews.UnitView> units() {
    return units.units();
  }

  @PostMapping("/units/{unitId}/closures")
  @ResponseStatus(HttpStatus.CREATED)
  public UnitsViews.ClosureView addClosure(
      @PathVariable UUID unitId, @RequestBody UnitsViews.ClosureInput input) {
    return units.add(unitId, input, scopeGuard.principal());
  }

  @PutMapping("/units/{unitId}/closures/{closureId}")
  public UnitsViews.ClosureView changeClosure(
      @PathVariable UUID unitId,
      @PathVariable UUID closureId,
      @RequestBody UnitsViews.ClosureInput input) {
    return units.change(unitId, closureId, input, scopeGuard.principal());
  }

  @DeleteMapping("/units/{unitId}/closures/{closureId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void removeClosure(
      @PathVariable UUID unitId,
      @PathVariable UUID closureId,
      @RequestBody(required = false) UnitsViews.DeleteInput input) {
    units.remove(unitId, closureId, input, scopeGuard.principal());
  }

  @PostMapping("/units/{unitId}/closures/preview")
  public UnitsViews.Preview preview(
      @PathVariable UUID unitId, @RequestBody UnitsViews.ClosureInput input) {
    return units.preview(unitId, input);
  }

  @GetMapping("/flagged-shifts")
  public List<UnitsViews.FlaggedShift> flaggedShifts() {
    return units.flaggedShifts();
  }

  @GetMapping("/staffing")
  public UnitsViews.StaffingReport staffing() {
    return units.staffing();
  }

  @PutMapping("/units/{unitId}/staffing")
  public UnitsViews.StaffingUnit setAllocated(
      @PathVariable UUID unitId, @RequestBody UnitsViews.AllocatedInput input) {
    return units.setAllocated(unitId, input, scopeGuard.principal());
  }

  @PutMapping("/settings/leave-allowance")
  public Map<String, Object> setLeaveAllowance(
      @RequestBody UnitsViews.LeaveAllowanceInput input) {
    return units.setLeaveAllowance(input, scopeGuard.principal());
  }
}
