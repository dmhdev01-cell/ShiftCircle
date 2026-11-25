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
 * overtime list stays inside the post's rank.
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
      assertPlantedProposals(dataset);
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
    assertThat(classificationsOf(candidates(lineShift, ellis))).containsOnly("CO");

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
    List<String> postRanks = classificationsOf(candidates(postShift, ellis));
    assertThat(postRanks).isNotEmpty().containsOnly("CS");
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
    Map<String, Object> overtime =
        (Map<String, Object>)
            mapper.readValue(response.body(), Map.class).get("overtimeThisQuarter");
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

  /**
   * v1.3 P5: the 120 and 150 resets plant the same four proposals, on the first dates where the
   * rules (on that dataset's roster) do not Block, so Ellis decides 1 and Chen 2 there too.
   */
  @SuppressWarnings("unchecked")
  private void assertPlantedProposals(String dataset) throws Exception {
    assertThat(
            jdbc.queryForList(
                "SELECT e.first_name || ' ' || e.last_name || ' ' || u.code || ' ' || i.decision"
                    + " FROM proposal_item i JOIN proposal p ON p.id = i.proposal_id"
                    + " JOIN employee e ON e.id = p.employee_id"
                    + " JOIN unit u ON u.id = i.unit_id ORDER BY e.first_name, i.start_at",
                String.class))
        .as(dataset + ": the dataset's own Tara Nakamura (its T. Nakamura sign-in is not linked)")
        .containsExactly(
            "Morgan Ellis SUP-L PENDING",
            "Tara Nakamura B EXPIRED",
            "Tara Nakamura ADM DECLINED",
            "Tara Nakamura B PENDING",
            "Tara Nakamura ADM PENDING");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM proposal_item WHERE decision = 'PENDING'"
                    + " AND rule_snapshot->>'outcome' = 'BLOCK'",
                Integer.class))
        .as(dataset)
        .isZero();
    for (Map.Entry<String, Integer> expected : Map.of("m.ellis", 1, "j.chen", 2).entrySet()) {
      HttpResponse<String> count =
          send("GET", "/api/v1/proposals/count?status=WAITING", null, login(expected.getKey()));
      assertThat(count.statusCode()).as(count.body()).isEqualTo(200);
      assertThat(((Number) mapper.readValue(count.body(), Map.class).get("count")).intValue())
          .as(dataset + " " + expected.getKey())
          .isEqualTo(expected.getValue());
    }
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
