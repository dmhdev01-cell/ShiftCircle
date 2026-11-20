package ca.shiftcircle.api.rulesets;

import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Rule administration endpoints (docs/07 §4.7): versions, the decision-table grid, the safe build
 * pipeline, maker/checker approval and publish. Roles are enforced here; the service enforces the
 * state transitions and maker/checker.
 */
@RestController
@RequestMapping("/api/v1")
public class RuleSetController {

  public record DraftRequest(Integer basedOn, String reason) {}

  public record RowsRequest(List<RuleSetService.RowView> rows) {}

  public record PublishRequest(String effectiveDate) {}

  public record RejectRequest(String reason) {}

  private final RuleSetService ruleSets;
  private final ScopeGuard scopeGuard;

  public RuleSetController(RuleSetService ruleSets, ScopeGuard scopeGuard) {
    this.ruleSets = ruleSets;
    this.scopeGuard = scopeGuard;
  }

  @GetMapping("/rule-sets")
  @PreAuthorize("hasAnyRole('SUPERVISOR','RULES_ADMIN','RULES_APPROVER','AUDITOR')")
  public List<RuleSetService.VersionView> versions() {
    return ruleSets.versions();
  }

  @GetMapping("/rule-sets/{version}/tables/{code}")
  @PreAuthorize("hasAnyRole('SUPERVISOR','RULES_ADMIN','RULES_APPROVER','AUDITOR')")
  public RuleSetService.TableView table(@PathVariable int version, @PathVariable String code) {
    return ruleSets.table(version, code);
  }

  @PostMapping("/rule-sets/drafts")
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize("hasRole('RULES_ADMIN')")
  public RuleSetService.VersionView draft(@RequestBody DraftRequest request) {
    AuthPrincipal principal = scopeGuard.principal();
    return ruleSets.createDraft(request.basedOn(), request.reason(), principal);
  }

  @PutMapping("/rule-sets/{version}/tables/{code}/rows")
  @PreAuthorize("hasRole('RULES_ADMIN')")
  public RuleSetService.TableView saveRows(
      @PathVariable int version, @PathVariable String code, @RequestBody RowsRequest request) {
    AuthPrincipal principal = scopeGuard.principal();
    return ruleSets.saveRows(version, code, request.rows(), principal);
  }

  @PostMapping("/rule-sets/{version}/build")
  @PreAuthorize("hasRole('RULES_ADMIN')")
  public RuleSetService.BuildReportView build(@PathVariable int version) {
    return ruleSets.build(version, scopeGuard.principal());
  }

  @PostMapping("/rule-sets/{version}/submit")
  @PreAuthorize("hasRole('RULES_ADMIN')")
  public RuleSetService.VersionView submit(@PathVariable int version) {
    return ruleSets.submit(version, scopeGuard.principal());
  }

  @PostMapping("/rule-sets/{version}/approve")
  @PreAuthorize("hasRole('RULES_APPROVER')")
  public RuleSetService.VersionView approve(@PathVariable int version) {
    return ruleSets.approve(version, scopeGuard.principal());
  }

  @PostMapping("/rule-sets/{version}/reject")
  @PreAuthorize("hasRole('RULES_APPROVER')")
  public RuleSetService.VersionView reject(
      @PathVariable int version, @RequestBody RejectRequest request) {
    return ruleSets.reject(version, request.reason(), scopeGuard.principal());
  }

  @PostMapping("/rule-sets/{version}/publish")
  @PreAuthorize("hasRole('RULES_APPROVER')")
  public RuleSetService.VersionView publish(
      @PathVariable int version,
      @RequestBody(required = false) PublishRequest request) {
    LocalDate effective;
    try {
      effective =
          request == null || request.effectiveDate() == null
              ? null
              : LocalDate.parse(request.effectiveDate());
    } catch (java.time.format.DateTimeParseException notADate) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "effectiveDate must be a date like 2026-11-20");
    }
    return ruleSets.publish(version, effective, scopeGuard.principal());
  }
}
