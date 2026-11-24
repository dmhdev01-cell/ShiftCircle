package ca.shiftcircle.api.proposals;

import ca.shiftcircle.api.security.ScopeGuard;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
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

/**
 * Shift proposals (docs/07 §4.4). The officer's side (P1): the proposer is always the caller. The
 * decider's side (P2): a supervisor for the items on units in scope, the planner for all.
 */
@RestController
@RequestMapping("/api/v1")
public class ProposalController {

  private final ProposalService proposals;
  private final ProposalDecisionService decisions;
  private final ScopeGuard scopeGuard;

  public ProposalController(
      ProposalService proposals, ProposalDecisionService decisions, ScopeGuard scopeGuard) {
    this.proposals = proposals;
    this.decisions = decisions;
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

  // ---------------------------------------------------------------------------------------------
  // The decider's side (v1.3 P2)
  // ---------------------------------------------------------------------------------------------

  @GetMapping("/proposals")
  @PreAuthorize("hasAnyRole('SUPERVISOR','PLANNER')")
  public List<ProposalDecisionService.InboxCard> inbox(
      @RequestParam(name = "status", required = false) String status,
      @RequestParam(name = "unitId", required = false) UUID unitId,
      @RequestParam(name = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate from,
      @RequestParam(name = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate to) {
    return decisions.inbox(status, unitId, from, to, scopeGuard.principal());
  }

  @GetMapping("/proposals/count")
  @PreAuthorize("hasAnyRole('SUPERVISOR','PLANNER')")
  public ProposalDecisionService.CountView count(
      @RequestParam(name = "status", required = false) String status) {
    return decisions.count(status, scopeGuard.principal());
  }

  @GetMapping("/proposals/{id}")
  @PreAuthorize("hasAnyRole('SUPERVISOR','PLANNER')")
  public ProposalDecisionService.DetailView detail(@PathVariable UUID id) {
    return decisions.detail(id, scopeGuard.principal());
  }

  @PostMapping("/proposals/{id}/decision")
  @PreAuthorize("hasAnyRole('SUPERVISOR','PLANNER')")
  public ProposalDecisionService.DetailView decide(
      @PathVariable UUID id,
      @RequestHeader(name = "If-Match", required = false) String ifMatch,
      @RequestBody ProposalDecisionService.DecisionRequest request) {
    return decisions.decide(id, ifMatch, request, scopeGuard.principal());
  }
}
