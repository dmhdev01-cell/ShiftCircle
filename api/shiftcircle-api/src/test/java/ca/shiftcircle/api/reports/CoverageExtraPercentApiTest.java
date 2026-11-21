package ca.shiftcircle.api.reports;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/** Observation 31: coverage carries the overtime share and the axis cannot clip the regular part. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.today=2026-11-19")
@ActiveProfiles("demo")
class CoverageExtraPercentApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;

  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();
  private String token;

  @BeforeAll
  void login() throws Exception {
    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(
                    URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"a.reviewer\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(response.statusCode()).isEqualTo(200);
    token = (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  @Test
  void everyWeekCarriesTheOvertimeShareAndTheAxisIncludesTheRegularPart() throws Exception {
    String from = "2026-10-01";
    String to = "2026-12-29";
    Map<String, Object> report = report(from, to);
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> weeks = (List<Map<String, Object>>) report.get("weeks");

    double extraSum = 0;
    double minRegular = Double.MAX_VALUE;
    for (Map<String, Object> week : weeks) {
      double required = ((Number) week.get("requiredHours")).doubleValue();
      double scheduled = ((Number) week.get("scheduledPercent")).doubleValue();
      double extraHours = ((Number) week.get("extraHours")).doubleValue();
      double extraPercent = ((Number) week.get("extraPercent")).doubleValue();
      double expected = required > 0 ? extraHours / required * 100.0 : 0.0;
      assertThat(extraPercent)
          .as("week %s extraPercent = extraHours / requiredHours", week.get("label"))
          .isCloseTo(expected, org.assertj.core.data.Offset.offset(0.011));
      assertThat(extraPercent).isGreaterThanOrEqualTo(0.0);
      extraSum += extraHours;
      minRegular = Math.min(minRegular, scheduled - extraPercent);
    }
    assertThat(((Number) report.get("axisFrom")).doubleValue())
        .as("the axis floor cannot clip the regular segment")
        .isLessThanOrEqualTo(minRegular);

    double sqlExtra = sqlExtraHours(from, to);
    assertThat(extraSum)
        .as("weekly extraHours sums to the non-cancelled EXTRA/Overtime-offer assignment hours")
        .isCloseTo(sqlExtra, org.assertj.core.data.Offset.offset(0.05));
    assertThat(extraSum).as("the demo has extra shifts").isPositive();
  }

  private Map<String, Object> report(String from, String to) throws Exception {
    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(
                    URI.create(
                        "http://localhost:"
                            + port
                            + "/api/v1/reports/coverage?from="
                            + from
                            + "&to="
                            + to))
                .header("Authorization", "Bearer " + token)
                .GET()
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return mapper.readValue(response.body(), Map.class);
  }

  private double sqlExtraHours(String from, String to) {
    Instant start = LocalDate.parse(from).atStartOfDay(java.time.ZoneId.of("America/Regina")).toInstant();
    Instant end =
        LocalDate.parse(to).plusDays(1).atStartOfDay(java.time.ZoneId.of("America/Regina")).toInstant();
    Double hours =
        jdbc.queryForObject(
            "SELECT coalesce(sum(extract(epoch from"
                + " (least(end_at, ?) - greatest(start_at, ?))) / 3600.0), 0)"
                + " FROM shift_assignment WHERE status <> 'CANCELLED'"
                + " AND (kind = 'EXTRA' OR source = 'OVERTIME_OFFER')"
                + " AND start_at < ? AND end_at > ?",
            Double.class,
            Timestamp.from(end),
            Timestamp.from(start),
            Timestamp.from(end),
            Timestamp.from(start));
    return hours == null ? 0 : hours;
  }
}
