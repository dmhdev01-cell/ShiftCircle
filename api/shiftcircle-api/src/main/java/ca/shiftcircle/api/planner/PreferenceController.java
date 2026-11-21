package ca.shiftcircle.api.planner;

import ca.shiftcircle.api.security.ScopeGuard;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** An officer's own planner preferences (docs/ui/planner.md §10.7). */
@RestController
@RequestMapping("/api/v1/me/preferences")
public class PreferenceController {

  private final PlannerService planner;
  private final ScopeGuard scopeGuard;

  public PreferenceController(PlannerService planner, ScopeGuard scopeGuard) {
    this.planner = planner;
    this.scopeGuard = scopeGuard;
  }

  @GetMapping
  public PlannerViews.MyPreferences get() {
    return planner.myPreferences(scopeGuard.principal());
  }

  @PutMapping
  public PlannerViews.MyPreferences put(@RequestBody PlannerViews.PreferenceInput input) {
    return planner.saveMyPreferences(input, scopeGuard.principal());
  }

  @DeleteMapping
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void clear() {
    planner.clearMyPreferences(scopeGuard.principal());
  }
}
