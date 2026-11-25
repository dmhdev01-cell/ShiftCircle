package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Date;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * Release v1.3 S3 through the API: the datasets have no supervisors until S4, so this class adds a
 * supervisor post ("SUP-T", one supervisor on days and on evenings) and four supervisors homed on
 * it, on top of the Dataset 100 officers. Plan inputs split the people by position and the units by
 * kind; the generated draft keeps each rank on its own posts, the officer cards count the officer
 * units only, and the supervisor card, the totals, the commit preview, the compare and the commit
 * carry the split.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"sc.demo.generate=true", "sc.demo.today=2026-11-19"})
@ActiveProfiles("demo")
class PlannerSupervisorApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  private static final UUID POST = UUID.fromString("11111111-1111-1111-1111-0000000000c4");

  @LocalServerPort private int port;
  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();
  private String planner;
  private int officers;
  private int lineUnits;

  @BeforeAll
  void login() throws Exception {
    planner = loginToken("p.planner");
    officers = jdbc.queryForObject("SELECT count(*) FROM employee", Integer.class);
    lineUnits = jdbc.queryForObject("SELECT count(*) FROM unit", Integer.class);
  }

  @Test
  @Order(1)
  @SuppressWarnings("unchecked")
  void withNoSupervisorsTheInputsReadAsBefore() throws Exception {
    Map<String, Object> people = (Map<String, Object>) inputs().get("officers");
    assertThat(people.get("total")).isEqualTo(officers);
    assertThat(people.get("posts")).isEqualTo(0);
    assertThat(people.get("lineUnits")).isEqualTo(lineUnits);
    assertThat(people.get("headline")).isEqualTo(officers + " officers in " + lineUnits + " units");
    assertThat(byPosition(people, "CO").get("total")).isEqualTo(officers);
    assertThat(byPosition(people, "CS").get("total")).isEqualTo(0);
  }

  @Test
  @Order(2)
  @SuppressWarnings("unchecked")
  void theInputsSplitPeopleByPositionAndUnitsByKind() throws Exception {
    addPostAndSupervisors();
    Map<String, Object> inputs = inputs();
    Map<String, Object> people = (Map<String, Object>) inputs.get("officers");
    assertThat(people.get("total")).isEqualTo(officers + 4);
    assertThat(byPosition(people, "CO"))
        .containsEntry("total", officers)
        .containsEntry("supervisory", false);
    assertThat(byPosition(people, "CS"))
        .containsEntry("total", 4)
        .containsEntry("fullTime", 4)
        .containsEntry("partTime", 0)
        .containsEntry("supervisory", true);
    assertThat(people.get("posts")).isEqualTo(1);
    assertThat(people.get("lineUnits")).isEqualTo(lineUnits);
    assertThat(people.get("headline"))
        .isEqualTo(
            officers + " officers + 4 supervisors in " + lineUnits + " units + 1 supervisor post");

    Map<String, Object> post =
        ((List<Map<String, Object>>) inputs.get("units"))
            .stream()
                .filter(unit -> "SUP-T".equals(unit.get("code")))
                .findFirst()
                .orElseThrow();
    assertThat(post)
        .containsEntry("kind", "SUPERVISION")
        .containsEntry("supervision", true)
        .containsEntry("officers", 4);
    assertThat((List<Map<String, Object>>) post.get("groups"))
        .isNotEmpty()
        .allSatisfy(group -> assertThat(group.get("position")).isEqualTo("CS"));
  }

  @Test
  @Order(3)
  @SuppressWarnings("unchecked")
  void theDraftKeepsEachRankOnItsOwnPostsAndCarriesTheSplit() throws Exception {
    HttpResponse<String> generated =
        send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}", null);
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    Map<String, Object> draftBody = json(generated);
    UUID draft = UUID.fromString((String) draftBody.get("id"));

    // No cross-cover in either direction.
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM plan_draft_assignment a JOIN employee e"
                    + " ON e.id = a.employee_id WHERE a.draft_id = ?"
                    + " AND (e.classification = 'CS') <> (a.unit_id = ?)",
                Integer.class,
                draft,
                POST))
        .isZero();
    int postShifts =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ? AND unit_id = ?",
            Integer.class,
            draft,
            POST);
    int postGaps =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_gap WHERE draft_id = ? AND unit_id = ?",
            Integer.class,
            draft,
            POST);
    int allShifts =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ?", Integer.class, draft);
    int allGaps =
        jdbc.queryForObject(
            "SELECT count(*) FROM plan_draft_gap WHERE draft_id = ?", Integer.class, draft);
    assertThat(postShifts).isPositive();

    Map<String, Object> scorecard = (Map<String, Object>) draftBody.get("scorecard");
    long days = ChronoUnit.DAYS.between(PlanGenerator.FROM, PlanGenerator.TO) + 1;
    Map<String, Object> coverage = (Map<String, Object>) scorecard.get("coverage");
    assertThat(((Number) coverage.get("totalBlockDays")).longValue())
        .as("the officer card counts the officer units only")
        .isEqualTo(days * lineUnits * 3);
    assertThat(coverage.get("shortBlockDays")).isEqualTo(allGaps - postGaps);

    Map<String, Object> card = (Map<String, Object>) scorecard.get("supervisors");
    assertThat(card).containsEntry("supervisors", 4).containsEntry("posts", 1);
    assertThat(card.get("shifts")).isEqualTo(postShifts);
    Map<String, Object> postCoverage = (Map<String, Object>) card.get("coverage");
    // SUP-T has a minimum on days and evenings only: two block-days a day, not three.
    assertThat(((Number) postCoverage.get("totalBlockDays")).longValue()).isEqualTo(days * 2);
    assertThat(postCoverage.get("shortBlockDays")).isEqualTo(postGaps);
    assertThat(((Number) postCoverage.get("coveredBlockDays")).longValue())
        .isEqualTo(days * 2 - postGaps);

    Map<String, Object> totals = (Map<String, Object>) scorecard.get("totals");
    assertThat(totals)
        .containsEntry("shifts", allShifts)
        .containsEntry("supervisorShifts", postShifts)
        .containsEntry("officerShifts", allShifts - postShifts)
        .containsEntry("supervisors", 4);

    Map<String, Object> preview =
        json(send("GET", "/api/v1/planner/drafts/" + draft + "/commit-preview", null, null));
    assertThat(preview)
        .containsEntry("shiftsToWrite", allShifts)
        .containsEntry("supervisorShifts", postShifts)
        .containsEntry("officerShifts", allShifts - postShifts)
        .containsEntry("supervisors", 4)
        .containsEntry("officers", totals.get("officers"));

    Map<String, Object> compare =
        json(send("GET", "/api/v1/planner/drafts/" + draft + "/compare", null, null));
    Map<String, Map<String, Object>> rows = new LinkedHashMap<>();
    ((List<Map<String, Object>>) compare.get("rows"))
        .forEach(row -> rows.put((String) row.get("key"), row));
    assertThat(((Number) rows.get("supervisorShifts").get("draft")).intValue())
        .isEqualTo(postShifts);
    assertThat(((Number) rows.get("officerShifts").get("draft")).intValue())
        .isEqualTo(allShifts - postShifts);
    assertThat(((Number) rows.get("supervisors").get("draft")).intValue()).isEqualTo(4);
    assertThat(((Number) rows.get("officers").get("draft")).intValue())
        .isEqualTo(totals.get("officers"));

    int version = ((Number) draftBody.get("version")).intValue();
    HttpResponse<String> committed =
        send("POST", "/api/v1/planner/drafts/" + draft + "/commit",
            "{\"acceptedWarningCount\":" + preview.get("warningCount") + "}", version);
    assertThat(committed.statusCode()).as(committed.body()).isEqualTo(200);
    assertThat(json(committed))
        .containsEntry("shiftsWritten", allShifts)
        .containsEntry("supervisorShifts", postShifts)
        .containsEntry("officerShifts", allShifts - postShifts);
  }

  private void addPostAndSupervisors() {
    jdbc.update(
        "INSERT INTO unit (id, code, name, kind, allows_12h, allows_16h)"
            + " VALUES (?, 'SUP-T', 'Supervision · Test', 'SUPERVISION', false, false)",
        POST);
    for (String block : List.of("DAY", "EVENING")) {
      jdbc.update(
          "INSERT INTO unit_requirement (unit_id, block, min_staff, effective_from)"
              + " VALUES (?, ?, 1, DATE '2026-01-01')",
          POST,
          block);
    }
    for (int i = 0; i < 4; i++) {
      jdbc.update(
          "INSERT INTO employee (employee_no, first_name, last_name, classification, home_unit_id,"
              + " seniority_date, position_since) VALUES (?, 'Test', ?, 'CS', ?, ?, ?)",
          "S-T0" + i,
          "Supervisor " + i,
          POST,
          Date.valueOf(LocalDate.of(2005 + i, 1, 1)),
          Date.valueOf(LocalDate.of(2020 + i, 1, 1)));
    }
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> byPosition(Map<String, Object> people, String code) {
    return ((List<Map<String, Object>>) people.get("byPosition"))
        .stream()
            .filter(row -> code.equals(row.get("position")))
            .findFirst()
            .orElseThrow();
  }

  private Map<String, Object> inputs() throws Exception {
    HttpResponse<String> response = send("GET", "/api/v1/planner/inputs", null, null);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return json(response);
  }

  private String loginToken(String username) throws Exception {
    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"" + username + "\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return (String) json(response).get("token");
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }

  private HttpResponse<String> send(String method, String path, String body, Integer ifMatch)
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
    builder.header("Authorization", "Bearer " + planner);
    if (ifMatch != null) {
      builder.header("If-Match", "\"" + ifMatch + "\"");
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
