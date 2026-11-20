package ca.shiftcircle.api.performance;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * NFR-05 on the full demo dataset (docs/02 §5, docs/10 §7): the planning board, a rule check, a
 * 90-day report and a rule-set publish. Medians of 20 calls after 5 warm-up calls, with p95.
 *
 * <p>The limits are the NFR itself, not tuned to this host: the machine here is a Docker Desktop VM
 * on macOS, which is slower than the target, so a pass here is a pessimistic result. The measured
 * numbers are recorded in docs/10.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("demo")
class PerformanceSmokeTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");
  private static final UUID UNIT_B = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final int WARMUP = 5;
  private static final int SAMPLES = 20;

  /** NFR-05 limits in milliseconds. */
  private static final long SCHEDULE_LIMIT = 1_000;
  private static final long RULE_CHECK_LIMIT = 200;
  private static final long REPORT_LIMIT = 2_000;

  @BeforeAll
  void fixture() throws Exception {
    for (String user : new String[] {"m.ellis", "l.fraser", "p.singh"}) {
      tokens.put(user, login(user));
    }
  }

  @FunctionalInterface
  interface Call {
    HttpResponse<String> run() throws Exception;
  }

  @Test
  void nfr05TheHeavyScreensMeetTheirLimits() throws Exception {
    // A four-week board for Unit A, the biggest unit.
    String schedule = "/api/v1/schedule?unitId=" + UNIT_A + "&from=2026-11-02&to=2026-11-29";
    long[] scheduleMs = measure("schedule", () -> get(schedule, "m.ellis"));
    assertLimit("planning board", scheduleMs, SCHEDULE_LIMIT);

    // A rule check for the officer with the most shifts in the 28-day look-back.
    Map<String, Object> busiest =
        jdbc.queryForMap(
            "SELECT employee_id, count(*) AS n FROM shift_assignment"
                + " WHERE status <> 'CANCELLED' AND work_date BETWEEN DATE '2026-10-23' AND DATE"
                + " '2026-11-19' GROUP BY employee_id ORDER BY n DESC LIMIT 1");
    UUID officer = (UUID) busiest.get("employee_id");
    String change =
        "{\"change\":{\"employeeId\":\""
            + officer
            + "\",\"unitId\":\""
            + UNIT_B
            + "\",\"shiftTemplate\":\"D8\",\"startAt\":\"2026-11-20T07:00:00-06:00\"}}";
    long[] ruleMs = measure("rule-check", () -> post("/api/v1/rule-checks", change, "m.ellis"));
    assertLimit("rule check", ruleMs, RULE_CHECK_LIMIT);

    // The 90-day reports (coverage is the heaviest: it walks the hour slots).
    String coverage = "/api/v1/reports/coverage?from=2026-10-01&to=2026-12-29";
    long[] reportMs = measure("coverage report", () -> get(coverage, "m.ellis"));
    assertLimit("90-day coverage report", reportMs, REPORT_LIMIT);

    // The publish pipeline: compile Drools, run the scenarios, dry-run the roster, then swap.
    int published =
        jdbc.queryForObject(
            "SELECT max(version) FROM rule_set_version WHERE status = 'PUBLISHED'", Integer.class);
    int draft = createDraft(published);
    long buildMs = timed(() -> post("/api/v1/rule-sets/" + draft + "/build", "{}", "l.fraser"));
    assertThat(post("/api/v1/rule-sets/" + draft + "/submit", "{}", "l.fraser").statusCode())
        .isEqualTo(200);
    assertThat(post("/api/v1/rule-sets/" + draft + "/approve", "{}", "p.singh").statusCode())
        .isEqualTo(200);
    long publishMs =
        timed(
            () ->
                post(
                    "/api/v1/rule-sets/" + draft + "/publish",
                    "{\"effectiveDate\":\"2026-11-24\"}",
                    "p.singh"));
    assertThat(buildMs).as("a rule-set build compiles Drools and dry-runs the roster").isLessThan(15_000);
    assertThat(publishMs).as("publishing swaps a compiled rule base").isLessThan(5_000);

    System.out.println(
        String.format(
            "NFR-05 perf: schedule median=%d p95=%d ms; rule-check median=%d p95=%d ms;"
                + " coverage median=%d p95=%d ms; build=%d ms; publish=%d ms",
            median(scheduleMs), p95(scheduleMs), median(ruleMs), p95(ruleMs),
            median(reportMs), p95(reportMs), buildMs, publishMs));
  }

  private void assertLimit(String label, long[] samples, long limit) {
    assertThat(median(samples))
        .as("%s median %d ms must be under %d ms (p95 %d ms)", label, median(samples), limit,
            p95(samples))
        .isLessThan(limit);
    assertThat(p95(samples))
        .as("%s p95 %d ms must be under %d ms", label, p95(samples), limit)
        .isLessThan(limit);
  }

  private long[] measure(String label, Call call) throws Exception {
    for (int i = 0; i < WARMUP; i++) {
      HttpResponse<String> warm = call.run();
      assertThat(warm.statusCode()).as("warm-up %s: %s", label, warm.body()).isEqualTo(200);
    }
    long[] ms = new long[SAMPLES];
    for (int i = 0; i < SAMPLES; i++) {
      long start = System.nanoTime();
      HttpResponse<String> response = call.run();
      ms[i] = (System.nanoTime() - start) / 1_000_000;
      assertThat(response.statusCode())
          .as("%s sample %d: %s", label, i + 1, response.body())
          .isEqualTo(200);
    }
    return ms;
  }

  private long timed(Call call) throws Exception {
    long start = System.nanoTime();
    HttpResponse<String> response = call.run();
    long ms = (System.nanoTime() - start) / 1_000_000;
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return ms;
  }

  private static long median(long[] samples) {
    long[] sorted = samples.clone();
    Arrays.sort(sorted);
    return sorted[sorted.length / 2];
  }

  private static long p95(long[] samples) {
    long[] sorted = samples.clone();
    Arrays.sort(sorted);
    return sorted[(int) Math.ceil(sorted.length * 0.95) - 1];
  }

  private int createDraft(int basedOn) throws Exception {
    HttpResponse<String> created =
        post(
            "/api/v1/rule-sets/drafts",
            "{\"basedOn\":" + basedOn + ",\"reason\":\"NFR-05 performance smoke\"}",
            "l.fraser");
    assertThat(created.statusCode()).isEqualTo(201);
    return ((Number) mapper.readValue(created.body(), Map.class).get("version")).intValue();
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

  private HttpResponse<String> get(String path, String user) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET();
    if (user != null) {
      builder.header("Authorization", "Bearer " + tokens.get(user));
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private HttpResponse<String> post(String path, String body, String user) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body));
    if (user != null) {
      builder.header("Authorization", "Bearer " + tokens.get(user));
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
