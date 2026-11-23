package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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

/** Release 7 #27: the planner edits one draft shift; rules, recompute, audit and versions. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"sc.demo.generate=true", "sc.demo.today=2026-11-19"})
@ActiveProfiles("demo")
class PlanDraftEditApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;
  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();
  private String planner;
  private String supervisor;

  @BeforeAll
  void login() throws Exception {
    planner = loginToken("p.planner");
    supervisor = loginToken("m.ellis");
  }

  @Test
  void plannerEditsAreRuleCheckedRecomputedAuditedAndCommitted() throws Exception {
    reset120();
    UUID draft = generate();
    String before = fingerprint(draft);
    int version = version(draft);
    Map<String, Object> scorecardBefore = scorecard(draft);

    Map<String, Object> row = firstAssignment(draft);
    UUID assignmentId = (UUID) row.get("id");
    String body = body(row);

    // Preview saves nothing; include the assignment id so it is an edit preview, not an add.
    Map<String, Object> previewInput = mapper.readValue(body, Map.class);
    previewInput.put("assignmentId", assignmentId);
    HttpResponse<String> preview =
        send(
            "POST",
            "/api/v1/planner/drafts/" + draft + "/assignment-checks",
            mapper.writeValueAsString(previewInput),
            planner,
            null);
    assertThat(preview.statusCode()).as(preview.body()).isEqualTo(200);
    assertThat(version(draft)).isEqualTo(version);
    assertThat(count(draft)).isEqualTo(5103);

    // Remove, then add the same shift back: the draft is restored and the scorecard is recomputed.
    HttpResponse<String> removed =
        send("DELETE", "/api/v1/planner/drafts/" + draft + "/assignments/" + assignmentId, null, planner, version);
    assertThat(removed.statusCode()).as(removed.body()).isEqualTo(200);
    Map<String, Object> removedBody = json(removed);
    assertThat(((Number) removedBody.get("handEdits")).intValue()).isEqualTo(1);
    assertThat(((Number) removedBody.get("version")).intValue()).isEqualTo(version + 1);
    assertThat(removedBody.get("scorecard")).isNotNull();
    assertThat((List<?>) removedBody.get("gaps")).isNotNull();
    version = ((Number) removedBody.get("version")).intValue();

    HttpResponse<String> added =
        send("POST", "/api/v1/planner/drafts/" + draft + "/assignments", body, planner, version);
    assertThat(added.statusCode()).as(added.body()).isEqualTo(201);
    Map<String, Object> addedBody = json(added);
    UUID addedId = UUID.fromString((String) addedBody.get("assignmentId"));
    version = ((Number) addedBody.get("version")).intValue();
    assertThat(((Number) addedBody.get("handEdits")).intValue()).isEqualTo(2);
    assertThat(((List<?>) addedBody.get("editedAssignmentIds")).stream().map(Object::toString).toList()).contains(addedId.toString());
    assertThat(fingerprint(draft)).as("remove + add restores the no-edit plan").isEqualTo(before);
    assertThat(scorecardOf(addedBody))
        .as("a no-op edit reproduces the generated scorecard")
        .isEqualTo(scorecardBefore);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM audit_event WHERE action = 'edit_plan_draft'",
                Integer.class))
        .as("one audit row per edit")
        .isEqualTo(2);

    // Generating again after those edits produces the unedited plan, byte for byte.
    draft = generate();
    version = version(draft);
    assertThat(fingerprint(draft))
        .as("generate after edits equals the unedited plan")
        .isEqualTo(before);
    row = firstAssignment(draft);
    body = body(row);

    // A duplicate (employee, start) is a plain 409.
    HttpResponse<String> duplicate =
        send("POST", "/api/v1/planner/drafts/" + draft + "/assignments", body, planner, version);
    assertThat(duplicate.statusCode()).isEqualTo(409);
    assertThat(duplicate.body()).contains("already has a draft shift");

    // A stale version is 412; a missing If-Match is 428.
    HttpResponse<String> stale =
        send("POST", "/api/v1/planner/drafts/" + draft + "/assignments", body, planner, version - 1);
    assertThat(stale.statusCode()).isEqualTo(412);
    assertThat(stale.body()).contains("reload");
    HttpResponse<String> noVersion =
        send("POST", "/api/v1/planner/drafts/" + draft + "/assignments", body, planner, null);
    assertThat(noVersion.statusCode()).isEqualTo(428);

    // A closed unit is a plain 409, before the rules engine.
    jdbc.update(
        "INSERT INTO unit_availability (id, unit_id, disabled_from, reason) VALUES"
            + " (gen_random_uuid(), (SELECT id FROM unit WHERE code = 'A'), DATE '2027-01-20',"
            + " 'Release 7 edit test')");
    Map<String, Object> closed = new LinkedHashMap<>(row);
    closed.put("unit_id", jdbc.queryForObject("SELECT id FROM unit WHERE code = 'A'", UUID.class));
    closed.put("work_date", java.sql.Date.valueOf("2027-01-20"));
    closed.put("start_at", Timestamp.from(java.time.Instant.parse("2027-01-20T13:00:00Z")));
    HttpResponse<String> closedResponse =
        send("POST", "/api/v1/planner/drafts/" + draft + "/assignments", body(closed), planner, version);
    assertThat(closedResponse.statusCode()).as(closedResponse.body()).isEqualTo(409);
    assertThat(closedResponse.body()).contains("closed on that date");
    jdbc.update("DELETE FROM unit_availability WHERE reason = 'Release 7 edit test'");

    // A retired shift type is a plain 400.
    Map<String, Object> retired = new LinkedHashMap<>(row);
    retired.put("template_code", "L16");
    HttpResponse<String> retiredResponse =
        send(
            "POST",
            "/api/v1/planner/drafts/" + draft + "/assignments",
            body(retired),
            planner,
            version);
    assertThat(retiredResponse.statusCode()).as(retiredResponse.body()).isEqualTo(400);
    assertThat(retiredResponse.body()).contains("retired or unknown");

    // The supervisor cannot edit a draft.
    HttpResponse<String> forbidden =
        send("POST", "/api/v1/planner/drafts/" + draft + "/assignments", body, supervisor, version);
    assertThat(forbidden.statusCode()).isEqualTo(403);

    // A Block is refused and saves nothing.
    Map<String, Object> blocking = new LinkedHashMap<>(row);
    // Choose an officer who already works that day but at another start: no duplicate, a rule
    // overlap/rest Block.
    UUID busyOfficer =
        jdbc.queryForObject(
            "SELECT a2.employee_id FROM plan_draft_assignment a2"
                + " WHERE a2.draft_id = ? AND a2.employee_id <> ? AND a2.work_date = ?"
                + " AND a2.start_at <> ? LIMIT 1",
            UUID.class,
            draft,
            row.get("employee_id"),
            row.get("work_date"),
            row.get("start_at"));
    assertThat(busyOfficer).isNotNull();
    blocking.put("employee_id", busyOfficer);
    HttpResponse<String> blocked =
        send("POST", "/api/v1/planner/drafts/" + draft + "/assignments", body(blocking), planner, version);
    assertThat(blocked.statusCode()).as(blocked.body()).isEqualTo(422);
    assertThat(blocked.body()).contains("blocked-by-rules").contains("ruleResults");

    // A warning-only move is two-step: first saves nothing, then the acknowledgement saves.
    Move warning = findWarningOnlyMove(draft);
    assertThat(warning).as("a warning-only move exists").isNotNull();
    HttpResponse<String> warned =
        send("PUT", "/api/v1/planner/drafts/" + draft + "/assignments/" + warning.assignmentId(),
            warning.body(), planner, version);
    assertThat(warned.statusCode()).isEqualTo(422);
    assertThat(warned.body()).contains("warnings-need-acknowledgement");
    Map<String, Object> ack = mapper.readValue(warning.body(), Map.class);
    ack.put("acknowledgeWarnings", true);
    HttpResponse<String> kept =
        send("PUT", "/api/v1/planner/drafts/" + draft + "/assignments/" + warning.assignmentId(),
            mapper.writeValueAsString(ack), planner, version);
    assertThat(kept.statusCode()).as(kept.body()).isEqualTo(200);
    version = ((Number) json(kept).get("version")).intValue();

    // Reassign is a one-way move to another officer and records REASSIGN.
    Map<String, Object> reassignRow = firstAssignment(draft);
    Map<String, Object> reassignBody = findReassignTarget(draft, reassignRow);
    assertThat(reassignBody).as("a reassignable spare officer exists").isNotNull();
    HttpResponse<String> reassigned =
        send(
            "PUT",
            "/api/v1/planner/drafts/" + draft + "/assignments/" + reassignRow.get("id"),
            mapper.writeValueAsString(reassignBody),
            planner,
            version);
    assertThat(reassigned.statusCode()).as(reassigned.body()).isEqualTo(200);
    version = ((Number) json(reassigned).get("version")).intValue();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM audit_event WHERE action = 'edit_plan_draft'"
                    + " AND after ->> 'kind' = 'REASSIGN'",
                Integer.class))
        .as("one reassign audit row")
        .isEqualTo(1);

    Move blockMove = findBlockMove(draft);
    assertThat(blockMove).as("a blocked move exists").isNotNull();
    HttpResponse<String> blockedMove =
        send(
            "PUT",
            "/api/v1/planner/drafts/" + draft + "/assignments/" + blockMove.assignmentId(),
            blockMove.body(),
            planner,
            version);
    assertThat(blockedMove.statusCode()).as(blockedMove.body()).isEqualTo(422);
    assertThat(blockedMove.body()).contains("blocked-by-rules").contains("ruleResults");
    assertThat(version(draft)).as("a Block saves nothing").isEqualTo(version);

    // Commit still re-verifies the edited draft; after commit an edit is a 409.
    Map<String, Object> previewCommit =
        json(send("GET", "/api/v1/planner/drafts/" + draft + "/commit-preview", null, planner, null));
    int accepted = ((Number) previewCommit.get("warningCount")).intValue();
    HttpResponse<String> committed =
        send(
            "POST",
            "/api/v1/planner/drafts/" + draft + "/commit",
            "{\"acceptedWarningCount\":" + accepted + "}",
            planner,
            version);
    assertThat(committed.statusCode()).as(committed.body()).isEqualTo(200);
    HttpResponse<String> afterCommit =
        send("DELETE", "/api/v1/planner/drafts/" + draft + "/assignments/" + addedId, null, planner,
            version + 1);
    assertThat(afterCommit.statusCode()).isEqualTo(409);
    assertThat(afterCommit.body()).contains("committed or discarded");
  }

  private record Move(UUID assignmentId, String body) {}

  @SuppressWarnings("unchecked")
  private Map<String, Object> findReassignTarget(UUID draft, Map<String, Object> row)
      throws Exception {
    List<UUID> candidates =
        jdbc.queryForList(
            "SELECT e.id FROM employee e WHERE e.active AND e.id <> ?"
                + " AND NOT EXISTS (SELECT 1 FROM plan_draft_assignment a"
                + " WHERE a.draft_id = ? AND a.employee_id = e.id)"
                + " ORDER BY e.employee_no LIMIT 8",
            UUID.class,
            row.get("employee_id"),
            draft);
    for (UUID candidate : candidates) {
      Map<String, Object> body = new LinkedHashMap<>();
      body.put("assignmentId", row.get("id"));
      body.put("employeeId", candidate);
      body.put("unitId", row.get("unit_id"));
      body.put("shiftTemplate", row.get("template_code"));
      body.put("startAt", ((Timestamp) row.get("start_at")).toInstant().toString());
      body.put("kind", row.get("kind"));
      HttpResponse<String> check =
          send(
              "POST",
              "/api/v1/planner/drafts/" + draft + "/assignment-checks",
              mapper.writeValueAsString(body),
              planner,
              null);
      if (check.statusCode() != 200) continue;
      List<Map<String, Object>> results =
          (List<Map<String, Object>>) json(check).get("ruleResults");
      if (results.stream().noneMatch(result -> "BLOCK".equals(result.get("outcome")))) {
        body.put("acknowledgeWarnings", true);
        return body;
      }
    }
    return null;
  }

  @SuppressWarnings("unchecked")
  private Move findBlockMove(UUID draft) throws Exception {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT a.id, a.employee_id, a.unit_id, a.work_date, a.start_at, a.kind,"
                + " t.code AS template_code FROM plan_draft_assignment a"
                + " JOIN shift_template t ON t.id = a.shift_template_id"
                + " WHERE a.draft_id = ? ORDER BY a.start_at LIMIT 40",
            draft);
    Map<String, Integer> starts =
        Map.of("D8", 7, "E8", 15, "N8", 23, "D12", 7, "N12", 19);
    for (Map<String, Object> row : rows) {
      LocalDate sourceDate = ((java.sql.Date) row.get("work_date")).toLocalDate();
      for (int offset : new int[] {0, 1, -1}) {
        LocalDate date = sourceDate.plusDays(offset);
        if (date.isBefore(PlanGenerator.FROM) || date.isAfter(PlanGenerator.TO)) continue;
        for (Map.Entry<String, Integer> template : starts.entrySet()) {
          String code = template.getKey();
          if (code.equals(row.get("template_code")) && offset == 0) continue;
          Map<String, Object> body = new LinkedHashMap<>();
          body.put("assignmentId", row.get("id"));
          body.put("employeeId", row.get("employee_id"));
          body.put("unitId", row.get("unit_id"));
          body.put("shiftTemplate", code);
          body.put(
              "startAt",
              date.atTime(template.getValue(), 0)
                  .atZone(java.time.ZoneId.of("America/Regina"))
                  .toInstant()
                  .toString());
          body.put("kind", row.get("kind"));
          HttpResponse<String> check =
              send(
                  "POST",
                  "/api/v1/planner/drafts/" + draft + "/assignment-checks",
                  mapper.writeValueAsString(body),
                  planner,
                  null);
          if (check.statusCode() != 200) continue;
          @SuppressWarnings("unchecked")
          List<Map<String, Object>> results =
              (List<Map<String, Object>>) json(check).get("ruleResults");
          if (results.stream().anyMatch(r -> "BLOCK".equals(r.get("outcome")))) {
            return new Move((UUID) row.get("id"), mapper.writeValueAsString(body));
          }
        }
      }
    }
    return null;
  }

  @SuppressWarnings("unchecked")
  private Move findWarningOnlyMove(UUID draft) throws Exception {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT a.id, a.employee_id, a.unit_id, t.code AS template_code, a.start_at, a.kind"
                + " FROM plan_draft_assignment a JOIN shift_template t ON t.id = a.shift_template_id"
                + " WHERE a.draft_id = ? AND t.duration_minutes = 480 ORDER BY a.start_at LIMIT 20",
            draft);
    for (Map<String, Object> row : rows) {
      for (int days : new int[] {1, -1, 2, -2}) {
        InstantShift shifted = shift(row.get("start_at"), days);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("assignmentId", row.get("id"));
        body.put("employeeId", row.get("employee_id"));
        body.put("unitId", row.get("unit_id"));
        body.put("shiftTemplate", row.get("template_code"));
        body.put("startAt", shifted.start().toString());
        body.put("kind", row.get("kind"));
        HttpResponse<String> check =
            send(
                "POST",
                "/api/v1/planner/drafts/" + draft + "/assignment-checks",
                mapper.writeValueAsString(body),
                planner,
                null);
        if (check.statusCode() != 200) {
          continue;
        }
        Map<String, Object> result = json(check);
        List<Map<String, Object>> results =
            (List<Map<String, Object>>) result.get("ruleResults");
        if (results.stream().noneMatch(r -> "BLOCK".equals(r.get("outcome")))
            && results.stream().anyMatch(r -> "WARN".equals(r.get("outcome")))) {
          return new Move((UUID) row.get("id"), mapper.writeValueAsString(body));
        }
      }
    }
    return null;
  }

  private record InstantShift(java.time.Instant start) {}

  private InstantShift shift(Object rawStart, int days) {
    Timestamp timestamp = (Timestamp) rawStart;
    return new InstantShift(timestamp.toInstant().plus(java.time.Duration.ofDays(days)));
  }

  private Map<String, Object> firstAssignment(UUID draft) {
    return jdbc.queryForMap(
        "SELECT a.id, a.employee_id, a.unit_id, a.shift_template_id, a.work_date, a.start_at,"
            + " a.end_at, a.kind, t.code AS template_code FROM plan_draft_assignment a"
            + " JOIN shift_template t ON t.id = a.shift_template_id WHERE a.draft_id = ?"
            + " ORDER BY a.start_at LIMIT 1",
        draft);
  }

  private String body(Map<String, Object> row) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("employeeId", row.get("employee_id"));
    body.put("unitId", row.get("unit_id"));
    body.put("shiftTemplate", row.get("template_code"));
    body.put("startAt", ((Timestamp) row.get("start_at")).toInstant().toString());
    body.put("kind", row.get("kind"));
    return mapper.writeValueAsString(body);
  }

  private int version(UUID draft) throws Exception {
    Map<String, Object> body = json(send("GET", "/api/v1/planner/drafts/" + draft, null, planner, null));
    return ((Number) body.get("version")).intValue();
  }

  private int count(UUID draft) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ?", Integer.class, draft);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> scorecard(UUID draft) throws Exception {
    Map<String, Object> body =
        json(send("GET", "/api/v1/planner/drafts/" + draft, null, planner, null));
    return scorecardOf(body);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> scorecardOf(Map<String, Object> body) {
    Map<String, Object> card = new LinkedHashMap<>((Map<String, Object>) body.get("scorecard"));
    card.remove("generatedMs");
    Map<String, Object> warnings = (Map<String, Object>) card.get("warnings");
    if (warnings != null) {
      List<Map<String, Object>> byRule =
          new ArrayList<>((List<Map<String, Object>>) warnings.get("byRule"));
      byRule.sort(java.util.Comparator.comparing(rule -> String.valueOf(rule.get("ruleName"))));
      Map<String, Object> normalized = new LinkedHashMap<>(warnings);
      normalized.put("byRule", byRule);
      card.put("warnings", normalized);
    }
    return card;
  }

  private String fingerprint(UUID draft) {
    List<String> rows =
        jdbc.queryForList(
            "SELECT e.employee_no || '|' || u.code || '|' || t.code || '|' || a.work_date"
                + " || '|' || to_char(a.start_at AT TIME ZONE 'America/Regina', 'YYYY-MM-DD\"T\"HH24:MI')"
                + " || '|' || to_char(a.end_at AT TIME ZONE 'America/Regina', 'YYYY-MM-DD\"T\"HH24:MI')"
                + " || '|' || a.kind FROM plan_draft_assignment a JOIN employee e ON e.id = a.employee_id"
                + " JOIN unit u ON u.id = a.unit_id JOIN shift_template t ON t.id = a.shift_template_id"
                + " WHERE a.draft_id = ? ORDER BY 1",
            String.class,
            draft);
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      for (String row : rows) {
        digest.update(row.getBytes(StandardCharsets.UTF_8));
        digest.update((byte) '\n');
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (Exception impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  private void reset120() throws Exception {
    HttpResponse<String> started =
        send("POST", "/api/v1/demo/reset", "{\"confirm\":\"RESET\",\"dataset\":\"120\"}", planner, null);
    assertThat(started.statusCode()).as(started.body()).isEqualTo(200);
    long deadline = System.nanoTime() + 240_000_000_000L;
    while (System.nanoTime() < deadline) {
      Map<String, Object> status =
          json(send("GET", "/api/v1/demo/reset/status", null, planner, null));
      if ("DONE".equals(status.get("state"))) return;
      if ("FAILED".equals(status.get("state"))) throw new AssertionError(status.toString());
      Thread.sleep(250);
    }
    throw new AssertionError("reset 120 did not finish");
  }

  private UUID generate() throws Exception {
    HttpResponse<String> generated =
        send("POST", "/api/v1/planner/drafts", "{\"seed\":20261001}", planner, null);
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    return UUID.fromString((String) json(generated).get("id"));
  }

  private String loginToken(String username) throws Exception {
    HttpResponse<String> response =
        send("POST", "/api/v1/auth/mock-login", "{\"userId\":\"" + username + "\"}", null, null);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return (String) json(response).get("token");
  }

  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }

  private HttpResponse<String> send(
      String method, String path, String body, String token, Integer ifMatch) throws Exception {
    HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body != null) {
      builder.header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    if (token != null) builder.header("Authorization", "Bearer " + token);
    if (ifMatch != null) builder.header("If-Match", "\"" + ifMatch + "\"");
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
