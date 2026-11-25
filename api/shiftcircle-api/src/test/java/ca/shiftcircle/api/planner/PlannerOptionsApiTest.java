package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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

/**
 * PR-N: the Generate options are validated (400 problem detail), PLANNER-only, stored on the draft
 * and shown with it, and on Dataset 150 "fill part-time up to FTE" leaves less unused part-time
 * capacity than the default.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"sc.demo.generate=true", "sc.demo.today=2026-11-19"})
@ActiveProfiles("demo")
class PlannerOptionsApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;
  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void badOptionValuesAreA400ProblemDetailNamingTheField() throws Exception {
    String planner = loginToken("p.planner");
    Map<String, String> bad =
        Map.of(
            "{\"seed\":1,\"staffTypes\":[\"FULL_TIME\",\"CONTRACTOR\"]}", "staffTypes",
            "{\"seed\":1,\"staffTypes\":[\"PART_TIME\"]}", "staffTypes must include FULL_TIME",
            "{\"seed\":1,\"staffTypes\":[\"FULL_TIME\",null]}", "staffTypes",
            "{\"seed\":1,\"partTimeFill\":\"ALWAYS\"}", "partTimeFill",
            "{\"seed\":1,\"staffTypes\":[\"FULL_TIME\"],\"partTimeFill\":\"UP_TO_FTE\"}",
                "UP_TO_FTE needs PART_TIME",
            "{\"seed\":1,\"partTimeFill\":\"up_to_fte\"}", "partTimeFill",
            "{\"seed\":1,\"crossUnitFill\":\"YES\"}", "crossUnitFill",
            "{\"seed\":1,\"staffTypes\":[]}", "staffTypes must include FULL_TIME");
    Integer draftsBefore = jdbc.queryForObject("SELECT count(*) FROM plan_draft", Integer.class);
    for (Map.Entry<String, String> entry : bad.entrySet()) {
      HttpResponse<String> response = send("POST", "/api/v1/planner/drafts", entry.getKey(), planner);
      assertThat(response.statusCode()).as(entry.getKey() + " -> " + response.body()).isEqualTo(400);
      assertThat(response.headers().firstValue("Content-Type").orElse(""))
          .contains("application/problem+json");
      Map<String, Object> problem = mapper.readValue(response.body(), Map.class);
      assertThat(problem.get("status")).isEqualTo(400);
      assertThat((String) problem.get("title")).as(entry.getKey()).contains(entry.getValue());
    }
    assertThat(jdbc.queryForObject("SELECT count(*) FROM plan_draft", Integer.class))
        .as("a refused option generates nothing")
        .isEqualTo(draftsBefore);
  }

  @Test
  void onlyThePlannerMayGenerateWithOptions() throws Exception {
    for (String user : List.of("m.ellis", "a.reviewer", "t.nakamura")) {
      HttpResponse<String> response =
          send(
              "POST",
              "/api/v1/planner/drafts",
              "{\"seed\":1,\"partTimeFill\":\"UP_TO_FTE\"}",
              loginToken(user));
      assertThat(response.statusCode()).as(user).isEqualTo(403);
    }
  }

  @Test
  @SuppressWarnings("unchecked")
  void optionsAreStoredOnTheDraftAndShownWithItAndDataset150FillsMorePartTimeHours()
      throws Exception {
    String planner = loginToken("p.planner");
    reset(planner, "150");

    Map<String, Object> defaults = generate(planner, "{\"seed\":20261001}");
    assertThat(defaults.get("options"))
        .isEqualTo(
            Map.of(
                "staffTypes", List.of("FULL_TIME", "PART_TIME"),
                "partTimeFill", "AFTER_FULL_TIME",
                "crossUnitFill", "OFF"));
    Capacity before = capacity(defaults);

    Map<String, Object> filled =
        generate(planner, "{\"seed\":20261001,\"partTimeFill\":\"UP_TO_FTE\"}");
    Map<String, Object> options = (Map<String, Object>) filled.get("options");
    assertThat(options.get("partTimeFill")).isEqualTo("UP_TO_FTE");
    assertThat(options.get("staffTypes")).isEqualTo(List.of("FULL_TIME", "PART_TIME"));
    Capacity after = capacity(filled);

    System.out.printf(
        "Dataset 150 unused part-time capacity: AFTER_FULL_TIME %d h of %d h target (planned %d h,"
            + " %d gaps, %d warnings); UP_TO_FTE %d h (planned %d h, %d gaps, %d warnings)%n",
        before.unused(), before.target(), before.planned(), before.gaps(), before.warnings(),
        after.unused(), after.planned(), after.gaps(), after.warnings());
    // The documented Dataset 150 figures, seed 20261001 (docs/user-guide/planner.md §1).
    assertThat(before).isEqualTo(new Capacity(6565, 10080, 3515, 100, 39));
    assertThat(after).isEqualTo(new Capacity(9584, 10080, 496, 100, 51));

    // Stored on the row and shown again by GET /drafts/{id} and GET /plan.
    UUID id = UUID.fromString((String) filled.get("id"));
    assertThat(
            jdbc.queryForObject(
                "SELECT part_time_fill FROM plan_draft WHERE id = ?", String.class, id))
        .isEqualTo("UP_TO_FTE");
    Map<String, Object> shown =
        mapper.readValue(send("GET", "/api/v1/planner/drafts/" + id, null, planner).body(), Map.class);
    assertThat(shown.get("options")).isEqualTo(options);
    Map<String, Object> plan =
        mapper.readValue(send("GET", "/api/v1/planner/plan", null, planner).body(), Map.class);
    assertThat(((Map<String, Object>) plan.get("draft")).get("options")).isEqualTo(options);

    // Full-time only: stored and shown; no part-timer is placed.
    Map<String, Object> fullTimeOnly =
        generate(planner, "{\"seed\":20261001,\"staffTypes\":[\"FULL_TIME\"]}");
    assertThat(fullTimeOnly.get("options"))
        .isEqualTo(
            Map.of(
                "staffTypes", List.of("FULL_TIME"),
                "partTimeFill", "AFTER_FULL_TIME",
                "crossUnitFill", "OFF"));
    UUID fullTimeId = UUID.fromString((String) fullTimeOnly.get("id"));
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM plan_draft_assignment a JOIN employee e"
                    + " ON e.id = a.employee_id WHERE a.draft_id = ? AND e.fte < 1",
                Integer.class,
                fullTimeId))
        .isZero();
    Capacity none = capacity(fullTimeOnly);
    assertThat(none.planned()).isZero();
    assertThat(none).isEqualTo(new Capacity(0, 10080, 10080, 687, 5));
    System.out.printf(
        "Dataset 150 full-time only: %d gaps, %d warnings%n",
        none.gaps(), none.warnings());

    // The audit event records the options.
    Map<String, Object> audit =
        mapper.readValue(
            jdbc.queryForObject(
                "SELECT after::text FROM audit_event WHERE action = 'generate_plan'"
                    + " AND entity_id = ?",
                String.class,
                fullTimeId),
            Map.class);
    assertThat(audit.get("staffTypes")).isEqualTo(List.of("FULL_TIME"));
    assertThat(audit.get("partTimeFill")).isEqualTo("AFTER_FULL_TIME");
    assertThat(audit.get("crossUnitFill")).isEqualTo("OFF");
  }

  @Test
  @SuppressWarnings("unchecked")
  void dataset150CrossUnitFillCoversGapsFromOtherUnitsAndTheRosterSaysFromWhere()
      throws Exception {
    String planner = loginToken("p.planner");
    reset(planner, "150");
    Capacity off = capacity(generate(planner, "{\"seed\":20261001}"));

    Map<String, Object> cross =
        generate(planner, "{\"seed\":20261001,\"crossUnitFill\":\"ON\"}");
    assertThat(((Map<String, Object>) cross.get("options")).get("crossUnitFill")).isEqualTo("ON");
    Capacity on = capacity(cross);
    Map<String, Object> card =
        (Map<String, Object>) ((Map<String, Object>) cross.get("scorecard")).get("crossUnit");
    System.out.printf(
        "Dataset 150 crossUnitFill ON: %d gaps (OFF %d), %d warnings (OFF %d), unused %d h (OFF"
            + " %d h); card %s%n",
        on.gaps(), off.gaps(), on.warnings(), off.warnings(), on.unused(), off.unused(), card);
    assertThat(off).isEqualTo(new Capacity(6565, 10080, 3515, 100, 39));
    assertThat(on).isEqualTo(new Capacity(6743, 10080, 3337, 72, 59));
    assertThat(card)
        .containsEntry("gapsBefore", 100)
        .containsEntry("gapsCovered", 28)
        .containsEntry("shifts", 41)
        .containsEntry("officers", 26)
        .containsEntry("stillShortReasons", Map.of("NOT_QUALIFIED", 46, "NO_HOURS_LEFT", 14, "RULE_BLOCK", 12));

    UUID id = UUID.fromString((String) cross.get("id"));
    // Every cross-unit shift is rule-clean (no Block) by construction; it holds the block's
    // qualification where the unit asks for one.
    Integer unqualified =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_assignment a JOIN employee e ON e.id = a.employee_id"
                + " JOIN shift_template t ON t.id = a.shift_template_id"
                + " JOIN unit_requirement r ON r.unit_id = a.unit_id AND r.effective_to IS NULL"
                + " AND r.qualification_id IS NOT NULL AND r.min_with_qualification > 0"
                + " AND r.block = CASE WHEN t.code IN ('N12','A12') THEN 'NIGHT'"
                + " WHEN t.code IN ('E8') THEN 'EVENING' ELSE 'DAY' END"
                + " WHERE a.draft_id = ? AND a.unit_id <> e.home_unit_id"
                + " AND NOT EXISTS (SELECT 1 FROM employee_qualification q"
                + " WHERE q.employee_id = e.id AND q.qualification_id = r.qualification_id)",
            Integer.class,
            id);
    assertThat(unqualified).isZero();

    // The draft roster names the home unit of an officer placed away; the board never does.
    Map<String, Object> away =
        jdbc.queryForMap(
            "SELECT a.unit_id, a.work_date, hu.name AS home FROM plan_draft_assignment a"
                + " JOIN employee e ON e.id = a.employee_id JOIN unit hu ON hu.id = e.home_unit_id"
                + " WHERE a.draft_id = ? AND a.unit_id <> e.home_unit_id"
                + " ORDER BY a.work_date, a.unit_id LIMIT 1",
            id);
    String day = away.get("work_date").toString();
    String roster =
        send("GET", "/api/v1/planner/drafts/" + id + "/schedule?unitId=" + away.get("unit_id")
                + "&from=" + day + "&to=" + day, null, planner)
            .body();
    List<Map<String, Object>> officers =
        (List<Map<String, Object>>) mapper.readValue(roster, Map.class).get("officers");
    assertThat(officers).anyMatch(row -> away.get("home").equals(row.get("homeUnit")));
    assertThat(officers).anyMatch(row -> !row.containsKey("homeUnit"));
    String board =
        send("GET", "/api/v1/schedule?unitId=" + away.get("unit_id") + "&from=2026-11-16&to=2026-11-22",
                null, loginToken("a.reviewer"))
            .body();
    assertThat(board).doesNotContain("homeUnit");

    // Both options: gaps first, then the extras; the draft commits through the normal path.
    Map<String, Object> both =
        generate(
            planner,
            "{\"seed\":20261001,\"partTimeFill\":\"UP_TO_FTE\",\"crossUnitFill\":\"ON\"}");
    assertThat(capacity(both)).isEqualTo(new Capacity(9584, 10080, 496, 72, 71));
    // The draft's plan-inputs snapshot (PR-M) carries the options and their fill-order steps.
    Map<String, Object> inputs =
        (Map<String, Object>) ((Map<String, Object>) both.get("scorecard")).get("inputs");
    assertThat((Map<String, Object>) inputs.get("options"))
        .containsEntry("staffTypes", List.of("FULL_TIME", "PART_TIME"))
        .containsEntry("partTimeFill", "UP_TO_FTE")
        .containsEntry("crossUnitFill", "ON");
    List<String> fillOrder =
        (List<String>) ((Map<String, Object>) inputs.get("rules")).get("fillOrder");
    assertThat(fillOrder).hasSize(7);
    assertThat(fillOrder.get(4)).startsWith("Each gap still open is then offered");
    UUID bothId = UUID.fromString((String) both.get("id"));
    Map<String, Object> preview =
        mapper.readValue(
            send("GET", "/api/v1/planner/drafts/" + bothId + "/commit-preview", null, planner).body(),
            Map.class);
    assertThat(preview.get("shiftsToWrite")).isEqualTo(5769);
    HttpResponse<String> committed =
        send(
            "POST",
            "/api/v1/planner/drafts/" + bothId + "/commit",
            "{\"acceptedWarningCount\":" + preview.get("warningCount") + "}",
            planner,
            Map.of("If-Match", "\"" + preview.get("version") + "\""));
    assertThat(committed.statusCode()).as(committed.body()).isEqualTo(200);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment WHERE plan_draft_id = ?",
                Integer.class,
                bothId))
        .isEqualTo(5769);
    // The cross-unit shifts reach the board in the unit they cover.
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
                    + " WHERE s.plan_draft_id = ? AND s.unit_id <> e.home_unit_id",
                Integer.class,
                bothId))
        .isEqualTo(41);
  }

  @Test
  @SuppressWarnings("unchecked")
  void dataset150EachExtraOptionCommitsOnItsOwnAndTheFullTimePlusOtherUnitsRowIsPinned()
      throws Exception {
    String planner = loginToken("p.planner");

    // Fill up to FTE alone: the 51-warning draft the commit used to refuse now commits.
    reset(planner, "150");
    Map<String, Object> upTo = generate(planner, "{\"seed\":20261001,\"partTimeFill\":\"UP_TO_FTE\"}");
    assertThat(capacity(upTo)).isEqualTo(new Capacity(9584, 10080, 496, 100, 51));
    assertThat(commit(planner, upTo)).isEqualTo(5746);

    reset(planner, "150");
    // Full-time only plus other units: 529 gaps, 115 warnings, 4,894 shifts, 158 covered.
    Map<String, Object> fullTimeCross =
        generate(planner, "{\"seed\":20261001,\"staffTypes\":[\"FULL_TIME\"],\"crossUnitFill\":\"ON\"}");
    assertThat(capacity(fullTimeCross)).isEqualTo(new Capacity(0, 10080, 10080, 529, 115));
    assertThat(shifts(planner, fullTimeCross)).isEqualTo(4894);
    Map<String, Object> card = crossUnit(fullTimeCross);
    assertThat(card).containsEntry("gapsCovered", 158).containsEntry("shifts", 203)
        .containsEntry("officers", 82);
    assertThat((Map<String, Object>) card.get("stillShortReasons"))
        .isEqualTo(Map.of("NOT_QUALIFIED", 268, "NO_HOURS_LEFT", 201, "RULE_BLOCK", 51, "NO_SHIFT_FITS", 9));

    // Other units alone: 5,455 shifts, commits.
    Map<String, Object> cross = generate(planner, "{\"seed\":20261001,\"crossUnitFill\":\"ON\"}");
    assertThat(capacity(cross)).isEqualTo(new Capacity(6743, 10080, 3337, 72, 59));
    assertThat(commit(planner, cross)).isEqualTo(5455);
  }

  @Test
  @SuppressWarnings("unchecked")
  void dataset120OtherUnitsCoversNothingAndSaysWhyAndTheInputsFollowTheForm() throws Exception {
    String planner = loginToken("p.planner");
    reset(planner, "120");
    Map<String, Object> cross = generate(planner, "{\"seed\":20261001,\"crossUnitFill\":\"ON\"}");
    assertThat(capacity(cross)).isEqualTo(new Capacity(1248, 6720, 5472, 38, 7));
    assertThat(shifts(planner, cross)).isEqualTo(5103);
    Map<String, Object> card = crossUnit(cross);
    // All 38 gaps are Escort evenings, and no free officer in another unit holds Escort.
    assertThat(card).containsEntry("gapsCovered", 0).containsEntry("shifts", 0);
    assertThat((Map<String, Object>) card.get("stillShortReasons")).isEqualTo(Map.of("NOT_QUALIFIED", 38));
    assertThat((Map<String, Object>) card.get("stillShortByUnitBlock")).isEqualTo(Map.of("ESC EVENING", 38));

    Map<String, Object> fullTimeCross =
        generate(planner, "{\"seed\":20261001,\"staffTypes\":[\"FULL_TIME\"],\"crossUnitFill\":\"ON\"}");
    assertThat(capacity(fullTimeCross)).isEqualTo(new Capacity(0, 6720, 6720, 152, 6));
    assertThat(shifts(planner, fullTimeCross)).isEqualTo(4958);
    assertThat(crossUnit(fullTimeCross)).containsEntry("gapsCovered", 4);

    // GET /planner/inputs follows the Generate form's options, and refuses a bad one.
    Map<String, Object> inputs =
        mapper.readValue(
            send("GET", "/api/v1/planner/inputs?staffTypes=FULL_TIME&crossUnitFill=ON", null, planner)
                .body(),
            Map.class);
    assertThat((Map<String, Object>) inputs.get("options"))
        .containsEntry("staffTypes", List.of("FULL_TIME"))
        .containsEntry("crossUnitFill", "ON");
    List<String> fillOrder = (List<String>) ((Map<String, Object>) inputs.get("rules")).get("fillOrder");
    assertThat(fillOrder).hasSize(6);
    assertThat(fillOrder.get(2)).contains("left out of this draft");
    assertThat(((Map<String, Object>) inputs.get("officers")).get("partTimeFte")).isEqualTo(12.0);
    HttpResponse<String> bad = send("GET", "/api/v1/planner/inputs?partTimeFill=SOMETIMES", null, planner);
    assertThat(bad.statusCode()).isEqualTo(400);
    assertThat(bad.body()).contains("partTimeFill");
  }

  // --- helpers ----------------------------------------------------------------------------------

  /** Commit a draft through the normal path, accepting its warnings; returns the shifts written. */
  @SuppressWarnings("unchecked")
  private int commit(String token, Map<String, Object> draft) throws Exception {
    String id = (String) draft.get("id");
    Map<String, Object> preview =
        mapper.readValue(
            send("GET", "/api/v1/planner/drafts/" + id + "/commit-preview", null, token).body(),
            Map.class);
    // The commit's own recount agrees with the draft's warning count.
    assertThat(preview.get("warningCount"))
        .isEqualTo(((Map<String, Object>) ((Map<String, Object>) draft.get("scorecard")).get("warnings")).get("total"));
    HttpResponse<String> committed =
        send(
            "POST",
            "/api/v1/planner/drafts/" + id + "/commit",
            "{\"acceptedWarningCount\":" + preview.get("warningCount") + "}",
            token,
            Map.of("If-Match", "\"" + preview.get("version") + "\""));
    assertThat(committed.statusCode()).as(committed.body()).isEqualTo(200);
    return ((Number) mapper.readValue(committed.body(), Map.class).get("shiftsWritten")).intValue();
  }

  @SuppressWarnings("unchecked")
  private int shifts(String token, Map<String, Object> draft) throws Exception {
    return ((Number)
            mapper.readValue(
                    send("GET", "/api/v1/planner/drafts/" + draft.get("id") + "/commit-preview", null, token)
                        .body(),
                    Map.class)
                .get("shiftsToWrite"))
        .intValue();
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> crossUnit(Map<String, Object> draft) {
    return (Map<String, Object>) ((Map<String, Object>) draft.get("scorecard")).get("crossUnit");
  }

  private record Capacity(long planned, long target, long unused, int gaps, int warnings) {}

  /** The scorecard's "Unused part-time capacity" line, worked out as the web does. */
  @SuppressWarnings("unchecked")
  private static Capacity capacity(Map<String, Object> draft) {
    Map<String, Object> scorecard = (Map<String, Object>) draft.get("scorecard");
    List<Map<String, Object>> bands =
        (List<Map<String, Object>>) ((Map<String, Object>) scorecard.get("fteBands")).get("bands");
    double planned = 0;
    double target = 0;
    for (Map<String, Object> band : bands) {
      if ("FULL_TIME".equals(band.get("band"))) {
        continue;
      }
      int officers = ((Number) band.get("officers")).intValue();
      planned += officers * ((Number) band.get("plannedAvg")).doubleValue();
      target += officers * ((Number) band.get("targetHours")).doubleValue();
    }
    int gaps =
        ((Number) ((Map<String, Object>) scorecard.get("coverage")).get("shortBlockDays")).intValue();
    int warnings =
        ((Number) ((Map<String, Object>) scorecard.get("warnings")).get("total")).intValue();
    return new Capacity(
        Math.round(planned),
        Math.round(target),
        Math.max(0, Math.round(target) - Math.round(planned)),
        gaps,
        warnings);
  }

  private Map<String, Object> generate(String token, String body) throws Exception {
    HttpResponse<String> generated = send("POST", "/api/v1/planner/drafts", body, token);
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    return mapper.readValue(generated.body(), Map.class);
  }

  private void reset(String token, String dataset) throws Exception {
    HttpResponse<String> started =
        send("POST", "/api/v1/demo/reset", "{\"confirm\":\"RESET\",\"dataset\":\"" + dataset + "\"}", token);
    assertThat(started.statusCode()).as(started.body()).isEqualTo(200);
    long deadline = System.nanoTime() + 240_000_000_000L;
    while (System.nanoTime() < deadline) {
      Map<String, Object> status =
          mapper.readValue(send("GET", "/api/v1/demo/reset/status", null, token).body(), Map.class);
      if ("DONE".equals(status.get("state"))) {
        return;
      }
      if ("FAILED".equals(status.get("state"))) {
        throw new AssertionError(status.toString());
      }
      Thread.sleep(250);
    }
    throw new AssertionError("reset " + dataset + " did not finish");
  }

  private String loginToken(String username) throws Exception {
    HttpResponse<String> response =
        send("POST", "/api/v1/auth/mock-login", "{\"userId\":\"" + username + "\"}", null);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private HttpResponse<String> send(String method, String path, String body, String token)
      throws Exception {
    return send(method, path, body, token, Map.of());
  }

  private HttpResponse<String> send(
      String method, String path, String body, String token, Map<String, String> headers)
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
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    headers.forEach(builder::header);
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
