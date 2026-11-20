package ca.shiftcircle.api.schedule;

import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.ScopeGuard;
import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** The planning board's read endpoint (docs/07 §4.2). */
@RestController
@RequestMapping("/api/v1")
public class ScheduleController {

  private static final int MAX_DAYS = 31;

  private final ScheduleQuery scheduleQuery;
  private final MyScheduleQuery myScheduleQuery;
  private final ScopeGuard scopeGuard;

  public ScheduleController(
      ScheduleQuery scheduleQuery, MyScheduleQuery myScheduleQuery, ScopeGuard scopeGuard) {
    this.scheduleQuery = scheduleQuery;
    this.myScheduleQuery = myScheduleQuery;
    this.scopeGuard = scopeGuard;
  }

  @GetMapping("/me/schedule")
  public MyScheduleQuery.MySchedulePayload mySchedule(
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
    return myScheduleQuery.forEmployee(scopeGuard.principal(), from, to);
  }

  @GetMapping("/schedule")
  @PreAuthorize("hasAnyRole('SUPERVISOR','AUDITOR')")
  public ScheduleQuery.SchedulePayload schedule(
      @RequestParam UUID unitId,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
      HttpServletRequest request) {
    if (to.isBefore(from) || ChronoUnit.DAYS.between(from, to) > MAX_DAYS) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "from and to must span at most " + MAX_DAYS + " days, in order");
    }

    AuthPrincipal principal = scopeGuard.principal();
    scopeGuard.requireUnit(principal, scheduleQuery.unitCode(unitId));
    return scheduleQuery.forUnit(unitId, from, to);
  }
}
