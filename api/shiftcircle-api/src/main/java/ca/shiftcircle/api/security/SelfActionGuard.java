package ca.shiftcircle.api.security;

import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * "You can't act on your own record" in one place.
 *
 * <p>Shift proposals use it so nobody approves their own proposal (the decider's employee can't be
 * the proposer's), and the supervisors' self-edit guard uses the same predicate, so the two features
 * cannot drift apart on what "yourself" means. It lives here, in a neutral package, so neither
 * feature owns it. An account with no linked employee is never "the same person" as anyone.
 */
public final class SelfActionGuard {

  private SelfActionGuard() {}

  /** True when the signed-in account is the officer the record belongs to. */
  public static boolean isSelf(AuthPrincipal principal, UUID employeeId) {
    return principal != null
        && employeeId != null
        && employeeId.equals(principal.employeeId());
  }

  /** Refuses with 403 and the given plain-words message when the record is the caller's own. */
  public static void requireNotSelf(AuthPrincipal principal, UUID employeeId, String message) {
    if (isSelf(principal, employeeId)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, message);
    }
  }
}
