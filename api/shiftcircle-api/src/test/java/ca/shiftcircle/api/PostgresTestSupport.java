package ca.shiftcircle.api;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * One PostgreSQL 17 container shared by every Spring test in this module, but a fresh database for
 * each test class.
 *
 * <p>The container is expensive; a database is not. Giving each class its own database means a class
 * that generates the demo roster, publishes a rule set or links an employee cannot change the
 * starting state of the next class. Class order stops mattering, which is what the reverse and
 * random-order runs check.
 *
 * <p>Testcontainers needs the Docker socket; the {@code api-test} compose profile mounts it.
 */
public final class PostgresTestSupport {

  private static final AtomicInteger DATABASES = new AtomicInteger();
  private static PostgreSQLContainer postgres;

  private PostgresTestSupport() {}

  public static synchronized PostgreSQLContainer postgres() {
    if (postgres == null) {
      // One container hosts a database per Spring test context and Spring's context cache keeps
      // those contexts (and their Hikari pools) alive. With a pool of 4 and 26+ contexts the
      // default max_connections=100 is exhausted ("sorry, too many clients already"), so give the
      // test server headroom instead of relying on a class order or a rerun.
      postgres =
          new PostgreSQLContainer("postgres:17-alpine")
              .withDatabaseName("shiftcircle")
              .withCommand("postgres", "-c", "max_connections=400");
      postgres.start();
    }
    return postgres;
  }

  /**
   * Register a datasource for this test class's own database. Flyway creates the schema on the
   * context start, exactly as it does in the production container.
   */
  public static void register(DynamicPropertyRegistry registry) {
    PostgreSQLContainer container = postgres();
    String database = "sc_test_" + DATABASES.incrementAndGet();
    String base = baseUrl(container);
    createDatabase(base, container.getUsername(), container.getPassword(), database);
    // The test database is local and TLS adds an SSL handshake that can flake while a dozen
    // contexts start under load; production keeps its own TLS settings.
    registry.add("spring.datasource.url", () -> base + "/" + database + "?sslmode=disable");
    registry.add("spring.datasource.username", container::getUsername);
    registry.add("spring.datasource.password", container::getPassword);
  }

  private static String baseUrl(PostgreSQLContainer container) {
    String url = container.getJdbcUrl();
    int path = url.indexOf('/', "jdbc:postgresql://".length());
    return url.substring(0, path);
  }

  private static void createDatabase(String base, String user, String password, String database) {
    try (Connection connection = DriverManager.getConnection(base + "/postgres?sslmode=disable", user, password);
        Statement statement = connection.createStatement()) {
      statement.execute("CREATE DATABASE " + database);
    } catch (SQLException e) {
      throw new IllegalStateException("Could not create test database " + database, e);
    }
  }
}
