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

/**
 * PR-M plan inputs: GET /planner/inputs reports what Generate uses (counts on Datasets 120 and
 * 150), PLANNER only, no names; a draft keeps its own snapshot after staff change.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"sc.demo.generate=true", "sc.demo.today=2026-11-19"})
@ActiveProfiles("demo")
class PlanInputsApiTest {

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
  @SuppressWarnings("unchecked")
  void dataset120InputsMatchTheEmployeeTable() throws Exception {
    reset("120");
    Map<String, Object> inputs = inputs();

    // Release v1.3 S4: everyone the generator plans, the 120 officers and the 10 supervisors.
    Map<String, Object> officers = (Map<String, Object>) inputs.get("officers");
    assertThat(officers.get("total")).isEqualTo(130);
    assertThat(officers.get("fullTime")).isEqualTo(110);
    assertThat(officers.get("partTime")).isEqualTo(20);
    assertThat(((Number) officers.get("fte")).doubleValue())
        .isEqualTo(round1(jdbc.queryForObject("SELECT sum(fte) FROM employee", Double.class)));
    assertThat(officers.get("units"))
        .isEqualTo(
            jdbc.queryForObject("SELECT count(DISTINCT home_unit_id) FROM employee", Integer.class));

    List<Map<String, Object>> units = (List<Map<String, Object>>) inputs.get("units");
    assertThat(units).hasSize(jdbc.queryForObject("SELECT count(*) FROM unit", Integer.class));
    assertThat(units.stream().mapToInt(unit -> (int) unit.get("officers")).sum()).isEqualTo(130);
    int grouped =
        units.stream()
            .flatMap(unit -> ((List<Map<String, Object>>) unit.get("groups")).stream())
            .mapToInt(group -> (int) group.get("officers"))
            .sum();
    assertThat(grouped).as("every officer is in exactly one unit x pattern group").isEqualTo(130);
    // The 20 casual relief officers are a relief pool, 8 of them on 12 h.
    int relief12 =
        units.stream()
            .flatMap(unit -> ((List<Map<String, Object>>) unit.get("groups")).stream())
            .filter(group -> "CASUAL_12".equals(group.get("pattern")))
            .mapToInt(group -> (int) group.get("officers"))
            .sum();
    assertThat(relief12).isEqualTo(8);

    Map<String, Object> unitA =
        units.stream().filter(unit -> "A".equals(unit.get("code"))).findFirst().orElseThrow();
    Map<String, Object> minimums = (Map<String, Object>) unitA.get("minimums");
    assertThat(minimums.get("DAY"))
        .isEqualTo(
            jdbc.queryForObject(
                "SELECT r.min_staff FROM unit_requirement r JOIN unit u ON u.id = r.unit_id"
                    + " WHERE u.code = 'A' AND r.block = 'DAY' AND r.effective_to IS NULL",
                Integer.class));

    Map<String, Object> leave = (Map<String, Object>) inputs.get("leave");
    assertThat(leave.get("days")).as("Dataset 120 seeds no leave in the plan quarter").isEqualTo(0);

    Map<String, Object> rules = (Map<String, Object>) inputs.get("rules");
    assertThat(rules.get("ruleSetVersion"))
        .isEqualTo(
            jdbc.queryForObject(
                "SELECT version FROM rule_set_version WHERE status = 'PUBLISHED'", Integer.class));
    assertThat((List<String>) rules.get("fillOrder")).hasSize(5);
    Map<String, Object> options = (Map<String, Object>) inputs.get("options");
    assertThat(((Number) options.get("seed")).longValue()).isEqualTo(20261001L);
    assertThat(options).containsEntry("pattern8h", null);
  }

  @Test
  @SuppressWarnings("unchecked")
  void dataset150InputsAndTheDraftSnapshot() throws Exception {
    reset("150");
    HttpResponse<String> live = send("GET", "/api/v1/planner/inputs", null, planner);
    assertThat(live.statusCode()).isEqualTo(200);
    String anyName =
        jdbc.queryForObject(
            "SELECT first_name || ' ' || last_name FROM employee ORDER BY employee_no LIMIT 1",
            String.class);
    String anyNumber =
        jdbc.queryForObject("SELECT employee_no FROM employee ORDER BY employee_no LIMIT 1", String.class);
    assertThat(live.body()).as("counts only: no names").doesNotContain(anyName).doesNotContain(anyNumber);

    Map<String, Object> inputs = mapper.readValue(live.body(), Map.class);
    Map<String, Object> officers = (Map<String, Object>) inputs.get("officers");
    // Release v1.3 S4: the 150 officers and the 12 supervisors (one of them 0.6 FTE).
    assertThat(officers.get("total")).isEqualTo(162);
    assertThat(officers.get("fullTime")).isEqualTo(131);
    assertThat(officers.get("partTime")).isEqualTo(31);
    assertThat(((Number) officers.get("fte")).doubleValue()).isEqualTo(149.6);
    // The floor is the Staffing card's own figure: one stretch (no closures), so the whole quarter.
    List<Map<String, Object>> staffingPeriods = staffingPeriods();
    assertThat(staffingPeriods).hasSize(1);
    assertThat(officers.get("neededFte"))
        .isEqualTo(((Map<String, Object>) staffingPeriods.get(0).get("totals")).get("needed"))
        .as("the officer units' 127 and the two supervisor posts' 5 each")
        .isEqualTo(137);
    assertThat(officers.get("neededFrom")).isEqualTo("2027-01-04");
    assertThat(officers.get("neededTo")).isEqualTo("2027-04-11");

    Map<String, Object> leave = (Map<String, Object>) inputs.get("leave");
    int days = (int) leave.get("days");
    assertThat(days).as("Dataset 150 seeds 20% leave in the quarter").isPositive();
    Map<String, Integer> byType = (Map<String, Integer>) leave.get("byType");
    assertThat(byType.values().stream().mapToInt(Integer::intValue).sum()).isEqualTo(days);
    assertThat((int) leave.get("officers")).isPositive().isLessThanOrEqualTo(162);

    Map<String, Object> preferences = (Map<String, Object>) inputs.get("preferences");
    Map<String, Integer> lengths = (Map<String, Integer>) preferences.get("shiftLength");
    assertThat(lengths.getOrDefault("16", 0))
        .isEqualTo(
            jdbc.queryForObject(
                "SELECT count(*) FROM officer_preference WHERE shift_length = 16", Integer.class));
    assertThat(preferences.get("daysOffOfficers"))
        .isEqualTo(
            jdbc.queryForObject(
                "SELECT count(*) FROM officer_preference WHERE cardinality(days_off) > 0",
                Integer.class));

    Map<String, Object> seniority = (Map<String, Object>) inputs.get("seniority");
    assertThat(seniority.get("earliest"))
        .isEqualTo(jdbc.queryForObject("SELECT min(seniority_date)::text FROM employee", String.class));
    assertThat(seniority.get("latest"))
        .isEqualTo(jdbc.queryForObject("SELECT max(seniority_date)::text FROM employee", String.class));

    // The draft keeps what it was generated with.
    HttpResponse<String> generated =
        send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}", planner);
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    UUID draft = UUID.fromString((String) mapper.readValue(generated.body(), Map.class).get("id"));
    Map<String, Object> snapshot = draftInputs(draft);
    assertThat(snapshot.get("officers")).isEqualTo(officers);
    assertThat(snapshot.get("leave")).isEqualTo(leave);
    Map<String, Object> options = (Map<String, Object>) snapshot.get("options");
    assertThat(((Number) options.get("seed")).longValue()).isEqualTo(20261001L);
    assertThat(options).containsEntry("pattern8h", null);

    // A hand edit re-scores the draft but keeps what it was generated with.
    Map<String, Object> summary =
        mapper.readValue(send("GET", "/api/v1/planner/drafts/" + draft, null, planner).body(), Map.class);
    UUID assignment =
        jdbc.queryForObject(
            "SELECT id FROM plan_draft_assignment WHERE draft_id = ? ORDER BY start_at, id LIMIT 1",
            UUID.class,
            draft);
    HttpResponse<String> removed =
        send(
            "DELETE",
            "/api/v1/planner/drafts/" + draft + "/assignments/" + assignment,
            null,
            planner,
            "\"" + summary.get("version") + "\"");
    assertThat(removed.statusCode()).as(removed.body()).isEqualTo(200);
    Map<String, Object> afterEdit = mapper.readValue(removed.body(), Map.class);
    assertThat(((Number) afterEdit.get("handEdits")).intValue()).isEqualTo(1);
    assertThat(draftInputs(draft)).isEqualTo(snapshot);

    // Staff change after the draft: live inputs move, the draft's snapshot does not.
    jdbc.update(
        "UPDATE employee SET fte = 0.5 WHERE id = (SELECT id FROM employee WHERE fte = 1.0"
            + " ORDER BY employee_no LIMIT 1)");
    Map<String, Object> after = (Map<String, Object>) inputs().get("officers");
    assertThat(after.get("partTime")).isEqualTo(32);
    assertThat(((Map<String, Object>) draftInputs(draft).get("officers")).get("partTime"))
        .isEqualTo(31);
  }

  @Test
  @SuppressWarnings("unchecked")
  void aClosureAndAForcedPatternAreReportedAsTheGeneratorUsesThem() throws Exception {
    reset("100");
    // Dataset 100: Unit C closes from 15 Feb, so the quarter has two
    // staffing stretches; the floor is the one that needs the most officers, with its dates.
    UUID unitC = jdbc.queryForObject("SELECT id FROM unit WHERE code = 'C'", UUID.class);
    HttpResponse<String> closed =
        send(
            "POST",
            "/api/v1/planner/units/" + unitC + "/closures",
            "{\"closedFrom\":\"2027-02-15\",\"reason\":\"Plan inputs test\"}",
            planner);
    assertThat(closed.statusCode()).as(closed.body()).isEqualTo(201);
    List<Map<String, Object>> periods = staffingPeriods();
    assertThat(periods).hasSize(2);
    Map<String, Object> busiest =
        periods.stream()
            .max(
                java.util.Comparator.comparingInt(
                    period -> (int) ((Map<String, Object>) period.get("totals")).get("needed")))
            .orElseThrow();
    Map<String, Object> officers = (Map<String, Object>) inputs().get("officers");
    assertThat(officers.get("neededFte"))
        .isEqualTo(((Map<String, Object>) busiest.get("totals")).get("needed"));
    assertThat(officers.get("neededFrom")).isEqualTo(busiest.get("from"));
    assertThat(officers.get("neededTo")).isEqualTo(busiest.get("to"));
    assertThat(officers.get("neededPeriods")).isEqualTo(2);
    int closedDays =
        ((List<Map<String, Object>>) inputs().get("units"))
            .stream()
                .filter(unit -> "C".equals(unit.get("code")))
                .mapToInt(unit -> (int) unit.get("closedDays"))
                .sum();
    assertThat(closedDays).as("15 Feb to 11 Apr").isEqualTo(56);

    // The one-release facility override: the snapshot's groups follow the forced pattern.
    HttpResponse<String> generated =
        send(
            "POST",
            "/api/v1/planner/drafts",
            "{\"seed\":20261001,\"pattern8h\":\"7_ON_3_OFF\"}",
            planner);
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    UUID draft = UUID.fromString((String) mapper.readValue(generated.body(), Map.class).get("id"));
    Map<String, Object> snapshot = draftInputs(draft);
    assertThat((Map<String, Object>) snapshot.get("options")).containsEntry("pattern8h", "7_ON_3_OFF");
    List<String> patterns =
        ((List<Map<String, Object>>) snapshot.get("units"))
            .stream()
                .flatMap(unit -> ((List<Map<String, Object>>) unit.get("groups")).stream())
                .filter(group -> (int) group.get("hours") == 8)
                .map(group -> (String) group.get("pattern"))
                .distinct()
                .toList();
    assertThat(patterns).contains("7_ON_3_OFF").doesNotContain("ROTATING_5_2", "5_ON_2_OFF");
  }

  @Test
  void onlyThePlannerMayReadTheInputs() throws Exception {
    for (String user :
        new String[] {"m.ellis", "j.chen", "t.nakamura", "a.reviewer", "tv.display", "l.fraser", "p.singh"}) {
      assertThat(send("GET", "/api/v1/planner/inputs", null, login(user)).statusCode())
          .as(user)
          .isEqualTo(403);
    }
    HttpResponse<String> anonymous =
        client.send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/planner/inputs"))
                .GET()
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(anonymous.statusCode()).as("no token").isEqualTo(401);
    assertThat(send("GET", "/api/v1/planner/inputs", null, planner).statusCode()).isEqualTo(200);
  }

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> staffingPeriods() throws Exception {
    HttpResponse<String> response = send("GET", "/api/v1/planner/staffing", null, planner);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return (List<Map<String, Object>>) mapper.readValue(response.body(), Map.class).get("periods");
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> draftInputs(UUID draft) throws Exception {
    Map<String, Object> summary =
        mapper.readValue(
            send("GET", "/api/v1/planner/drafts/" + draft, null, planner).body(), Map.class);
    Map<String, Object> scorecard = (Map<String, Object>) summary.get("scorecard");
    assertThat(scorecard).containsKey("inputs");
    return (Map<String, Object>) scorecard.get("inputs");
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> inputs() throws Exception {
    HttpResponse<String> response = send("GET", "/api/v1/planner/inputs", null, planner);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return mapper.readValue(response.body(), Map.class);
  }

  private static double round1(double value) {
    return Math.round(value * 10.0) / 10.0;
  }

  private void reset(String dataset) throws Exception {
    HttpResponse<String> started =
        send(
            "POST",
            "/api/v1/demo/reset",
            "{\"confirm\":\"RESET\",\"dataset\":\"" + dataset + "\"}",
            planner);
    assertThat(started.statusCode()).as(started.body()).isEqualTo(200);
    long deadline = System.nanoTime() + 180_000_000_000L;
    while (System.nanoTime() < deadline) {
      Map<?, ?> status =
          mapper.readValue(
              send("GET", "/api/v1/demo/reset/status", null, planner).body(), Map.class);
      if ("DONE".equals(status.get("state"))) {
        return;
      }
      if ("FAILED".equals(status.get("state"))) {
        throw new AssertionError(status.toString());
      }
      Thread.sleep(300);
    }
    throw new AssertionError("reset did not finish");
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
    return send(method, path, body, token, null);
  }

  private HttpResponse<String> send(
      String method, String path, String body, String token, String ifMatch) throws Exception {
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
    if (ifMatch != null) {
      builder.header("If-Match", ifMatch);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
