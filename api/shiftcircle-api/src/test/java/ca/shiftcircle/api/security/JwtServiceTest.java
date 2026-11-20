package ca.shiftcircle.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class JwtServiceTest {

  private final JwtService service =
      new JwtService("test-jwt-secret-that-is-at-least-32-bytes-long");

  @Test
  void roundTripsThePrincipal() {
    AuthPrincipal principal =
        new AuthPrincipal(
            "m.ellis", "M. Ellis", List.of("SUPERVISOR", "EMPLOYEE"), List.of("A", "B"), null);

    AuthPrincipal verified = service.verify(service.sign(principal));

    assertThat(verified.username()).isEqualTo("m.ellis");
    assertThat(verified.displayName()).isEqualTo("M. Ellis");
    assertThat(verified.roles()).containsExactly("SUPERVISOR", "EMPLOYEE");
    assertThat(verified.units()).containsExactly("A", "B");
    assertThat(verified.employeeId()).isNull();
  }

  @Test
  void roundTripsALinkedEmployee() {
    UUID employee = UUID.randomUUID();
    AuthPrincipal principal = new AuthPrincipal("t.nakamura", "T. Nakamura", List.of("EMPLOYEE"),
        List.of(), employee);

    assertThat(service.verify(service.sign(principal)).employeeId()).isEqualTo(employee);
  }

  @Test
  void rejectsATamperedSignature() {
    String token = service.sign(new AuthPrincipal("m.ellis", "M. Ellis", List.of("SUPERVISOR"),
        List.of("A"), null));
    String tampered = token.substring(0, token.length() - 2) + "xx";

    assertThatThrownBy(() -> service.verify(tampered))
        .isInstanceOf(JwtService.InvalidTokenException.class);
  }

  @Test
  void rejectsAnotherKey() {
    JwtService other = new JwtService("another-secret-that-is-also-at-least-32-bytes");
    String token = other.sign(new AuthPrincipal("m.ellis", "M. Ellis", List.of("SUPERVISOR"),
        List.of("A"), null));

    assertThatThrownBy(() -> service.verify(token))
        .isInstanceOf(JwtService.InvalidTokenException.class);
  }
}
