package ca.shiftcircle.api;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * One PostgreSQL 17 container shared by every Spring test in this module, so the api context boots
 * against a real database and Flyway applies V1–V3 exactly as it does in the container.
 *
 * <p>Testcontainers needs the Docker socket; the {@code api-test} compose profile mounts it.
 */
public final class PostgresTestSupport {

  private static PostgreSQLContainer postgres;

  private PostgresTestSupport() {}

  public static synchronized PostgreSQLContainer postgres() {
    if (postgres == null) {
      postgres =
          new PostgreSQLContainer("postgres:17-alpine").withDatabaseName("shiftcircle");
      postgres.start();
    }
    return postgres;
  }

  public static void register(DynamicPropertyRegistry registry) {
    PostgreSQLContainer container = postgres();
    registry.add("spring.datasource.url", container::getJdbcUrl);
    registry.add("spring.datasource.username", container::getUsername);
    registry.add("spring.datasource.password", container::getPassword);
  }
}
