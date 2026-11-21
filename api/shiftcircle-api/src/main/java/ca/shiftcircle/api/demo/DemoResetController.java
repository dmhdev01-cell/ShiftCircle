package ca.shiftcircle.api.demo;

import ca.shiftcircle.api.security.ScopeGuard;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Demo reset control (About screen). Demo profile only; PLANNER only. */
@RestController
@RequestMapping("/api/v1/demo")
@Profile("demo")
@ConditionalOnProperty(name = "sc.demo.generate", havingValue = "true", matchIfMissing = true)
@PreAuthorize("hasRole('PLANNER')")
public class DemoResetController {

  public record ResetRequest(String confirm, String dataset) {}

  private final DemoResetService reset;
  private final ScopeGuard scopeGuard;

  public DemoResetController(DemoResetService reset, ScopeGuard scopeGuard) {
    this.reset = reset;
    this.scopeGuard = scopeGuard;
  }

  /** Starts the asynchronous reset; 409 while another reset or a planner run is in flight. */
  @PostMapping("/reset")
  public DemoResetService.Status reset(@RequestBody(required = false) ResetRequest request) {
    return reset.start(
        request == null ? null : request.confirm(),
        request == null ? null : request.dataset(),
        scopeGuard.principal());
  }

  @GetMapping("/reset/status")
  public DemoResetService.Status status() {
    return reset.status();
  }
}
