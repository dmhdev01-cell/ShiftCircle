package ca.shiftcircle.api.security;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
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
 * Release v1.3 S4 (owner answer Q3, brought forward from S5): since S4 links J. Chen and M. Ellis to
 * supervisor records inside their own scope, every supervisor write path on a shift, a time entry,
 * an absence, an overtime offer or confirm and an override refuses the caller's own record with 403
 * and the plan's plain words. Another supervisor in scope may still do it, and the employee still
 * accepts their own offer on My schedule.
 *
 * <p>The security gate's live case is the first test: j.chen recording 14 h on their own 8 h shift.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"sc.demo.generate=true", "sc.demo.today=2026-11-19"})
@ActiveProfiles("demo")
class SelfEditGuardApiTest {

  private static final String OWN = "You can't change your own schedule; ask another supervisor.";

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;
  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();
  private String chen;
  private String ellis;
  private UUID chenId;
  private UUID supO;

  @BeforeEach
  void signIn() throws Exception {
    chen = login("j.chen");
    ellis = login("m.ellis");
    chenId =
        jdbc.queryForObject(
            "SELECT employee_id FROM app_user WHERE username = 'j.chen'", UUID.class);
    supO = jdbc.queryForObject("SELECT id FROM unit WHERE code = 'SUP-O'", UUID.class);
  }

  /** j.chen's own rostered shift in the open pay period (9 - 22 Nov), before "today". */
  private UUID chensOwnShift() {
    return jdbc.queryForObject(
        "SELECT id FROM shift_assignment WHERE employee_id = ? AND status <> 'CANCELLED'"
            + " AND kind = 'ROSTERED' AND work_date BETWEEN DATE '2026-11-16' AND DATE '2026-11-18'"
            + " ORDER BY start_at LIMIT 1",
        UUID.class,
        chenId);
  }

  @Test
  void theLiveCaseJChenCannotRecordFourteenHoursOnTheirOwnShift() throws Exception {
    UUID shift = chensOwnShift();
    Double before = hours(shift);
    HttpResponse<String> response =
        send(
            "PUT",
            "/api/v1/time-entries/" + shift,
            "{\"actualStart\":\"2026-11-18T21:00:00Z\",\"actualEnd\":\"2026-11-19T11:00:00Z\"}",
            chen,
            null);
    assertOwn(response);
    assertThat(hours(shift)).as("nothing stored").isEqualTo(before);

    // Clearing it or calling it an absence is refused the same way.
    assertOwn(send("DELETE", "/api/v1/time-entries/" + shift, null, chen, null));
    assertOwn(
        send(
            "POST",
            "/api/v1/absences",
            "{\"assignmentId\":\"" + shift + "\",\"type\":\"SICK\"}",
            chen,
            null));
    assertThat(hours(shift)).isEqualTo(before);

    // Another supervisor with the post in scope records it.
    HttpResponse<String> byEllis =
        send(
            "PUT",
            "/api/v1/time-entries/" + shift,
            "{\"workedAsScheduled\":true}",
            ellis,
            null);
    assertThat(byEllis.statusCode()).as(byEllis.body()).isEqualTo(200);
  }

  @Test
  void aSupervisorCannotAssignMoveCancelOrOverrideTheirOwnShift() throws Exception {
    String own =
        "{\"change\":{\"employeeId\":\"" + chenId + "\",\"unitId\":\"" + supO + "\","
            + "\"shiftTemplate\":\"D8\",\"type\":\"EXTRA\","
            + "\"startAt\":\"2026-11-27T07:00:00-06:00\"}";
    assertOwn(send("POST", "/api/v1/assignments", own + "}", chen, null));
    // An override with a reason is still a change to one's own schedule.
    assertOwn(
        send(
            "POST",
            "/api/v1/assignments",
            own + ",\"override\":{\"reason\":\"Emergency cover, nobody else free\"}}",
            chen,
            null));

    UUID shift = chensOwnShift();
    int version =
        jdbc.queryForObject(
            "SELECT version FROM shift_assignment WHERE id = ?", Integer.class, shift);
    assertOwn(send("PATCH", "/api/v1/assignments/" + shift, own + "}", chen, version));
    assertOwn(
        send(
            "DELETE",
            "/api/v1/assignments/" + shift,
            "{\"reason\":\"Taking the day off myself\"}",
            chen,
            version));
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM shift_assignment WHERE id = ?", String.class, shift))
        .isNotEqualTo("CANCELLED");

    // Moving another supervisor's shift onto oneself is refused too.
    UUID ellisShift =
        jdbc.queryForObject(
            "SELECT s.id FROM shift_assignment s JOIN app_user a ON a.employee_id = s.employee_id"
                + " WHERE a.username = 'm.ellis' AND s.status <> 'CANCELLED'"
                + " AND s.work_date > DATE '2026-11-19' ORDER BY s.start_at LIMIT 1",
            UUID.class);
    int ellisVersion =
        jdbc.queryForObject(
            "SELECT version FROM shift_assignment WHERE id = ?", Integer.class, ellisShift);
    assertOwn(send("PATCH", "/api/v1/assignments/" + ellisShift, own + "}", chen, ellisVersion));
  }

