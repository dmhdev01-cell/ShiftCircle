package ca.shiftcircle.api.demo;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import ca.shiftcircle.infrastructure.demo.DemoChecksum;
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

  /** Release v1.3 (S4): the 150 officers plus their 12 supervisors. */
  private static final String CHECKSUM_150 =
      "353e2e62a1627a9ba31b7e411064065e2d0c36510a3e145f010251c4713991a5";
  private static final String PLAN_150_FINGERPRINT =
      "7368ef1377e3e38b3b507d49e9dc29f481ba706778506a6e3140eb34ec450587";
  /** The pre-S4 pins, which the officers alone still produce. */
  private static final String OFFICER_CHECKSUM_150 =
      "2e6cd938254002892c06d9800652666e5a9e786f78f5ca2ed11c7005a987d7f8";

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

    assertThat(DemoChecksum.officersOnlyWithNames(jdbc))
        .as("the officers are the pre-supervisor officers")
        .isEqualTo(OFFICER_CHECKSUM_150);
    assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM employee WHERE classification = 'CO'", Integer.class))
        .isEqualTo(150);
    assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM employee WHERE fte = 1.0 AND classification = 'CO'",
            Integer.class))
        .isEqualTo(120);
    assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM employee WHERE fte < 1.0 AND classification = 'CO'",
            Integer.class))
        .isEqualTo(30);
    // Release v1.3 (S4): 12 supervisors, the 120 ten plus a D8 day supervisor and a 0.6 FTE
    // part-timer; M. Ellis has the planted February vacation week.
    assertThat(jdbc.queryForList(
            "SELECT u.code || ' ' || r.code || ' ' || e.fte FROM employee e"
                + " JOIN unit u ON u.id = e.home_unit_id"
                + " JOIN rotation_pattern r ON r.id = e.rotation_pattern_id"
                + " WHERE e.classification = 'CS' ORDER BY e.employee_no",
            String.class))
        .containsExactly(
            "SUP-L D12_DAY_4ON4OFF 1.00", "SUP-L D12_DAY_4ON4OFF 1.00",
            "SUP-L N12_NIGHT_4ON4OFF 1.00", "SUP-L N12_NIGHT_4ON4OFF 1.00",
            "SUP-L N12_NIGHT_RELIEF 1.00",
            "SUP-O D12_DAY_4ON4OFF 1.00", "SUP-O D12_DAY_4ON4OFF 1.00",
            "SUP-O N12_NIGHT_4ON4OFF 1.00", "SUP-O N12_NIGHT_4ON4OFF 1.00",
            "SUP-O D12_DAY_RELIEF 1.00",
            "SUP-L D8_DAY_5ON2OFF 1.00", "SUP-O CASUAL_12 0.60");
    assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM absence a JOIN app_user u ON u.employee_id = a.employee_id"
                + " WHERE u.username = 'm.ellis' AND a.type = 'VACATION'"
                + " AND a.start_at >= TIMESTAMPTZ '2027-02-08 00:00-06'"
                + " AND a.start_at < TIMESTAMPTZ '2027-02-15 00:00-06'",
            Integer.class))
        .as("M. Ellis's planted vacation week")
        .isEqualTo(7);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM employee e JOIN rotation_pattern r"
                    + " ON r.id = e.rotation_pattern_id WHERE r.code LIKE 'N12%'",
                Integer.class))
        .as("officers on N12 crews and relief, plus the 4 supervisors on N12 and 1 on N12 relief")
        .isEqualTo(55);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM employee e JOIN rotation_pattern r"
                    + " ON r.id = e.rotation_pattern_id WHERE r.code LIKE 'D12%'",
                Integer.class))
        .as("officers on D12 crews and relief, plus the 4 supervisors on D12 and 1 on D12 relief")
        .isEqualTo(72);
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
    assertThat(shifts).isEqualTo(5877);
    assertThat(officers).as("people scheduled: 150 officers and 12 supervisors").isEqualTo(162);
    assertThat(fingerprint(draft)).isEqualTo(PLAN_150_FINGERPRINT);
    @SuppressWarnings("unchecked")
    Map<String, Object> supervisorCard = (Map<String, Object>) scorecard.get("supervisors");
    @SuppressWarnings("unchecked")
    Map<String, Object> supervisorCoverage = (Map<String, Object>) supervisorCard.get("coverage");
    assertThat(((Number) supervisorCoverage.get("shortBlockDays")).intValue())
        .as("the supervisors' leave leaves supervisor-post gaps, reported in their card")
        .isEqualTo(93);
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
