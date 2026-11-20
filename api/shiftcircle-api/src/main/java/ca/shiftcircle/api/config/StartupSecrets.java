package ca.shiftcircle.api.config;

import org.springframework.core.env.Environment;

/**
 * Refuses to start without the two secrets the prototype needs (docs/08-deployment.md §4,
 * HANDOFF §5 guardrail 2): the database password and the token signing key.
 *
 * <p>There are deliberately no defaults. A missing secret is a startup failure with a message that
 * says what to do, never a silently weaker configuration.
 */
public final class StartupSecrets {

  public static final String POSTGRES_PASSWORD = "POSTGRES_PASSWORD";
  public static final String JWT_SECRET = "SC_JWT_SECRET";

  private static final int MIN_POSTGRES_PASSWORD_LENGTH = 8;
  private static final int MIN_JWT_SECRET_LENGTH = 32;

  private StartupSecrets() {}

  /** Validates both secrets; throws {@link IllegalStateException} with an actionable message. */
  public static void verify(Environment environment) {
    require(
        environment,
        POSTGRES_PASSWORD,
        MIN_POSTGRES_PASSWORD_LENGTH,
        "the PostgreSQL password used by the api and db containers");
    require(
        environment,
        JWT_SECRET,
        MIN_JWT_SECRET_LENGTH,
        "the signing key for mock sign-in tokens (32 bytes or more)");
  }

  private static void require(
      Environment environment, String name, int minLength, String purpose) {
    String value = environment.getProperty(name);
    if (value == null || value.isBlank()) {
      throw new IllegalStateException(
          "ShiftCircle API refuses to start: "
              + name
              + " is not set. It is "
              + purpose
              + ". Copy .env.example to .env and set it (docs/08-deployment.md §4).");
    }
    if (value.length() < minLength) {
      throw new IllegalStateException(
          "ShiftCircle API refuses to start: "
              + name
              + " is too short ("
              + value.length()
              + " characters, at least "
              + minLength
              + " required). It is "
              + purpose
              + ".");
    }
  }
}
