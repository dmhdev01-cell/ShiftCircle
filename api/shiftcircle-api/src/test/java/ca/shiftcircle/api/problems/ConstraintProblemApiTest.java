package ca.shiftcircle.api.problems;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * A database constraint that fires under the api must come back as a problem document, never as a
 * raw 500 (dev-qa's finding, 2026-11-20).
 *
 * <p>The bug: {@code PayrollProblemAdvice} handled every {@code DataIntegrityViolationException} but
 * rethrew the ones whose SQLSTATE it did not recognise. Two advices then claimed the same
 * exception, and the rethrow aborted the handler resolution, so the generic 409 in
 * {@code ApiProblemAdvice} never ran. An emergency-overridden assignment that overlapped an
 * existing shift reached the exclusion constraint and answered 500.
 *
 * <p>These tests go through HTTP on purpose: the advice was unit-tested, so the wiring was never
 * exercised the way the live app resolves it.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class ConstraintProblemApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final UUID UNIT_B = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final UUID EMPLOYEE = UUID.fromString("33333333-3333-3333-3333-000000000088");

  /** The officer already works Friday 12:00 to Saturday 00:00 (P12). */
  private static final OffsetDateTime EXISTING_START = OffsetDateTime.parse("2026-11-20T12:00:00-06:00");
  private static final OffsetDateTime EXISTING_END = OffsetDateTime.parse("2026-11-21T00:00:00-06:00");

  @BeforeEach
  void fixture() {
    jdbc.update("DELETE FROM overtime_offer WHERE employee_id = ?", EMPLOYEE);
    jdbc.update(
        "DELETE FROM open_shift WHERE unit_id = ? AND start_at = ?",
        UNIT_B,
        Timestamp.from(Instant.parse("2026-11-20T21:00:00Z")));
    jdbc.update("DELETE FROM time_entry WHERE employee_id = ?", EMPLOYEE);
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", EMPLOYEE);
    jdbc.update("DELETE FROM override");
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, 'E-CP', 'Case', 'Overlap', ?, DATE '2019-01-01')"
            + " ON CONFLICT (id) DO UPDATE SET active = true",
        EMPLOYEE,
        UNIT_B);
    insertAssignment(EXISTING_START, EXISTING_END, "P12");
  }

  // ---------------------------------------------------------------------------------------------
  // The overlapping save
  // ---------------------------------------------------------------------------------------------

  @Test
  void anOverlappingEmergencyOverrideAnswersAConflictAndSavesNothing() throws Exception {
    String token = login("m.ellis");
    // 15:00 on Friday sits inside the officer's existing 12:00 to 00:00 shift.
    String body = change("D8", "2026-11-20T15:00:00-06:00");
    List<String> warnCodes =
        new ArrayList<>(warnCodes(post("/api/v1/rule-checks", body, token)));

    HttpResponse<String> response =
        post("/api/v1/assignments", withOverride(body, warnCodes), token);

    assertThat(response.statusCode())
        .as("the exclusion constraint is a conflict, not a server failure")
        .isEqualTo(409);
    assertThat(response.headers().firstValue("Content-Type")).contains("application/problem+json");
    Map<?, ?> problem = mapper.readValue(response.body(), Map.class);
    assertThat(problem.get("status")).isEqualTo(409);
    assertThat(problem.get("title").toString().toLowerCase()).contains("already has a shift");
    assertThat(problem.get("detail").toString().toLowerCase()).contains("move or cancel");
    assertThat(response.body())
        .as("no SQL text, no constraint name, no stack trace")
        .doesNotContain("23P01")
        .doesNotContain("no_overlapping_shifts")
        .doesNotContain("org.postgresql")
        .doesNotContain("Exception");

    assertThat(count("SELECT count(*) FROM shift_assignment WHERE employee_id = ?", EMPLOYEE))
        .as("nothing was saved")
        .isEqualTo(1);
    assertThat(count("SELECT count(*) FROM override")).as("no override row either").isZero();
  }

  @Test
  void movingAShiftOntoAnotherOneAnswersAConflict() throws Exception {
    UUID movable = insertAssignment(
        OffsetDateTime.parse("2026-11-25T07:00:00-06:00"),
        OffsetDateTime.parse("2026-11-25T15:00:00-06:00"),
        "D8");
    String token = login("m.ellis");
    // The target is the slot the officer already works.
    String body = change("D8", "2026-11-20T12:00:00-06:00");
    List<String> warnCodes =
        new ArrayList<>(warnCodes(post("/api/v1/rule-checks", body, token)));

    HttpResponse<String> response =
        send(
            "PATCH",
            "/api/v1/assignments/" + movable,
            withOverride(body, warnCodes),
            token,
            "\"0\"");

    assertThat(response.statusCode())
        .as("moving onto an existing shift is a conflict")
        .isEqualTo(409);
    assertThat(response.headers().firstValue("Content-Type")).contains("application/problem+json");
    assertThat(response.body())
        .doesNotContain("23P01")
        .doesNotContain("no_overlapping_shifts")
        .doesNotContain("org.postgresql");

    assertThat(
            jdbc.queryForObject(
                "SELECT start_at FROM shift_assignment WHERE id = ?", Timestamp.class, movable))
        .as("the refused move left the shift where it was")
        .isEqualTo(Timestamp.from(OffsetDateTime.parse("2026-11-25T07:00:00-06:00").toInstant()));
  }

  @Test
  void anOvertimeConfirmThatWouldOverlapIsRefusedBeforeTheDatabaseIsAsked() throws Exception {
    // The confirm path checks the overlap itself, so it never reaches the constraint. It must still
    // answer a problem document, not a 500.
    UUID openShift = insertOpenShift(
        OffsetDateTime.parse("2026-11-20T15:00:00-06:00"),
        OffsetDateTime.parse("2026-11-20T23:00:00-06:00"),
        "D8");
    UUID offer = insertOffer(openShift);
    String token = login("m.ellis");

    HttpResponse<String> response = post("/api/v1/offers/" + offer + "/confirm", null, token);

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.headers().firstValue("Content-Type")).contains("application/problem+json");
    assertThat((String) mapper.readValue(response.body(), Map.class).get("type"))
        .endsWith("/officer-unavailable");
    assertThat(count("SELECT count(*) FROM shift_assignment WHERE employee_id = ?", EMPLOYEE))
        .isEqualTo(1);
  }

  // ---------------------------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------------------------

  private String change(String template, String startAt) {
    return "{\"change\":{\"employeeId\":\"" + EMPLOYEE + "\",\"unitId\":\"" + UNIT_B + "\","
        + "\"shiftTemplate\":\"" + template + "\",\"startAt\":\"" + startAt + "\"}}";
  }

  private String withOverride(String body, List<String> warnCodes) {
    return body.substring(0, body.length() - 1)
        + ",\"acknowledgeWarnings\":"
        + mapper.writeValueAsString(warnCodes)
        + ",\"override\":{\"reason\":\"Lockdown, relief unavailable\"}}";
  }

  private List<String> warnCodes(HttpResponse<String> preview) throws Exception {
    Map<?, ?> body = mapper.readValue(preview.body(), Map.class);
    List<String> codes = new ArrayList<>();
    Object results = body.get("ruleResults");
    if (results instanceof List<?> list) {
      for (Object entry : list) {
        Map<?, ?> result = (Map<?, ?>) entry;
        if ("WARN".equals(result.get("outcome"))) {
          codes.add((String) result.get("ruleCode"));
        }
      }
    }
    return codes;
  }

  private UUID insertAssignment(OffsetDateTime start, OffsetDateTime end, String template) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) SELECT ?, ?, ?, t.id, ?, ?, ?, 'ROSTERED', 'MANUAL'"
            + " FROM shift_template t WHERE t.code = ?",
        id,
        EMPLOYEE,
        UNIT_B,
        Timestamp.from(start.toInstant()),
        Timestamp.from(end.toInstant()),
        start.atZoneSameInstant(REGINA).toLocalDate(),
        template);
    return id;
  }

  private UUID insertOpenShift(OffsetDateTime start, OffsetDateTime end, String template) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO open_shift (id, unit_id, shift_template_id, start_at, end_at, reason, status)"
            + " SELECT ?, ?, t.id, ?, ?, 'SICK_CALL', 'OFFERED' FROM shift_template t"
            + " WHERE t.code = ?",
        id,
        UNIT_B,
        Timestamp.from(start.toInstant()),
        Timestamp.from(end.toInstant()),
        template);
    return id;
  }

  private UUID insertOffer(UUID openShift) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO overtime_offer (id, open_shift_id, employee_id, rank, status, offered_at)"
            + " VALUES (?, ?, ?, 1, 'ACCEPTED', now())",
        id,
        openShift,
        EMPLOYEE);
    return id;
  }

  private HttpResponse<String> post(String path, String body, String token) throws Exception {
    return send("POST", path, body, token, null);
  }

  private HttpResponse<String> send(
      String method, String path, String body, String token, String ifMatch) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body == null) {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    } else {
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    }
    if (token != null) {
      builder.header("Authorization", "Bearer " + token);
    }
    if (ifMatch != null) {
      builder.header("If-Match", ifMatch);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
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
    assertThat(response.statusCode()).isEqualTo(200);
    return (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  private int count(String sql, Object... arguments) {
    Integer value = jdbc.queryForObject(sql, Integer.class, arguments);
    return value == null ? 0 : value;
  }
}
