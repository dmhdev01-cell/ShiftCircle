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
  void aMissingSecretExplainsWhatToDo() {
    assertThatThrownBy(() -> new JwtService(""))
        .as("a raw unresolved placeholder must not be what a person sees")
        .hasMessageContaining("SC_JWT_SECRET is not set")
        .hasMessageContaining(".env.example");
  }

  @Test
  void aShortSecretExplainsWhatToDo() {
    assertThatThrownBy(() -> new JwtService("too-short"))
        .hasMessageContaining("SC_JWT_SECRET is too short")
        .hasMessageContaining("32");
  }

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

  private static final String SECRET = "test-jwt-secret-that-is-at-least-32-bytes-long";

  private static String craft(String headerJson, String payloadJson, boolean withSignature) {
    String header = java.util.Base64.getUrlEncoder().withoutPadding()
        .encodeToString(headerJson.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    String body = java.util.Base64.getUrlEncoder().withoutPadding()
        .encodeToString(payloadJson.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    if (!withSignature) {
      return header + "." + body + ".";
    }
    try {
      javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
      mac.init(new javax.crypto.spec.SecretKeySpec(
          SECRET.getBytes(java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"));
      byte[] signature = mac.doFinal((header + "." + body)
          .getBytes(java.nio.charset.StandardCharsets.UTF_8));
      return header + "." + body + "." + java.util.Base64.getUrlEncoder().withoutPadding()
          .encodeToString(signature);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @Test
  void rejectsATokenWithoutAnExpiry() {
    String token = craft("{\"alg\":\"HS256\"}", "{\"sub\":\"m.ellis\"}", true);

    assertThatThrownBy(() -> service.verify(token))
        .isInstanceOf(JwtService.InvalidTokenException.class);
  }

  @Test
  void rejectsANonNumericExpiry() {
    String token = craft("{\"alg\":\"HS256\"}", "{\"sub\":\"m.ellis\",\"exp\":\"tomorrow\"}",
        true);

    assertThatThrownBy(() -> service.verify(token))
        .isInstanceOf(JwtService.InvalidTokenException.class);
  }

  @Test
  void rejectsANonStringSubject() {
    String token = craft("{\"alg\":\"HS256\"}", "{\"sub\":42,\"exp\":9999999999}", true);

    assertThatThrownBy(() -> service.verify(token))
        .isInstanceOf(JwtService.InvalidTokenException.class);
  }

  @Test
  void rejectsABadEmployeeIdClaim() {
    String token =
        craft("{\"alg\":\"HS256\"}",
            "{\"sub\":\"m.ellis\",\"exp\":9999999999,\"employeeId\":\"not-a-uuid\"}", true);

    assertThatThrownBy(() -> service.verify(token))
        .isInstanceOf(JwtService.InvalidTokenException.class);
  }

  @Test
  void ignoresTheAlgHeaderAndAlwaysAppliesTheHmac() {
    // A valid HMAC over an "alg":"none" header is just a token: the header cannot change the check.
    String signed = craft("{\"alg\":\"none\"}", "{\"sub\":\"m.ellis\",\"exp\":9999999999}", true);
    assertThat(service.verify(signed).username()).isEqualTo("m.ellis");

    String unsigned = craft("{\"alg\":\"none\"}", "{\"sub\":\"m.ellis\",\"exp\":9999999999}", false);
    assertThatThrownBy(() -> service.verify(unsigned))
        .isInstanceOf(JwtService.InvalidTokenException.class);
  }

  @Test
  void rejectsAShortKeyAtConstruction() {
    assertThatThrownBy(() -> new JwtService("too-short"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("32");
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
