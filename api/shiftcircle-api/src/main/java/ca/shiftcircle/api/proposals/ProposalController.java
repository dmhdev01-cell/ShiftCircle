package ca.shiftcircle.api.proposals;

import ca.shiftcircle.api.security.ScopeGuard;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
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

/** The officer's side of shift proposals (docs/07 §4.4). The proposer is always the caller. */
@RestController
@RequestMapping("/api/v1")
public class ProposalController {

  private final ProposalService proposals;
  private final ScopeGuard scopeGuard;

  public ProposalController(ProposalService proposals, ScopeGuard scopeGuard) {
    this.proposals = proposals;
    this.scopeGuard = scopeGuard;
  }

  @PostMapping("/proposals/preview")
  @PreAuthorize("hasRole('EMPLOYEE')")
  public ProposalService.PreviewView preview(@RequestBody ProposalService.PreviewRequest request) {
    return proposals.preview(request, scopeGuard.principal());
  }

  @PostMapping("/proposals")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize("hasRole('EMPLOYEE')")
  public ProposalService.ProposalView submit(@RequestBody ProposalService.SubmitRequest request) {
    return proposals.submit(request, scopeGuard.principal());
  }

  @GetMapping("/me/proposals")
  @PreAuthorize("hasRole('EMPLOYEE')")
  public List<ProposalService.ProposalView> mine(
      @RequestParam(name = "status", required = false) String status) {
    return proposals.mine(status, scopeGuard.principal());
  }

  @PostMapping("/proposals/{id}/withdraw")
  @PreAuthorize("hasRole('EMPLOYEE')")
  public ProposalService.ProposalView withdraw(
      @PathVariable UUID id,
      @RequestHeader(name = "If-Match", required = false) String ifMatch) {
    return proposals.withdraw(id, ifMatch, scopeGuard.principal());
  }
}
