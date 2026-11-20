package ca.shiftcircle.api.auth;

import ca.shiftcircle.api.security.AuthPrincipal;
import ca.shiftcircle.api.security.JwtService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Mock sign-in (docs/09 §4). The demo profile only: a real deployment uses government SSO and these
 * endpoints do not exist.
 */
@RestController
@RequestMapping("/api/v1/auth")
@Profile("demo")
public class AuthController {

  private final UserDirectory directory;
  private final JwtService jwtService;

  public AuthController(UserDirectory directory, JwtService jwtService) {
    this.directory = directory;
    this.jwtService = jwtService;
  }

  @GetMapping("/demo-users")
  public List<Map<String, Object>> demoUsers() {
    return directory.users().stream().map(AuthController::describe).toList();
  }

  @PostMapping("/mock-login")
  public Map<String, Object> mockLogin(@RequestBody Map<String, String> body) {
    String id = body.get("userId");
    if (id == null || id.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "userId is required");
    }
    UserDirectory.DemoUser user = directory.find(id);
    if (user == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Demo user not found");
    }

    AuthPrincipal principal =
        new AuthPrincipal(
            user.username(),
            user.displayName(),
            user.roles(),
            user.units(),
            user.employeeId());
    return Map.of(
        "token", jwtService.sign(principal),
        "expiresAt", Instant.now().plus(JwtService.LIFETIME).toString(),
        "user", describe(user));
  }

  private static Map<String, Object> describe(UserDirectory.DemoUser user) {
    return Map.of(
        "id", user.id().toString(),
        "username", user.username(),
        "displayName", user.displayName(),
        "roles", user.roles(),
        "units", user.units(),
        "employeeId", user.employeeId() == null ? "" : user.employeeId().toString());
  }
}
