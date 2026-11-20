package ca.shiftcircle.api.security;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Minimal HS256 JWT signing and verification for the mock sign-in (docs/09 §4).
 *
 * <p>The API validates the token exactly as it would an identity provider's token; only the issuer is
 * fake. Implemented with the JDK instead of adding a JWT dependency: the format is compact, the key
 * comes from {@code SC_JWT_SECRET}, and the constant-time signature check is easy to audit.
 */
@Service
public class JwtService {

  public static final Duration LIFETIME = Duration.ofHours(8);

  private final byte[] key;
  private final ObjectMapper mapper = new ObjectMapper();

  public JwtService(@Value("${SC_JWT_SECRET}") String secret) {
    if (secret == null || secret.length() < 32) {
      // The API already refuses to start without a 32-byte secret; the invariant is repeated here
      // so a mis-wired test or tool cannot sign with a weak key (review A2).
      throw new IllegalStateException("SC_JWT_SECRET must be at least 32 characters");
    }
    this.key = secret.getBytes(StandardCharsets.UTF_8);
  }

  public String sign(AuthPrincipal principal) {
    Instant now = Instant.now();
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("sub", principal.username());
    payload.put("name", principal.displayName());
    payload.put("roles", principal.roles());
    payload.put("units", principal.units());
    if (principal.employeeId() != null) {
      payload.put("employeeId", principal.employeeId().toString());
    }
    payload.put("iat", now.getEpochSecond());
    payload.put("exp", now.plus(LIFETIME).getEpochSecond());

    String header = base64("{\"alg\":\"HS256\",\"typ\":\"JWT\"}");
    String body = base64(mapper.writeValueAsString(payload));
    return header + "." + body + "." + base64(signature(header + "." + body));
  }

  /**
   * Verifies signature and expiry; returns the principal or throws {@link InvalidTokenException}.
   *
   * <p>The JOSE header is deliberately ignored: HMAC-SHA256 is always applied, so "alg": "none" or
   * any other header cannot change how the token is checked (review A3). Any malformed or missing
   * claim is a token failure, never a 500 (review A1).
   */
  public AuthPrincipal verify(String token) {
    String[] parts = token.split("\\.");
    if (parts.length != 3) {
      throw new InvalidTokenException("Malformed token");
    }
    byte[] expected = signature(parts[0] + "." + parts[1]);
    byte[] actual;
    try {
      actual = Base64.getUrlDecoder().decode(parts[2]);
    } catch (IllegalArgumentException e) {
      throw new InvalidTokenException("Malformed signature");
    }
    if (!java.security.MessageDigest.isEqual(expected, actual)) {
      throw new InvalidTokenException("Bad signature");
    }

    Map<String, Object> payload = readPayload(parts[1]);

    try {
      Object rawExpiry = payload.get("exp");
      if (!(rawExpiry instanceof Number expiry)) {
        throw new InvalidTokenException("Missing or malformed exp claim");
      }
      if (Instant.now().getEpochSecond() >= expiry.longValue()) {
        throw new InvalidTokenException("Token expired");
      }

      Object rawSubject = payload.get("sub");
      if (!(rawSubject instanceof String subject) || subject.isBlank()) {
        throw new InvalidTokenException("Missing or malformed sub claim");
      }
      Object rawName = payload.get("name");
      String name = rawName instanceof String text && !text.isBlank() ? text : subject;

      Object rawEmployee = payload.get("employeeId");
      java.util.UUID employeeId = null;
      if (rawEmployee != null) {
        if (!(rawEmployee instanceof String employeeText)) {
          throw new InvalidTokenException("Malformed employeeId claim");
        }
        try {
          employeeId = java.util.UUID.fromString(employeeText);
        } catch (IllegalArgumentException e) {
          throw new InvalidTokenException("Malformed employeeId claim");
        }
      }

      return new AuthPrincipal(
          subject, name, stringList(payload.get("roles")), stringList(payload.get("units")),
          employeeId);
    } catch (InvalidTokenException e) {
      throw e;
    } catch (RuntimeException e) {
      throw new InvalidTokenException("Malformed claims");
    }
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> readPayload(String encoded) {
    try {
      return mapper.readValue(Base64.getUrlDecoder().decode(encoded), Map.class);
    } catch (RuntimeException e) {
      throw new InvalidTokenException("Malformed payload");
    }
  }

  private static List<String> stringList(Object value) {
    if (value instanceof List<?> list) {
      return list.stream().map(String::valueOf).toList();
    }
    return List.of();
  }

  private byte[] signature(String content) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      return mac.doFinal(content.getBytes(StandardCharsets.UTF_8));
    } catch (Exception e) {
      throw new IllegalStateException("HMAC unavailable", e);
    }
  }

  private static String base64(String value) {
    return base64(value.getBytes(StandardCharsets.UTF_8));
  }

  private static String base64(byte[] value) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
  }

  /** Raised for any token that must not authenticate a request. */
  public static class InvalidTokenException extends RuntimeException {
    public InvalidTokenException(String message) {
      super(message);
    }
  }
}
