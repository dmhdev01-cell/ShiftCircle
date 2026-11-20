package ca.shiftcircle.api.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** The API must refuse to start without the two secrets (HANDOFF §5 guardrail 2). */
class StartupSecretsTest {

  private static final String POSTGRES_PASSWORD = "postgres-password-for-test";
  private static final String JWT_SECRET = "jwt-secret-for-test-at-least-32-bytes";

  private final ApplicationContextRunner runner =
      new ApplicationContextRunner().withUserConfiguration(StartupSecretsConfig.class);

  @Test
  void startsWhenBothSecretsAreSet() {
    runner
        .withPropertyValues(
            "POSTGRES_PASSWORD=" + POSTGRES_PASSWORD, "SC_JWT_SECRET=" + JWT_SECRET)
        .run(context -> assertThat(context).hasNotFailed());
  }

  @Test
  void refusesToStartWithoutTheDatabasePassword() {
    runner
        .withPropertyValues("SC_JWT_SECRET=" + JWT_SECRET)
        .run(
            context -> {
              assertThat(context).hasFailed();
              assertThat(context.getStartupFailure())
                  .hasStackTraceContaining("POSTGRES_PASSWORD is not set");
            });
  }

  @Test
  void refusesToStartWithoutTheJwtSecret() {
    runner
        .withPropertyValues("POSTGRES_PASSWORD=" + POSTGRES_PASSWORD)
        .run(
            context -> {
              assertThat(context).hasFailed();
              assertThat(context.getStartupFailure())
                  .hasStackTraceContaining("SC_JWT_SECRET is not set");
            });
  }

  @Test
  void refusesAShortJwtSecret() {
    runner
        .withPropertyValues(
            "POSTGRES_PASSWORD=" + POSTGRES_PASSWORD, "SC_JWT_SECRET=too-short")
        .run(
            context -> {
              assertThat(context).hasFailed();
              assertThat(context.getStartupFailure())
                  .hasStackTraceContaining("SC_JWT_SECRET is too short");
            });
  }
}
