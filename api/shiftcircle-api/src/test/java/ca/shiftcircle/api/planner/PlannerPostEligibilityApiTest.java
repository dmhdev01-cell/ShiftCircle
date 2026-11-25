package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
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
 * Release v1.3 S2 (review should 2, security L3): who can work a post runs in the planner, not only
 * on the board. The datasets have no supervisor post yet, so this class adds one ("SUP-T", one
 * supervisor per block) and closes Unit C for the quarter: Unit C's officers then form the relief
 * pool, the only path that offers an officer another unit. Since S3 the planner never cross-covers:
 * the relief pool is filtered to the post's rank, so no officer is placed on the post, not even the
 * one who holds Acting supervisor (R-01 would only warn for them), and the whole post is a gap. The
 * planner's draft edit and its commit refuse an officer on the post with R-01.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"sc.demo.generate=true", "sc.demo.today=2026-11-19"})
@ActiveProfiles("demo")
class PlannerPostEligibilityApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  private static final UUID POST = UUID.fromString("11111111-1111-1111-1111-0000000000b7");
  private static final ZoneId REGINA = ZoneId.of("America/Regina");

  @LocalServerPort private int port;
  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();
  private String planner;

  @BeforeAll
  void login() throws Exception {
    planner = loginToken("p.planner");
  }

  @Test
  @SuppressWarnings("unchecked")
  void thePlannerKeepsOfficersOffASupervisorPost() throws Exception {
    jdbc.update(
        "INSERT INTO unit (id, code, name, kind, allows_12h, allows_16h)"
            + " VALUES (?, 'SUP-T', 'Supervision · Test', 'SUPERVISION', true, false)",
        POST);
    for (String block : List.of("DAY", "EVENING", "NIGHT")) {
      jdbc.update(
          "INSERT INTO unit_requirement (unit_id, block, min_staff, effective_from)"
              + " VALUES (?, ?, 1, DATE '2026-01-01')",
          POST,
          block);
    }
    UUID unitC = jdbc.queryForObject("SELECT id FROM unit WHERE code = 'C'", UUID.class);
    jdbc.update(
        "INSERT INTO unit_availability (id, unit_id, disabled_from, reason)"
            + " VALUES (gen_random_uuid(), ?, ?, 'S2 post test')",
        unitC,
        Date.valueOf(PlanGenerator.FROM));
    List<UUID> unitCOfficers =
        jdbc.queryForList(
            "SELECT id FROM employee WHERE home_unit_id = ? AND active AND fte >= 1"
                + " ORDER BY employee_no",
            UUID.class,
            unitC);
    assertThat(unitCOfficers).hasSizeGreaterThan(2);
    UUID acting = unitCOfficers.get(0);
    UUID officer = unitCOfficers.get(1);
    jdbc.update(
        "INSERT INTO employee_qualification (employee_id, qualification_id, valid_from)"
            + " SELECT ?, id, DATE '2020-01-01' FROM qualification WHERE code = 'ACTING_SUP'",
        acting);

    // Generate: the relief pool offers Unit C's officers to every short unit, the post included.
    HttpResponse<String> generated =
        send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}", null);
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    UUID draft = UUID.fromString((String) json(generated).get("id"));

    List<UUID> onPost =
        jdbc.queryForList(
            "SELECT DISTINCT employee_id FROM plan_draft_assignment"
                + " WHERE draft_id = ? AND unit_id = ?",
            UUID.class,
            draft,
            POST);
    assertThat(onPost)
        .as("the planner never cross-covers (S3): not even the acting officer is placed")
        .isEmpty();
    long days = java.time.temporal.ChronoUnit.DAYS.between(PlanGenerator.FROM, PlanGenerator.TO) + 1;
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM plan_draft_gap WHERE draft_id = ? AND unit_id = ?",
                Integer.class,
                draft,
                POST))
        .as("with no supervisor in the data, every block-day of the post is a gap")
        .isEqualTo((int) days * 3);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ? AND unit_id <> ?"
                    + " AND employee_id IN (SELECT id FROM employee WHERE home_unit_id = ?)",
                Integer.class,
                draft,
                POST,
                unitC))
        .as("the same officers still relieve the officer posts")
        .isPositive();

    // Draft edit: a day the officer has no draft shift.
    LocalDate day = freeDay(draft, officer);
    String officerOnPost = editBody(officer, day);
    Map<String, Object> preview =
        json(send("POST", "/api/v1/planner/drafts/" + draft + "/assignment-checks", officerOnPost,
            null));
    assertThat((List<Map<String, Object>>) preview.get("ruleResults"))
        .anySatisfy(
            result -> {
              assertThat(result.get("ruleCode")).isEqualTo("R-01");
              assertThat(result.get("outcome")).isEqualTo("BLOCK");
              assertThat(result.get("overridePolicy")).isEqualTo("NONE");
            });
    Map<String, Object> actingPreview =
        json(send("POST", "/api/v1/planner/drafts/" + draft + "/assignment-checks",
            editBody(acting, freeDay(draft, acting)), null));
    assertThat((List<Map<String, Object>>) actingPreview.get("ruleResults"))
        .anySatisfy(
            result -> {
              assertThat(result.get("ruleCode")).isEqualTo("R-01");
              assertThat(result.get("outcome")).isEqualTo("WARN");
            });
    int version = version(draft);
    HttpResponse<String> refused =
        send("POST", "/api/v1/planner/drafts/" + draft + "/assignments", officerOnPost, version);
    assertThat(refused.statusCode()).as(refused.body()).isEqualTo(422);
    assertThat(refused.body()).contains("blocked-by-rules").contains("R-01");
    assertThat(version(draft)).as("a Block saves nothing").isEqualTo(version);

    // Commit re-checks every row with its post: a row that reached the draft another way is
    // refused with R-01, and nothing is written.
    Instant start = day.atTime(7, 0).atZone(REGINA).toInstant();
    jdbc.update(
        "INSERT INTO plan_draft_assignment (id, draft_id, employee_id, unit_id, shift_template_id,"
            + " work_date, start_at, end_at, kind) SELECT gen_random_uuid(), ?, ?, ?, t.id, ?, ?,"
            + " ?, 'ROSTERED' FROM shift_template t WHERE t.code = 'D8'",
        draft,
        officer,
        POST,
        Date.valueOf(day),
        Timestamp.from(start),
        Timestamp.from(start.plusSeconds(8 * 3600)));
    int accepted =
        ((Number)
                json(send("GET", "/api/v1/planner/drafts/" + draft + "/commit-preview", null, null))
                    .get("warningCount"))
            .intValue();
    HttpResponse<String> committed =
        send("POST", "/api/v1/planner/drafts/" + draft + "/commit",
            "{\"acceptedWarningCount\":" + accepted + "}", version);
    assertThat(committed.statusCode()).as(committed.body()).isEqualTo(422);
    List<Map<String, Object>> failures =
        (List<Map<String, Object>>) json(committed).get("failures");
    assertThat(failures)
        .anySatisfy(
            failure -> {
              assertThat(failure.get("unitCode")).isEqualTo("SUP-T");
              assertThat((List<String>) failure.get("ruleResults"))
                  .anySatisfy(result -> assertThat(result).startsWith("R-01:"));
            });
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment WHERE unit_id = ?", Integer.class, POST))
        .as("a refused commit writes nothing")
        .isZero();
  }

  private LocalDate freeDay(UUID draft, UUID employee) {
    Set<LocalDate> busy =
        new java.util.HashSet<>(
            jdbc.queryForList(
                    "SELECT work_date FROM plan_draft_assignment WHERE draft_id = ?"
                        + " AND employee_id = ?",
                    Date.class,
                    draft,
                    employee)
                .stream()
                .map(Date::toLocalDate)
                .toList());
    for (LocalDate day = PlanGenerator.FROM.plusDays(14); !day.isAfter(PlanGenerator.TO);
        day = day.plusDays(1)) {
      // A day off: other rules may still report (rest, runs), but R-01 is what is asserted.
      if (!busy.contains(day)) {
        return day;
      }
    }
    throw new AssertionError("no free day for " + employee);
  }

  private String editBody(UUID employee, LocalDate day) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("employeeId", employee);
    body.put("unitId", POST);
    body.put("shiftTemplate", "D8");
    body.put("startAt", day.atTime(7, 0).atZone(REGINA).toInstant().toString());
    body.put("kind", "ROSTERED");
    return mapper.writeValueAsString(body);
  }

  private int version(UUID draft) throws Exception {
    return ((Number) json(send("GET", "/api/v1/planner/drafts/" + draft, null, null))
            .get("version"))
        .intValue();
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
