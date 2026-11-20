package ca.shiftcircle.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * The seed rows in {@code V2__reference_data.sql} and the code fixture {@link RuleRowsV1} describe
 * the same published rule set, so they must not drift: the tests and the boot-time rule base use the
 * fixture, the database is the runtime source.
 *
 * <p>A drift here would mean the demo runs different rules from the ones the boundary tests proved.
 */
@Testcontainers
class ReferenceDataMatchesRuleRowsTest {

  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer("postgres:17-alpine").withDatabaseName("shiftcircle");

  @BeforeAll
  static void migrate() {
    Flyway.configure()
        .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
        .load()
        .migrate();
  }

  @Test
  void v1SeedRowsMatchTheCodeRuleSet() throws Exception {
    Map<String, Row> seeded = seededRows();
    Map<String, RuleRow> fixture =
        RuleRowsV1.ruleSet().rows().stream()
            .collect(Collectors.toMap(RuleRow::code, Function.identity()));

    assertThat(seeded.keySet()).isEqualTo(fixture.keySet());

    for (RuleRow expected : fixture.values()) {
      Row actual = seeded.get(expected.code());
      assertThat(actual.table).as(expected.code() + " table").isEqualTo(expected.table().code());
      assertThat(actual.severity).as(expected.code() + " severity").isEqualTo(expected.severity().name());
      assertThat(actual.overridePolicy)
          .as(expected.code() + " override policy")
          .isEqualTo(expected.overridePolicy().name());
      assertThat(actual.message).as(expected.code() + " message").isEqualTo(expected.message());
      assertThat(actual.source).as(expected.code() + " source").isEqualTo(expected.source());
      assertThat(actual.placeholder).as(expected.code() + " placeholder").isEqualTo(expected.placeholder());
      assertThat(actual.sortOrder).as(expected.code() + " sort order").isEqualTo(expected.sortOrder());
      assertThat(actual.params).as(expected.code() + " params").isEqualTo(normalise(expected.params()));
    }
  }

  private record Row(
      String table,
      String severity,
      String overridePolicy,
      String message,
      String source,
      boolean placeholder,
      int sortOrder,
      Map<String, String> params) {}

  private Map<String, Row> seededRows() throws SQLException {
    UUID version = publishedVersion();
    Map<String, Row> rows = new LinkedHashMap<>();
    try (Connection connection = connect();
        PreparedStatement statement =
            connection.prepareStatement(
                "SELECT r.code, t.code AS table_code, r.severity, r.override_policy, r.message,"
                    + " r.source, r.is_placeholder, r.sort_order"
                    + " FROM rule_row r JOIN rule_table t ON t.id = r.rule_table_id"
                    + " WHERE r.rule_set_version_id = ? ORDER BY r.sort_order")) {
      statement.setObject(1, version);
      try (ResultSet result = statement.executeQuery()) {
        while (result.next()) {
          String code = result.getString("code");
          rows.put(
              code,
              new Row(
                  result.getString("table_code"),
                  result.getString("severity"),
                  result.getString("override_policy"),
                  result.getString("message"),
                  result.getString("source"),
                  result.getBoolean("is_placeholder"),
                  result.getInt("sort_order"),
                  params(connection, version, code)));
        }
      }
    }
    return rows;
  }

  private Map<String, String> params(Connection connection, UUID version, String code)
      throws SQLException {
    Map<String, String> params = new TreeMap<>();
    try (PreparedStatement statement =
        connection.prepareStatement(
            "SELECT p.key, p.value FROM rule_row r, jsonb_each_text(r.params) AS p"
                + " WHERE r.rule_set_version_id = ? AND r.code = ?")) {
      statement.setObject(1, version);
      statement.setString(2, code);
      try (ResultSet result = statement.executeQuery()) {
        while (result.next()) {
          params.put(result.getString(1), result.getString(2));
        }
      }
    }
    return params;
  }

  private UUID publishedVersion() throws SQLException {
    try (Connection connection = connect();
        PreparedStatement statement =
            connection.prepareStatement(
                "SELECT id FROM rule_set_version WHERE status = 'PUBLISHED'")) {
      try (ResultSet result = statement.executeQuery()) {
        assertThat(result.next()).isTrue();
        return (UUID) result.getObject(1);
      }
    }
  }

  private static Connection connect() throws SQLException {
    return DriverManager.getConnection(
        POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
  }

  /** Turns the fixture's params into the text {@code jsonb_each_text} would return. */
  private static Map<String, String> normalise(Map<String, Object> params) {
    Map<String, String> normalised = new TreeMap<>();
    params.forEach((key, value) -> normalised.put(key, text(value)));
    return normalised;
  }

  private static String text(Object value) {
    return text(value, false);
  }

  private static String text(Object value, boolean quoteStrings) {
    if (value instanceof Collection<?> list) {
      return list.stream()
          .map(item -> text(item, true))
          .collect(Collectors.joining(", ", "[", "]"));
    }
    if (value instanceof String string && quoteStrings) {
      return "\"" + string + "\"";
    }
    if (value instanceof Double || value instanceof Float) {
      return String.format(Locale.ROOT, "%s", ((Number) value).doubleValue());
    }
    return String.valueOf(value);
  }
}
