package ca.shiftcircle.api.demo;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import ca.shiftcircle.api.rules.RuleCheckService;
import ca.shiftcircle.infrastructure.demo.DemoChecksum;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
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

/** The selectable "120" planner-demo dataset: 100 full-time crews + 20 casual relief officers. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=true")
@ActiveProfiles("demo")
class Demo120ResetApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  private static final String CHECKSUM_100 =
      "3390148255db715844c4df90f553ae342530417621539b23499f638c5b126539";

  @Autowired private JdbcTemplate jdbc;
  @Autowired private RuleCheckService ruleCheck;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  @BeforeAll
  void login() throws Exception {
    tokens.put("p.planner", login("p.planner"));
  }

  @Test
  void resetsToTheCrewDatasetTwiceThenBackTo100() throws Exception {
    String checksum120 = null;
    for (int round = 0; round < 2; round++) {
      long start = System.nanoTime();
      HttpResponse<String> started =
          send(
              "POST",
              "/api/v1/demo/reset",
              "{\"confirm\":\"RESET\",\"dataset\":\"120\"}",
              tokens.get("p.planner"));
      assertThat(started.statusCode()).as(started.body()).isEqualTo(200);
      Map<String, Object> done = awaitDone();
      System.out.println(
          "RESET120 round "
              + round
              + " elapsedMs="
              + done.get("elapsedMs")
              + " totalMs="
              + (System.nanoTime() - start) / 1_000_000
              + " checksum="
              + done.get("checksum"));
      assertThat(done.get("state")).isEqualTo("DONE");
      assertThat(done.get("dataset")).isEqualTo("120");
      assertThat(((Number) done.get("elapsedMs")).longValue())
          .as("a generous reset bound")
          .isLessThanOrEqualTo(30_000L);
      assertThat(done.get("error")).isNull();
      String checksum = (String) done.get("checksum");
      assertThat(checksum).isNotBlank();
      if (checksum120 == null) {
        checksum120 = checksum;
      } else {
        assertThat(checksum).as("the 120 dataset is deterministic").isEqualTo(checksum120);
      }

      assertThat(jdbc.queryForObject("SELECT count(*) FROM employee", Integer.class))
          .isEqualTo(120);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM employee WHERE fte = 1.0", Integer.class))
          .isEqualTo(100);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM employee WHERE fte < 1.0", Integer.class))
          .isEqualTo(20);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM employee e JOIN rotation_pattern r"
                  + " ON r.id = e.rotation_pattern_id WHERE r.code = 'N12_NIGHT_4ON4OFF'",
              Integer.class))
          .isEqualTo(38);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM employee e JOIN rotation_pattern r"
                  + " ON r.id = e.rotation_pattern_id WHERE r.code = 'D12_DAY_4ON4OFF'",
              Integer.class))
          .isEqualTo(54);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM employee e JOIN rotation_pattern r"
                  + " ON r.id = e.rotation_pattern_id WHERE r.code = 'E8_EVENING_5ON2OFF'",
              Integer.class))
          .isEqualTo(3);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM employee e JOIN rotation_pattern r"
                  + " ON r.id = e.rotation_pattern_id WHERE r.code = 'N12_NIGHT_RELIEF'",
              Integer.class))
          .isEqualTo(3);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM employee e JOIN rotation_pattern r"
                  + " ON r.id = e.rotation_pattern_id WHERE r.code = 'D12_DAY_RELIEF'",
              Integer.class))
          .isEqualTo(2);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM employee e JOIN rotation_pattern r"
                  + " ON r.id = e.rotation_pattern_id WHERE r.code = 'CASUAL_12'",
              Integer.class))
          .isEqualTo(8);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM employee e JOIN rotation_pattern r"
                  + " ON r.id = e.rotation_pattern_id WHERE r.code = 'CASUAL_8'",
              Integer.class))
          .isEqualTo(12);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM unit WHERE code IN ('ADM','ESC') AND allows_12h",
              Integer.class))
          .isEqualTo(2);
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM shift_assignment a JOIN shift_template t"
                  + " ON t.id = a.shift_template_id WHERE t.code IN ('L16','N8')",
              Integer.class))
          .isZero();
      assertThat(jdbc.queryForObject("SELECT count(*) FROM plan_draft", Integer.class))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "SELECT action FROM audit_event ORDER BY id LIMIT 1", String.class))
          .isEqualTo("demo_reset");
    }
    assertThat(DemoChecksum.of(jdbc)).isEqualTo(checksum120);

    long generateStart = System.nanoTime();
    HttpResponse<String> generated =
        send(
            "POST",
            "/api/v1/planner/drafts",
            "{\"seed\":20261001}",
            tokens.get("p.planner"));
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    UUID draftId = UUID.fromString((String) mapper.readValue(generated.body(), Map.class).get("id"));
    Map<String, Object> draft =
        mapper.readValue(
            send("GET", "/api/v1/planner/drafts/" + draftId, null, tokens.get("p.planner")).body(),
            Map.class);
    @SuppressWarnings("unchecked")
    Map<String, Object> scorecard = (Map<String, Object>) draft.get("scorecard");
    @SuppressWarnings("unchecked")
    Map<String, Object> coverage = (Map<String, Object>) scorecard.get("coverage");
    int gaps = ((Number) coverage.get("shortBlockDays")).intValue();
    System.out.println(
        "PLANNER120 gaps="
            + gaps
            + " generateMs="
            + (System.nanoTime() - generateStart) / 1_000_000
            + " warnings="
            + scorecard.get("warnings"));
    assertThat(gaps)
        .as("the 120 crews + 20 casuals cover 20-60 of 1,764 block-days")
        .isBetween(20, 60);
    @SuppressWarnings("unchecked")
    Map<String, Object> warnings = (Map<String, Object>) scorecard.get("warnings");
    assertThat(((Number) warnings.get("total")).intValue())
        .as("plan warnings stay bounded")
        .isLessThanOrEqualTo(30);
    assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_assignment a JOIN shift_template t"
                + " ON t.id = a.shift_template_id WHERE a.draft_id = ? AND t.code IN ('L16','N8')",
            Integer.class,
            draftId))
        .isZero();
    assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_assignment a JOIN shift_template t"
                + " ON t.id = a.shift_template_id WHERE a.draft_id = ? AND t.code = 'N12'",
            Integer.class,
            draftId))
        .isPositive();
    assertNoBlocks(draftId);
    qualificationReport(draftId, "120");
    send("POST", "/api/v1/planner/drafts/" + draftId + "/discard", null, tokens.get("p.planner"));

    send(
        "POST",
        "/api/v1/demo/reset",
        "{\"confirm\":\"RESET\",\"dataset\":\"100\"}",
        tokens.get("p.planner"));
    Map<String, Object> back = awaitDone();
    assertThat(back.get("state")).isEqualTo("DONE");
    assertThat(back.get("dataset")).isEqualTo("100");
    assertThat(back.get("checksum")).isEqualTo(CHECKSUM_100);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM employee", Integer.class))
        .isEqualTo(100);
    assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM unit WHERE code IN ('ADM','ESC') AND allows_12h",
            Integer.class))
        .isZero();

    HttpResponse<String> generated100 =
        send(
            "POST",
            "/api/v1/planner/drafts",
            "{\"seed\":20261001}",
            tokens.get("p.planner"));
    assertThat(generated100.statusCode()).as(generated100.body()).isEqualTo(201);
    UUID draft100 =
        UUID.fromString((String) mapper.readValue(generated100.body(), Map.class).get("id"));
    qualificationReport(draft100, "100");
    send("POST", "/api/v1/planner/drafts/" + draft100 + "/discard", null, tokens.get("p.planner"));

    Map<?, ?> version =
        mapper.readValue(send("GET", "/api/v1/version", null, null).body(), Map.class);
    assertThat(((List<?>) version.get("datasets")).stream().map(String::valueOf).toList())
        .containsExactly("100", "120");
  }

  @Test
  void rejectsAnUnknownDataset() throws Exception {
    HttpResponse<String> unknown =
        send(
            "POST",
            "/api/v1/demo/reset",
            "{\"confirm\":\"RESET\",\"dataset\":\"400\"}",
            tokens.get("p.planner"));
    assertThat(unknown.statusCode()).isEqualTo(400);
    assertThat(unknown.body()).contains("Unknown demo dataset");
  }


  private void assertNoBlocks(UUID draftId) {
    Map<UUID, List<ShiftFact>> history = new LinkedHashMap<>();
    jdbc.query(
        "SELECT s.employee_id, e.employee_no, u.code AS unit_code, u.allows_12h,"
            + " u.allows_16h, t.code, s.start_at, s.end_at, s.kind FROM shift_assignment s"
            + " JOIN employee e ON e.id = s.employee_id JOIN unit u ON u.id = s.unit_id"
            + " JOIN shift_template t ON t.id = s.shift_template_id"
            + " WHERE s.status <> 'CANCELLED' AND s.start_at < ? AND s.end_at > ?",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs ->
                history
                    .computeIfAbsent(
                        rs.getObject("employee_id", UUID.class), key -> new ArrayList<>())
                    .add(
                        new ShiftFact(
                            "history",
                            rs.getString("employee_no"),
                            rs.getString("unit_code"),
                            rs.getString("code"),
                            rs.getTimestamp("start_at").toInstant(),
                            rs.getTimestamp("end_at").toInstant(),
                            "EXTRA".equals(rs.getString("kind"))
                                ? ShiftKind.EXTRA
                                : ShiftKind.ROSTERED,
                            0,
                            rs.getBoolean("allows_12h"),
                            rs.getBoolean("allows_16h"))),
        Timestamp.from(java.time.LocalDate.of(2027, 1, 4).atStartOfDay(
            java.time.ZoneId.of("America/Regina")).toInstant()),
        Timestamp.from(java.time.LocalDate.of(2026, 11, 29).atStartOfDay(
            java.time.ZoneId.of("America/Regina")).toInstant()));
    List<Map<String, Object>> planned =
        jdbc.queryForList(
            "SELECT a.employee_id, a.start_at, a.end_at, e.employee_no, u.code AS unit_code,"
                + " u.allows_12h, u.allows_16h, t.code FROM plan_draft_assignment a"
                + " JOIN employee e ON e.id = a.employee_id JOIN unit u ON u.id = a.unit_id"
                + " JOIN shift_template t ON t.id = a.shift_template_id"
                + " WHERE a.draft_id = ? ORDER BY a.start_at, a.employee_id",
            draftId);
    List<String> blocks = new ArrayList<>();
    for (Map<String, Object> row : planned) {
      UUID employeeId = (UUID) row.get("employee_id");
      ShiftFact proposed =
          new ShiftFact(
              "draft",
              (String) row.get("employee_no"),
              (String) row.get("unit_code"),
              (String) row.get("code"),
              ((Timestamp) row.get("start_at")).toInstant(),
              ((Timestamp) row.get("end_at")).toInstant(),
              ShiftKind.ROSTERED,
              0,
              (Boolean) row.get("allows_12h"),
              (Boolean) row.get("allows_16h"));
      ruleCheck.evaluate(proposed, history.getOrDefault(employeeId, List.of())).ruleResults()
          .stream()
          .filter(result -> "BLOCK".equals(result.outcome()))
          .forEach(result -> blocks.add(result.ruleCode() + ": " + result.message()));
      history.computeIfAbsent(employeeId, key -> new ArrayList<>()).add(proposed);
    }
    assertThat(blocks).as("no Block over the whole 120 draft").isEmpty();
  }

  @SuppressWarnings("unchecked")
  private void qualificationReport(UUID draftId, String label) {
    Map<UUID, java.util.Set<UUID>> qualified = new LinkedHashMap<>();
    jdbc.query(
        "SELECT employee_id, qualification_id FROM employee_qualification",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs ->
                qualified
                    .computeIfAbsent(
                        rs.getObject("employee_id", UUID.class), key -> new java.util.HashSet<>())
                    .add(rs.getObject("qualification_id", UUID.class)));
    List<Map<String, Object>> requirements =
        jdbc.queryForList(
            "SELECT r.unit_id, u.code AS unit, r.block, r.qualification_id,"
                + " r.min_with_qualification FROM unit_requirement r"
                + " JOIN unit u ON u.id = r.unit_id WHERE r.effective_to IS NULL"
                + " AND r.min_with_qualification > 0 ORDER BY u.code, r.block");
    List<Map<String, Object>> shifts =
        jdbc.queryForList(
            "SELECT a.unit_id, a.employee_id, a.work_date, a.start_at, a.end_at"
                + " FROM plan_draft_assignment a WHERE a.draft_id = ?",
            draftId);
    Map<String, Integer> failures = new LinkedHashMap<>();
    int total = 0;
    for (Map<String, Object> requirement : requirements) {
      UUID unitId = (UUID) requirement.get("unit_id");
      String unit = (String) requirement.get("unit");
      String block = (String) requirement.get("block");
      UUID qualificationId = (UUID) requirement.get("qualification_id");
      int minimum = ((Number) requirement.get("min_with_qualification")).intValue();
      for (LocalDate date = LocalDate.of(2027, 1, 4);
          !date.isAfter(LocalDate.of(2027, 4, 11));
          date = date.plusDays(1)) {
        java.time.Instant start =
            switch (block) {
              case "DAY" -> date.atTime(7, 0).atZone(java.time.ZoneId.of("America/Regina")).toInstant();
              case "EVENING" -> date.atTime(15, 0).atZone(java.time.ZoneId.of("America/Regina")).toInstant();
              default -> date.atTime(23, 0).atZone(java.time.ZoneId.of("America/Regina")).toInstant();
            };
        java.time.Instant end = start.plusSeconds(8 * 3600);
        int onDuty = 0;
        int qualifiedOnDuty = 0;
        for (Map<String, Object> shift : shifts) {
          if (!unitId.equals(shift.get("unit_id"))) {
            continue;
          }
          java.time.Instant shiftStart = ((java.sql.Timestamp) shift.get("start_at")).toInstant();
          java.time.Instant shiftEnd = ((java.sql.Timestamp) shift.get("end_at")).toInstant();
          if (shiftStart.isBefore(end) && shiftEnd.isAfter(start)) {
            onDuty++;
            if (qualified.getOrDefault((UUID) shift.get("employee_id"), java.util.Set.of())
                .contains(qualificationId)) {
              qualifiedOnDuty++;
            }
          }
        }
        if (qualifiedOnDuty < minimum) {
          failures.merge(unit + "/" + block, 1, Integer::sum);
          total++;
        }
      }
    }
    System.out.println(
        "QUALIFICATION "
            + label
            + " blockDaysFailing="
            + total
            + " byUnitBlock="
            + failures);
  }

  private Map<String, Object> awaitDone() throws Exception {
    long deadline = System.nanoTime() + 240_000_000_000L;
    while (System.nanoTime() < deadline) {
      Map<String, Object> status =
          mapper.readValue(
              send("GET", "/api/v1/demo/reset/status", null, tokens.get("p.planner")).body(),
              Map.class);
      if ("DONE".equals(status.get("state")) || "FAILED".equals(status.get("state"))) {
        return status;
      }
      Thread.sleep(500);
    }
    throw new AssertionError("demo reset did not finish in 240 s");
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
    assertThat(response.statusCode()).as("login for %s", username).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private HttpResponse<String> send(String method, String path, String body, String token)
      throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body != null) {
      builder.header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
