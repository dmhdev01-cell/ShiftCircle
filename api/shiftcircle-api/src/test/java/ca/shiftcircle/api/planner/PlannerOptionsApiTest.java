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
            "{\"seed\":1,\"partTimeFill\":\"up_to_fte\"}", "partTimeFill");
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
                "partTimeFill", "AFTER_FULL_TIME"));
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
    assertThat(after.unused()).isLessThan(before.unused());
    assertThat(after.gaps()).isLessThanOrEqualTo(before.gaps());

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
        .isEqualTo(Map.of("staffTypes", List.of("FULL_TIME"), "partTimeFill", "AFTER_FULL_TIME"));
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
    assertThat(none.gaps()).isGreaterThan(before.gaps());
    System.out.printf(
        "Dataset 150 full-time only: %d gaps, %d warnings%n",
        none.gaps(), none.warnings());

    // The audit event records the options.
    String audit =
        jdbc.queryForObject(
            "SELECT after::text FROM audit_event WHERE action = 'generate_plan'"
                + " AND entity_id = ?",
            String.class,
            fullTimeId);
    assertThat(audit)
        .contains("\"staffTypes\": [\"FULL_TIME\"]")
        .contains("\"partTimeFill\": \"AFTER_FULL_TIME\"");
  }

  // --- helpers ----------------------------------------------------------------------------------

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
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
