package ca.shiftcircle.api.payroll;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import ca.shiftcircle.infrastructure.demo.DemoDataGenerator;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

/**
 * T8: the payroll export for the locked period 26 Oct – 8 Nov 2026 (planted case PC-05) equals the
 * checked-in golden CSV, and its totals equal the actual time entries.
 *
 * <p>The dataset is the demo generator's (seed 20261001, today 2026-11-19), so the golden file is
 * reproducible. The per-officer totals are re-derived from the database here rather than trusted:
 * every employee's CSV hours equal the sum of that employee's actual hours, and the overtime rows
 * are exactly the hours beyond the 80 h threshold (P-01) with the P-04 30-minute minimum applied.
 *
 * <p>Hand-checked when the file was generated (2026-11-20, dev-build2), against the time entries:
 * E-001 works exactly 80.00 h and has no overtime row; E-002 works 80.48 h and is all regular
 * because the 0.48 h beyond the threshold is under P-04's 30-minute minimum; E-003 works 84.00 h
 * with 4.00 h at OT15, the structural overtime ADR-020 describes (84 h less the 80 h threshold).
 * The file's grand total equals the sum of every worked hour.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class PayrollExportGoldenTest {

  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer("postgres:17-alpine").withDatabaseName("shiftcircle");

  static {
    POSTGRES.start();
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();

  private static final java.time.LocalDate PERIOD_START = java.time.LocalDate.of(2026, 10, 26);

  @BeforeEach
  void generateDemoData() {
    new DemoDataGenerator(jdbc, environment).generateIfEmpty();
  }

  private String login(String username) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"" + username + "\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(response.statusCode()).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private HttpResponse<String> get(String path, String token) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    return client.send(
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .header("Authorization", "Bearer " + token)
            .GET()
            .build(),
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  @Test
  @SuppressWarnings("unchecked")
  void theLockedPeriodsExportMatchesTheGoldenFileAndTheActualHours() throws Exception {
    String token = login("m.ellis");

    HttpResponse<String> periods = get("/api/v1/pay-periods", token);
    assertThat(periods.statusCode()).isEqualTo(200);
    Map<String, Object> period = null;
    for (Object entry : mapper.readValue(periods.body(), List.class)) {
      Map<String, Object> candidate = (Map<String, Object>) entry;
      if (PERIOD_START.toString().equals(candidate.get("from"))) {
        period = candidate;
        break;
      }
    }
    assertThat(period).as("period 26 Oct – 8 Nov").isNotNull();
    assertThat(period.get("label")).isEqualTo("26 Oct – 8 Nov 2026");
    assertThat(period.get("status")).isEqualTo("LOCKED");
    assertThat(((Number) period.get("overtimeThresholdHours")).doubleValue()).isEqualTo(80.0);

    UUID periodId = UUID.fromString((String) period.get("id"));
    HttpResponse<String> exported =
        get("/api/v1/pay-periods/" + periodId + "/payroll-export", token);
    assertThat(exported.statusCode()).isEqualTo(200);

    String csv = exported.body();
    Path actual = Path.of("target", "payroll-2026-10-26-actual.csv");
    Files.createDirectories(actual.getParent());
    Files.writeString(actual, csv, StandardCharsets.UTF_8);

    String golden =
        new String(
            getClass().getResourceAsStream("/payroll/pc05-2026-10-26.csv").readAllBytes(),
            StandardCharsets.UTF_8);
    assertThat(csv).as("actual CSV written to %s", actual.toAbsolutePath()).isEqualTo(golden);

    // Totals: per employee, the CSV hours equal the actual time entries.
    Map<String, Double> csvHours = new LinkedHashMap<>();
    Map<String, Double> csvOvertime = new LinkedHashMap<>();
    List<String> lines = csv.lines().skip(1).toList();
    for (String line : lines) {
      String[] cells = line.split(",", -1);
      // Absence rows carry the absence code; they are not worked hours and do
      // not move the overtime threshold.
      if (!List.of("SICK", "VAC").contains(cells[4])) {
        csvHours.merge(cells[0], Double.parseDouble(cells[5]), Double::sum);
      }
      if ("OT15".equals(cells[4])) {
        csvOvertime.merge(cells[0], Double.parseDouble(cells[5]), Double::sum);
      }
    }

    Map<String, Double> actualHours =
        jdbc.query(
                "SELECT e.employee_no, sum(te.hours) AS h FROM time_entry te"
                    + " JOIN employee e ON e.id = te.employee_id"
                    + " WHERE te.pay_period_id = ? AND te.absence_type IS NULL"
                    + " GROUP BY e.employee_no",
                (rs, index) -> Map.entry(rs.getString("employee_no"), rs.getDouble("h")),
                periodId)
            .stream()
            .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));

    assertThat(csvHours.keySet()).isEqualTo(actualHours.keySet());
    csvHours.forEach(
        (employeeNo, hours) ->
            assertThat(hours)
                .as("CSV hours for %s", employeeNo)
                .isCloseTo(actualHours.get(employeeNo), within(0.02)));

    // Overtime is only the hours beyond 80, with P-04's 30-minute minimum applied.
    csvHours.forEach(
        (employeeNo, total) -> {
          double beyond = Math.max(0, total - 80.0);
          double expectedOvertime = beyond >= 0.5 ? beyond : 0.0;
          assertThat(csvOvertime.getOrDefault(employeeNo, 0.0))
              .as("overtime hours for %s (%.2f h worked)", employeeNo, total)
              .isCloseTo(expectedOvertime, within(0.02));
        });

    // The file's grand total equals every actual hour in the period.
    double csvTotal = csvHours.values().stream().mapToDouble(Double::doubleValue).sum();
    double dbTotal =
        ((Number)
                jdbc.queryForMap(
                        "SELECT coalesce(sum(hours), 0) AS h FROM time_entry"
                            + " WHERE pay_period_id = ? AND absence_type IS NULL",
                        periodId)
                    .get("h"))
            .doubleValue();
    assertThat(csvTotal).isCloseTo(dbTotal, within(0.05));

    // The export record proves what was sent.
    String hash =
        HexFormat.of()
            .formatHex(
                MessageDigest.getInstance("SHA-256").digest(csv.getBytes(StandardCharsets.UTF_8)));
    Map<String, Object> export =
        jdbc.queryForMap(
            "SELECT row_count, file_sha256 FROM payroll_export WHERE pay_period_id = ?"
                + " ORDER BY generated_at DESC LIMIT 1",
            periodId);
    assertThat(export.get("file_sha256")).isEqualTo(hash);
    assertThat(((Number) export.get("row_count")).intValue()).isEqualTo(lines.size());

    List<String> employees = new ArrayList<>(csvHours.keySet());
    assertThat(employees).isNotEmpty();
  }
}
