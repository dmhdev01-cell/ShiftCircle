package ca.shiftcircle.api.demo;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
 * Release v1.3 (S4): the supervisors in Datasets 100, 120 and 150. J. Chen and M. Ellis are linked
 * to supervisor records, so My schedule answers 200 with their own shifts on every dataset instead
 * of "No employee record for this user"; the posts and their scopes come from V19; and the
 * overtime list keeps to the post's pool (S5: supervisors for a supervisor post, officers for an
 * officer post), with demo script §3's numbers unchanged.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"sc.demo.generate=true", "sc.demo.today=2026-11-19"})
@ActiveProfiles("demo")
class SupervisorDatasetsApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;
  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void theDemoSupervisorsSeeTheirOwnScheduleOnEveryDataset() throws Exception {
    // The boot seeds Dataset 100: 8 h shifts in the Oct-Dec window.
    assertOwnSchedule("m.ellis", "Morgan Ellis", "SUP-L", "2026-11-16", "2026-11-22");
    assertOwnSchedule("j.chen", "Jamie Chen", "SUP-O", "2026-11-16", "2026-11-22");
    // The overtime rank is counted inside the person's own rank: 10 supervisors, and the officer's
    // "of 100" is what it was before the supervisors.
    assertThat(overtimeRankOf("j.chen")).isEqualTo(10);
    assertThat(overtimeRankOf("t.nakamura")).isEqualTo(100);

    // Datasets 120 and 150: the D12 crews' history runs to Sun 3 Jan 2027.
    for (String dataset : List.of("120", "150")) {
      reset(dataset);
      assertOwnSchedule("m.ellis", "Morgan Ellis", "SUP-L", "2026-12-28", "2027-01-03");
      assertOwnSchedule("j.chen", "Jamie Chen", "SUP-O", "2026-12-28", "2027-01-03");
    }
    reset("100");
  }

  @Test
  void thePostsCoverTheirLineUnitsAndBothDemoSupervisorsHaveBothInScope() {
    assertThat(
            jdbc.queryForList(
                "SELECT s.code || ':' || string_agg(u.code, ',' ORDER BY u.code)"
                    + " FROM unit_supervision l JOIN unit s ON s.id = l.supervision_unit_id"
                    + " JOIN unit u ON u.id = l.unit_id GROUP BY s.code ORDER BY s.code",
                String.class))
        .containsExactly("SUP-L:A,B,C", "SUP-O:ADM,CTL,ESC");
    assertThat(
            jdbc.queryForList(
                "SELECT u.code || ' ' || r.block || ' ' || r.min_staff FROM unit_requirement r"
                    + " JOIN unit u ON u.id = r.unit_id WHERE u.kind = 'SUPERVISION'"
                    + " ORDER BY u.code, r.block",
                String.class))
        .containsExactly(
            "SUP-L DAY 1", "SUP-L EVENING 1", "SUP-L NIGHT 1",
            "SUP-O DAY 1", "SUP-O EVENING 1", "SUP-O NIGHT 1");
    assertThat(
            jdbc.queryForList(
                "SELECT a.username || ' ' || string_agg(u.code, ',' ORDER BY u.code)"
                    + " FROM user_unit_scope s JOIN app_user a ON a.id = s.user_id"
                    + " JOIN unit u ON u.id = s.unit_id GROUP BY a.username ORDER BY a.username",
                String.class))
        .as("both posts added; the officer-unit scope is unchanged")
        .contains("j.chen ADM,CTL,ESC,SUP-L,SUP-O", "m.ellis A,B,SUP-L,SUP-O");
  }

  @Test
  @SuppressWarnings("unchecked")
  void theOvertimeListStaysInsideThePostsRank() throws Exception {
    String ellis = login("m.ellis");
    // PC-08: the open Unit B day shift on Sat 21 Nov lists officers only.
    UUID lineShift =
        jdbc.queryForObject(
            "SELECT o.id FROM open_shift o JOIN unit u ON u.id = o.unit_id"
                + " JOIN shift_template t ON t.id = o.shift_template_id"
                + " WHERE u.code = 'B' AND t.code = 'D8' AND o.start_at::date = DATE '2026-11-21'"
                + " AND o.status = 'OPEN' LIMIT 1",
            UUID.class);
    List<Map<String, Object>> lineCandidates = candidates(lineShift, ellis);
    assertThat(classificationsOf(lineCandidates)).containsOnly("CO");
    // Demo script §3 (S5 keeps it): 36 candidates, 18 Skipped, 10 Not available, 8 eligible with
    // a warning, and Tara Nakamura is one of the 8 with 32.0 h this quarter.
    Map<String, Integer> byEligibility = new java.util.TreeMap<>();
    for (Map<String, Object> candidate : lineCandidates) {
      byEligibility.merge((String) candidate.get("eligibility"), 1, Integer::sum);
    }
    assertThat(lineCandidates).hasSize(36);
    assertThat(byEligibility).containsExactlyEntriesOf(
        new java.util.TreeMap<>(Map.of("SKIPPED", 18, "UNAVAILABLE", 10, "WARN", 8)));
    assertThat(lineCandidates)
        .filteredOn(c -> "Tara Nakamura".equals(c.get("name")))
        .singleElement()
        .satisfies(
            tara -> {
              assertThat(tara.get("eligibility")).isEqualTo("WARN");
              assertThat(((Number) tara.get("overtimeHoursThisQuarter")).doubleValue())
                  .isEqualTo(32.0);
            });

    // A supervisor post's open shift lists supervisors only.
    UUID post = jdbc.queryForObject("SELECT id FROM unit WHERE code = 'SUP-L'", UUID.class);
    HttpResponse<String> created =
        send(
            "POST",
            "/api/v1/open-shifts",
            "{\"unitId\":\"" + post + "\",\"shiftTemplate\":\"D8\","
                + "\"startAt\":\"2026-12-02T07:00:00-06:00\",\"reason\":\"SICK_CALL\"}",
            ellis);
    assertThat(created.statusCode()).as(created.body()).isEqualTo(201);
    UUID postShift = UUID.fromString((String) mapper.readValue(created.body(), Map.class).get("id"));
    // S5: supervisors only, because no officer in the datasets holds Acting supervisor (the
    // acting tier is proven on a fixture in OvertimeSupervisorPoolApiTest): the 10 supervisors.
    List<String> postRanks = classificationsOf(candidates(postShift, ellis));
    assertThat(postRanks).hasSize(10).containsOnly("CS");

    // The seeded supervisor sick calls (Dataset 100) went to other supervisors only, and an open
    // one is offered to another supervisor end to end through the API (plan §4 S5).
    assertThat(
            jdbc.queryForList(
                "SELECT DISTINCT e.classification FROM overtime_offer f"
                    + " JOIN open_shift o ON o.id = f.open_shift_id JOIN unit u ON u.id = o.unit_id"
                    + " JOIN employee e ON e.id = f.employee_id WHERE u.kind = 'SUPERVISION'",
                String.class))
        .containsExactly("CS");
    UUID seeded =
        jdbc.queryForObject(
            "SELECT o.id FROM open_shift o JOIN unit u ON u.id = o.unit_id"
                + " WHERE u.kind = 'SUPERVISION' AND o.status = 'OPEN'"
                + " AND o.start_at > TIMESTAMPTZ '2026-11-19 00:00:00-06' ORDER BY o.start_at LIMIT 1",
            UUID.class);
    List<Map<String, Object>> seededList = candidates(seeded, ellis);
    assertThat(classificationsOf(seededList)).containsOnly("CS");
    String ellisId =
        jdbc.queryForObject(
            "SELECT employee_id::text FROM app_user WHERE username = 'm.ellis'", String.class);
    String other =
        seededList.stream()
            .filter(c -> !ellisId.equals(c.get("employeeId")))
            .filter(c -> List.of("ELIGIBLE", "WARN").contains(c.get("eligibility")))
            .map(c -> (String) c.get("employeeId"))
            .findFirst()
            .orElseThrow();
    HttpResponse<String> offered =
        send(
            "POST",
            "/api/v1/open-shifts/" + seeded + "/offers",
            "{\"employeeIds\":[\"" + other + "\"],\"ordered\":false}",
            ellis);
    assertThat(offered.statusCode()).as(offered.body()).isEqualTo(200);
  }

  @SuppressWarnings("unchecked")
  private void assertOwnSchedule(
      String username, String name, String homePost, String from, String to) throws Exception {
    HttpResponse<String> response =
        send("GET", "/api/v1/me/schedule?from=" + from + "&to=" + to, null, login(username));
    assertThat(response.statusCode()).as(username + " " + response.body()).isEqualTo(200);
    Map<String, Object> body = mapper.readValue(response.body(), Map.class);
    Map<String, Object> employee = (Map<String, Object>) body.get("employee");
    assertThat(employee.get("name")).isEqualTo(name);
    assertThat(employee.get("position")).isEqualTo("Correctional supervisor");
    assertThat(((Map<String, Object>) employee.get("unit")).get("name"))
        .isEqualTo("SUP-L".equals(homePost) ? "Supervision · Living units" : "Supervision · Operations");
    // Release v1.3 S7: the post and the line units it covers, for the My schedule header.
    assertThat(employee.get("post"))
        .isEqualTo(
            "SUP-L".equals(homePost)
                ? "Supervision · Living units (A, B, C)"
                : "Supervision · Operations (ADM, CTL, ESC)");
    int shifts = 0;
    for (Object day : (List<Object>) body.get("shifts")) {
      for (Object item : (List<Object>) ((Map<String, Object>) day).get("items")) {
        if ("SHIFT".equals(((Map<String, Object>) item).get("type"))) {
          shifts++;
        }
      }
    }
    assertThat(shifts).as(username + " has shifts " + from + " to " + to).isPositive();
    // A supervisor works supervisor posts only: the home post, and on Dataset 100 the odd
    // overtime shift relieving the other post.
    Integer onLineUnits =
        jdbc.queryForObject(
            "SELECT count(*) FROM shift_assignment s JOIN app_user a ON a.employee_id = s.employee_id"
                + " JOIN unit u ON u.id = s.unit_id WHERE a.username = ? AND u.kind <> 'SUPERVISION'",
            Integer.class,
            username);
    assertThat(onLineUnits).as(username + " works supervisor posts only").isZero();
    Integer rostered =
        jdbc.queryForObject(
            "SELECT count(*) FROM shift_assignment s JOIN app_user a ON a.employee_id = s.employee_id"
                + " JOIN unit u ON u.id = s.unit_id WHERE a.username = ? AND s.kind = 'ROSTERED'"
                + " AND u.code <> ?",
            Integer.class,
            username,
            homePost);
    assertThat(rostered).as(username + "'s rostered shifts are on " + homePost).isZero();
  }

  @SuppressWarnings("unchecked")
  private int overtimeRankOf(String username) throws Exception {
    HttpResponse<String> response = send("GET", "/api/v1/me/schedule", null, login(username));
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    Map<String, Object> body = mapper.readValue(response.body(), Map.class);
    Map<String, Object> employee = (Map<String, Object>) body.get("employee");
    if ("t.nakamura".equals(username)) {
      // An officer is homed on a line unit: no post (release v1.3 S7).
      assertThat(employee).containsEntry("post", null);
    }
    Map<String, Object> overtime = (Map<String, Object>) body.get("overtimeThisQuarter");
    return ((Number) overtime.get("of")).intValue();
  }

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> candidates(UUID openShift, String token) throws Exception {
    HttpResponse<String> response =
        send("GET", "/api/v1/open-shifts/" + openShift + "/candidates", null, token);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return (List<Map<String, Object>>)
        mapper.readValue(response.body(), Map.class).get("candidates");
  }

  private List<String> classificationsOf(List<Map<String, Object>> candidates) {
    List<String> ranks = new ArrayList<>();
    for (Map<String, Object> candidate : candidates) {
      ranks.add(
          jdbc.queryForObject(
              "SELECT classification FROM employee WHERE id = ?",
              String.class,
              UUID.fromString((String) candidate.get("employeeId"))));
    }
    return ranks;
  }

  @SuppressWarnings("unchecked")
  private void reset(String dataset) throws Exception {
    String planner = login("p.planner");
    HttpResponse<String> started =
        send(
            "POST",
            "/api/v1/demo/reset",
            "{\"confirm\":\"RESET\",\"dataset\":\"" + dataset + "\"}",
            planner);
    assertThat(started.statusCode()).as(started.body()).isEqualTo(200);
    long deadline = System.nanoTime() + 180_000_000_000L;
    while (System.nanoTime() < deadline) {
      Map<String, Object> status =
          mapper.readValue(send("GET", "/api/v1/demo/reset/status", null, planner).body(), Map.class);
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

  @SuppressWarnings("unchecked")
  private String login(String username) throws Exception {
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
