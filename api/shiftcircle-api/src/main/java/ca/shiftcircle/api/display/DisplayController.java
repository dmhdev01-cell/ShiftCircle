package ca.shiftcircle.api.display;

import ca.shiftcircle.api.security.ScopeGuard;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The wall display's read endpoint (docs/07 §4.8): counts only, no names. */
@RestController
@RequestMapping("/api/v1")
public class DisplayController {

  private final DisplayService display;
  private final ScopeGuard scopeGuard;

  public DisplayController(DisplayService display, ScopeGuard scopeGuard) {
    this.display = display;
    this.scopeGuard = scopeGuard;
  }

  @GetMapping("/display/today")
  @PreAuthorize("hasAnyRole('DISPLAY','SUPERVISOR','AUDITOR')")
  public DisplayService.DisplayPayload today() {
    return display.today(scopeGuard.principal());
  }
}