  @Test
  @SuppressWarnings("unchecked")
  void aSupervisorCannotOfferGiveOrConfirmOvertimeToThemselves() throws Exception {
    // A day J. Chen is off, with 8 h of rest either side of a 07:00-15:00 D8, so the accept is
    // not blocked by the rules.
    String freeDay =
        jdbc.queryForObject(
            "SELECT d::date::text FROM generate_series(DATE '2026-11-24', DATE '2026-12-20',"
                + " interval '1 day') AS d WHERE NOT EXISTS (SELECT 1 FROM shift_assignment s"
                + " WHERE s.employee_id = ? AND s.status <> 'CANCELLED'"
                + " AND s.start_at < (d::date + TIME '23:00') AT TIME ZONE 'America/Regina'"
                + " AND s.end_at > (d::date - 1 + TIME '23:00') AT TIME ZONE 'America/Regina')"
                + " ORDER BY d LIMIT 1",
            String.class,
            chenId);
    HttpResponse<String> created =
        send(
            "POST",
            "/api/v1/open-shifts",
            "{\"unitId\":\"" + supO + "\",\"shiftTemplate\":\"D8\","
                + "\"startAt\":\"" + freeDay + "T07:00:00-06:00\",\"reason\":\"SICK_CALL\"}",
            ellis,
            null);
    assertThat(created.statusCode()).as(created.body()).isEqualTo(201);
    UUID openShift =
        UUID.fromString((String) mapper.readValue(created.body(), Map.class).get("id"));

    assertOwn(
        send(
            "POST",
            "/api/v1/open-shifts/" + openShift + "/offers",
            "{\"employeeIds\":[\"" + chenId + "\"],\"ordered\":false}",
            chen,
            null));
    assertOwn(
        send(
            "POST",
            "/api/v1/open-shifts/" + openShift + "/assign",
            "{\"employeeId\":\"" + chenId + "\"}",
            chen,
            null));
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM overtime_offer WHERE open_shift_id = ?",
                Integer.class,
                openShift))
        .as("a refused offer writes nothing")
        .isZero();

    // An offer to j.chen that j.chen accepted: only another supervisor confirms it.
    UUID accepted = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO overtime_offer (id, open_shift_id, employee_id, rank, status, offered_at,"
            + " responded_at) VALUES (?, ?, ?, 1, 'ACCEPTED', now(), now())",
        accepted,
        openShift,
        chenId);
    assertOwn(send("POST", "/api/v1/offers/" + accepted + "/confirm", null, chen, null));
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM open_shift WHERE id = ?", String.class, openShift))
        .isEqualTo("OPEN");

    // The employee's own consent stays theirs: accepting an offer is not the self-edit refusal.
    UUID offered = UUID.randomUUID();
    jdbc.update("DELETE FROM overtime_offer WHERE id = ?", accepted);
    jdbc.update(
        "INSERT INTO overtime_offer (id, open_shift_id, employee_id, rank, status, offered_at)"
            + " VALUES (?, ?, ?, 1, 'OFFERED', now())",
        offered,
        openShift,
        chenId);
    HttpResponse<String> accept =
        send("POST", "/api/v1/offers/" + offered + "/accept", null, chen, null);
    assertThat(accept.statusCode()).as(accept.body()).isEqualTo(200);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM overtime_offer WHERE id = ?", String.class, offered))
        .isEqualTo("ACCEPTED");
  }

  private void assertOwn(HttpResponse<String> response) {
    assertThat(response.statusCode()).as(response.body()).isEqualTo(403);
    assertThat(response.body()).contains(OWN);
  }

  private Double hours(UUID assignment) {
    return jdbc
        .queryForList(
            "SELECT hours FROM time_entry WHERE shift_assignment_id = ?", Double.class, assignment)
        .stream()
        .findFirst()
        .orElse(null);
  }

  @SuppressWarnings("unchecked")
  private String login(String username) throws Exception {
    HttpResponse<String> response =
        send("POST", "/api/v1/auth/mock-login", "{\"userId\":\"" + username + "\"}", null, null);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private HttpResponse<String> send(
      String method, String path, String body, String token, Integer ifMatch) throws Exception {
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
    if (ifMatch != null) {
      builder.header("If-Match", "\"" + ifMatch + "\"");
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
