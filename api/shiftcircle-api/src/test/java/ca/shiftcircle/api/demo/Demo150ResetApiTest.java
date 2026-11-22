package ca.shiftcircle.api.demo;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/** The 150 dataset: 120 full-time crews + 30 part-time on the 120 shape, with 20% leave. */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"sc.demo.generate=true", "sc.demo.today=2026-11-19"})
@ActiveProfiles("demo")
class Demo150ResetApiTest {

  private static final String CHECKSUM_150 =
      "2e6cd938254002892c06d9800652666e5a9e786f78f5ca2ed11c7005a987d7f8";
  private static final String PLAN_150_FINGERPRINT =
      "a1e093f7c3630371a0762067a8aed55d6ccb1b6f7a30372257e326d892ceb381";

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;

  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();
  private String planner;

  @BeforeEach
  void login() throws Exception {
    planner = login("p.planner");
  }

  @Test
  void resetsTo150TwiceWithStableNumbers() throws Exception {
    String first = reset();
    String second = reset();
    assertThat(second).as("the 150 dataset is deterministic").isEqualTo(first);
    assertThat(first).as("the 150 dataset checksum is pinned").isEqualTo(CHECKSUM_150);
    System.out.println("CHECKSUM150=" + first);

    assertThat(jdbc.queryForObject("SELECT count(*) FROM employee", Integer.class)).isEqualTo(150);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM employee WHERE fte = 1.0", Integer.class))
        .isEqualTo(120);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM employee WHERE fte < 1.0", Integer.class))
        .isEqualTo(30);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM employee e JOIN rotation_pattern r"
                    + " ON r.id = e.rotation_pattern_id WHERE r.code LIKE 'N12%'",
                Integer.class))
        .isEqualTo(50);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM employee e JOIN rotation_pattern r"
                    + " ON r.id = e.rotation_pattern_id WHERE r.code LIKE 'D12%'",
                Integer.class))
        .isEqualTo(67);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM employee e JOIN rotation_pattern r"
                    + " ON r.id = e.rotation_pattern_id WHERE r.code = 'E8_EVENING_5ON2OFF'",
                Integer.class))
        .isEqualTo(3);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM absence", Integer.class)).isGreaterThan(2000);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM unit_availability", Integer.class)).isZero();
    assertThat(jdbc.queryForObject("SELECT count(*) FROM unit_staffing", Integer.class)).isZero();

    UUID draft = generate();
    Map<String, Object> summary = draftSummary(draft);
    @SuppressWarnings("unchecked")
    Map<String, Object> scorecard = (Map<String, Object>) summary.get("scorecard");
    @SuppressWarnings("unchecked")
    Map<String, Object> coverage = (Map<String, Object>) scorecard.get("coverage");
    int gaps = ((Number) coverage.get("shortBlockDays")).intValue();
    int total = ((Number) coverage.get("totalBlockDays")).intValue();
    System.out.println(
        "PLAN150 gaps="
            + gaps
            + " total="
            + total
            + " warnings="
            + scorecard.get("warnings")
            + " shifts="
            + jdbc.queryForObject(
                "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ?",
                Integer.class,
                draft)
            + " officers="
            + jdbc.queryForObject(
                "SELECT count(DISTINCT employee_id) FROM plan_draft_assignment WHERE draft_id = ?",
                Integer.class,
                draft)
            + " fingerprint="
            + fingerprint(draft));
    int shifts =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ?", Integer.class, draft);
    int officers =
        jdbc.queryForObject(
            "SELECT count(DISTINCT employee_id) FROM plan_draft_assignment WHERE draft_id = ?",
            Integer.class,
            draft);
    @SuppressWarnings("unchecked")
    Map<String, Object> warnings = (Map<String, Object>) scorecard.get("warnings");
    @SuppressWarnings("unchecked")
    Map<String, Object> qualification = (Map<String, Object>) scorecard.get("qualification");
    assertThat(qualification).as("the qualification card is on the 150 scorecard").isNotNull();
    assertThat(((Number) qualification.get("failingBlockDays")).intValue())
        .as("the 150 qualification count is measured, not assumed")
        .isEqualTo(103);
    assertThat(((Number) qualification.get("checkedBlockDays")).intValue()).isEqualTo(1470);
    assertThat((String) qualification.get("sentence")).startsWith("103 block-days");
    assertThat(qualification.get("validFromRespected")).isEqualTo(false);
    assertThat(scorecard).doesNotContainKey("qualificationPolicy");
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> qualificationRows =
        (List<Map<String, Object>>) qualification.get("byUnitBlock");
    Map<String, Integer> failingByUnitBlock = new LinkedHashMap<>();
    for (Map<String, Object> row : qualificationRows) {
      int count = ((Number) row.get("failingBlockDays")).intValue();
      if (count > 0) {
        failingByUnitBlock.put(row.get("unitCode") + "/" + row.get("block"), count);
      }
    }
    assertThat(failingByUnitBlock)
        .containsExactlyInAnyOrderEntriesOf(
            Map.ofEntries(
                Map.entry("A/DAY", 16),
                Map.entry("A/NIGHT", 9),
                Map.entry("B/DAY", 9),
                Map.entry("B/NIGHT", 10),
                Map.entry("C/DAY", 22),
                Map.entry("C/EVENING", 1),
                Map.entry("C/NIGHT", 20),
                Map.entry("CTL/DAY", 2),
                Map.entry("CTL/NIGHT", 8),
                Map.entry("ESC/DAY", 2),
                Map.entry("ESC/NIGHT", 4)));

    assertThat(gaps).as("the 150 plan's short block-days are pinned").isEqualTo(100);
    assertThat(((Number) warnings.get("total")).intValue()).isEqualTo(39);
    assertThat(shifts).isEqualTo(5414);
    assertThat(officers).isEqualTo(150);
    assertThat(fingerprint(draft)).isEqualTo(PLAN_150_FINGERPRINT);
  }

  @Test
  void unitCMidQuarterCloseWorksOn150() throws Exception {
    reset();
    UUID unitC = jdbc.queryForObject("SELECT id FROM unit WHERE code = 'C'", UUID.class);
    HttpResponse<String> added =
        send(
            "POST",
            "/api/v1/planner/units/" + unitC + "/closures",
            "{\"closedFrom\":\"2027-02-15\",\"reason\":\"Renovation (150 test)\"}",
            planner);
    assertThat(added.statusCode()).as(added.body()).isEqualTo(201);
    UUID draft = generate();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ? AND unit_id = ?"
                    + " AND work_date >= DATE '2027-02-15'",
                Integer.class,
                draft,
                unitC))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM plan_draft_gap WHERE draft_id = ? AND unit_id = ?"
                    + " AND gap_date >= DATE '2027-02-15'",
                Integer.class,
                draft,
                unitC))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM plan_draft_assignment a JOIN employee e ON e.id = a.employee_id"
                    + " WHERE a.draft_id = ? AND e.home_unit_id = ? AND a.unit_id <> ?"
                    + " AND a.work_date >= DATE '2027-02-15'",
                Integer.class,
                draft,
                unitC,
                unitC))
        .isPositive();
  }

  private String reset() throws Exception {
    HttpResponse<String> started =
        send("POST", "/api/v1/demo/reset", "{\"confirm\":\"RESET\",\"dataset\":\"150\"}", planner);
    assertThat(started.statusCode()).as(started.body()).isEqualTo(200);
    long deadline = System.nanoTime() + 180_000_000_000L;
    while (System.nanoTime() < deadline) {
      Map<String, Object> status =
          mapper.readValue(
              send("GET", "/api/v1/demo/reset/status", null, planner).body(), Map.class);
      if ("DONE".equals(status.get("state"))) {
        return (String) status.get("checksum");
      }
      if ("FAILED".equals(status.get("state"))) {
        throw new AssertionError(status.toString());
      }
      Thread.sleep(300);
    }
    throw new AssertionError("reset did not finish");
  }

  private UUID generate() throws Exception {
    HttpResponse<String> generated =
        send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}", planner);
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    return UUID.fromString((String) mapper.readValue(generated.body(), Map.class).get("id"));
  }

  private Map<String, Object> draftSummary(UUID draft) throws Exception {
    return mapper.readValue(
        send("GET", "/api/v1/planner/drafts/" + draft, null, planner).body(), Map.class);
  }

  private String fingerprint(UUID draft) {
    List<String> rows =
        jdbc.queryForList(
            "SELECT e.employee_no || '|' || u.code || '|' || t.code || '|' || a.work_date"
                + " || '|' ||"
                + " to_char(a.start_at AT TIME ZONE 'America/Regina', 'YYYY-MM-DD\"T\"HH24:MI')"
                + " || '|' ||"
                + " to_char(a.end_at AT TIME ZONE 'America/Regina', 'YYYY-MM-DD\"T\"HH24:MI')"
                + " || '|' || a.kind"
                + " FROM plan_draft_assignment a JOIN employee e ON e.id = a.employee_id"
                + " JOIN unit u ON u.id = a.unit_id JOIN shift_template t ON t.id = a.shift_template_id"
                + " WHERE a.draft_id = ? ORDER BY 1",
            String.class,
            draft);
    try {
      java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
      for (String row : rows) {
        digest.update(row.getBytes(StandardCharsets.UTF_8));
        digest.update((byte) '\n');
      }
      return java.util.HexFormat.of().formatHex(digest.digest());
    } catch (java.security.NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  private String login(String username) throws Exception {
    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"" + username + "\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(response.statusCode()).as("login for %s", username).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private HttpResponse<String> send(String method, String path, String body, String token)
      throws Exception {
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body != null) {
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    builder.header("Authorization", "Bearer " + token);
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
