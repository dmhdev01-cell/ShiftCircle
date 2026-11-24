package ca.shiftcircle.api.proposals;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * Shift proposals, officer side (v1.3 P1): the V18 constraints, multi-item preview, send,
 * withdraw, list, expiry, scope and the abuse limits.
 *
 * <p>The business clock is the demo day, 19 Nov 2026 at noon. The shifts proposed here are on 24 to
 * 27 Nov, after the demo day, where no other fixture lives.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class ProposalApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;
  @Autowired private ProposalExpiry expiry;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");
  private static final UUID UNIT_B = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final UUID UNIT_C = UUID.fromString("11111111-1111-1111-1111-000000000003");

  private static final UUID TARA = UUID.fromString("44444444-4444-4444-4444-0000000000a1");
  private static final UUID ELLIS = UUID.fromString("44444444-4444-4444-4444-0000000000a2");

  @BeforeEach
  void fixture() throws Exception {
    jdbc.update("DELETE FROM proposal_item");
    jdbc.update("DELETE FROM proposal");
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id IN (?, ?)", TARA, ELLIS);
    jdbc.update("DELETE FROM pay_period WHERE start_date >= DATE '2026-12-01'");
    jdbc.update("DELETE FROM unit_availability WHERE unit_id = ?", UNIT_C);
    jdbc.update("UPDATE app_user SET employee_id = NULL WHERE username IN ('t.nakamura', 'm.ellis')");
    insertEmployee(TARA, "E-PR1", "Tara", "Proposer");
    insertEmployee(ELLIS, "E-PR2", "Mel", "Other");
    jdbc.update("UPDATE app_user SET employee_id = ? WHERE username = 't.nakamura'", TARA);
    jdbc.update("UPDATE app_user SET employee_id = ? WHERE username = 'm.ellis'", ELLIS);
    for (String user : new String[] {"t.nakamura", "m.ellis", "j.chen", "a.reviewer"}) {
      tokens.put(user, login(user));
    }
  }

  // ---------------------------------------------------------------------------------------------
  // V18 constraints
  // ---------------------------------------------------------------------------------------------

  @Test
  void v18RefusesALongNoteAndAnOldStatusWord() {
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "INSERT INTO proposal (employee_id, note) VALUES (?, ?)",
                    TARA,
                    "x".repeat(501)))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "INSERT INTO proposal (employee_id, status) VALUES (?, 'SUBMITTED')", TARA))
        .isInstanceOf(DataIntegrityViolationException.class);
    jdbc.update("INSERT INTO proposal (employee_id, note) VALUES (?, ?)", TARA, "x".repeat(500));
  }

  @Test
  void v18RefusesAnAddWithoutTheWholeShiftAndADeclineWithoutAComment() {
    UUID proposal = insertProposal(TARA);
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "INSERT INTO proposal_item (proposal_id, employee_id, action) VALUES (?, ?, 'ADD')",
                    proposal,
                    TARA))
        .isInstanceOf(DataIntegrityViolationException.class);

    UUID item = insertItem(proposal, TARA, "2026-11-25T07:00:00-06:00", "D8", UNIT_A, "PENDING");
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "UPDATE proposal_item SET decision = 'DECLINED', comment = ' no' WHERE id = ?",
                    item))
        .isInstanceOf(DataIntegrityViolationException.class);
    jdbc.update(
        "UPDATE proposal_item SET decision = 'DECLINED', comment = 'Fully staffed' WHERE id = ?",
        item);
  }

  @Test
  void v18AllowsOneWaitingItemPerOfficerAndStartButNotTwo() {
    UUID proposal = insertProposal(TARA);
    insertItem(proposal, TARA, "2026-11-25T07:00:00-06:00", "D8", UNIT_A, "PENDING");
    assertThatThrownBy(
            () ->
                insertItem(proposal, TARA, "2026-11-25T07:00:00-06:00", "D8", UNIT_B, "PENDING"))
        .isInstanceOf(DataIntegrityViolationException.class);
    // The same start is fine once the first one is no longer waiting, or for another officer.
    insertItem(proposal, TARA, "2026-11-25T07:00:00-06:00", "D8", UNIT_B, "WITHDRAWN");
    insertItem(insertProposal(ELLIS), ELLIS, "2026-11-25T07:00:00-06:00", "D8", UNIT_A, "PENDING");
  }

  // ---------------------------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------------------------

  @Test
  void previewSeesTheOtherDraftsSoRestBetweenThemShows() throws Exception {
    Map<String, Object> day = item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00");
    Map<String, Object> evening = item(UNIT_B, "P12", "2026-11-24T12:00:00-06:00");

    // On its own the day shift passes.
    Map<String, Object> alone = json(post("/api/v1/proposals/preview", items(day), "t.nakamura"));
    assertThat(alone.get("outcome")).isEqualTo("PASS");
    assertThat(alone.get("canSend")).isEqualTo(true);

    // The P12 ends at midnight, so the 07:00 day shift next to it has 7 h of rest: Block U-01.
    // Listed first or last, the later shift carries the result, so the order typed doesn't matter.
    Map<String, Object> both =
        json(post("/api/v1/proposals/preview", items(day, evening), "t.nakamura"));
    assertThat(both.get("outcome")).isEqualTo("BLOCK");
    assertThat(both.get("canSend")).isEqualTo(false);
    List<Map<String, Object>> results = list(both, "items");
    assertThat(results).extracting(r -> r.get("outcome")).containsExactly("BLOCK", "PASS");
    assertThat(ruleCodes(results.get(0))).contains("U-01");
    assertThat(results.get(0).get("shiftTemplate")).isEqualTo("D8");
    assertThat(jdbc.queryForObject("SELECT count(*) FROM proposal", Integer.class)).isZero();
  }

  @Test
  void previewAWarningCanStillBeSent() throws Exception {
    // N8 to 07:00, then an E8 at 15:00: exactly 8 h of rest is a Warn (U-02), not a Block.
    Map<String, Object> body =
        json(
            post(
                "/api/v1/proposals/preview",
                items(
                    item(UNIT_A, "N8", "2026-11-24T23:00:00-06:00"),
                    item(UNIT_A, "E8", "2026-11-25T15:00:00-06:00")),
                "t.nakamura"));
    assertThat(body.get("outcome")).isEqualTo("WARN");
    assertThat(body.get("canSend")).isEqualTo(true);
    assertThat(ruleCodes(list(body, "items").get(1))).contains("U-02");
  }

  @Test
  void previewAlsoReadsTheOfficersSavedShifts() throws Exception {
    // Four extra shifts in the days after a real run still pass; the point of this test is that the
    // officer's real shifts and the drafts are read together (U-05, hours in 24 h).
    insertAssignment(TARA, UNIT_A, "P12", "2026-11-24T12:00:00-06:00");
    Map<String, Object> body =
        json(
            post(
                "/api/v1/proposals/preview",
                items(item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00")),
                "t.nakamura"));
    // The real P12 ends at midnight: the same 7 h rest Block, now against a saved shift.
    assertThat(body.get("outcome")).isEqualTo("BLOCK");
    assertThat(ruleCodes(list(body, "items").get(0))).contains("U-01");
  }

  // ---------------------------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------------------------

  @Test
  void submitStoresTheProposalAndAuditsItWithoutTheNoteText() throws Exception {
    Map<String, Object> request =
        items(
            item(UNIT_A, "N8", "2026-11-24T23:00:00-06:00"),
            item(UNIT_A, "E8", "2026-11-25T15:00:00-06:00"));
    request.put("note", "Happy to cover the weekend");
    HttpResponse<String> response = post("/api/v1/proposals", request, "t.nakamura");

    assertThat(response.statusCode()).isEqualTo(201);
    Map<String, Object> view = json(response);
    assertThat(view.get("status")).isEqualTo("WAITING");
    assertThat(view.get("displayState")).isEqualTo("WAITING");
    assertThat(view.get("canWithdraw")).isEqualTo(true);
    assertThat(view.get("version")).isEqualTo(0);
    List<Map<String, Object>> items = list(view, "items");
    assertThat(items).hasSize(2);
    assertThat(items).extracting(i -> i.get("decision")).containsOnly("PENDING");
    assertThat(items.get(1).get("outcomeAtSubmit")).isEqualTo("WARN");

    UUID id = UUID.fromString((String) view.get("id"));
    assertThat(
            jdbc.queryForObject(
                "SELECT employee_id FROM proposal WHERE id = ?", UUID.class, id))
        .isEqualTo(TARA);
    // The warn codes are kept with the item for the decider.
    String snapshot =
        jdbc.queryForObject(
            "SELECT rule_snapshot::text FROM proposal_item WHERE proposal_id = ? AND start_at = ?",
            String.class,
            id,
            Timestamp.from(OffsetDateTime.parse("2026-11-25T15:00:00-06:00").toInstant()));
    assertThat(snapshot).contains("U-02");
    // Nothing is a shift yet.
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment WHERE employee_id = ?",
                Integer.class,
                TARA))
        .isZero();

    Map<String, Object> audit =
        jdbc.queryForMap(
            "SELECT action, entity_type, after::text AS after FROM audit_event"
                + " WHERE entity_id = ? AND action = 'submit_proposal'",
            id);
    assertThat(audit.get("entity_type")).isEqualTo("proposal");
    assertThat((String) audit.get("after"))
        .contains("\"itemCount\": 2")
        .contains("\"noteLength\": 26")
        .doesNotContain("Happy to cover");
  }

  @Test
  void submitRefusesABlockedShiftAndSavesNothing() throws Exception {
    HttpResponse<String> response =
        post(
            "/api/v1/proposals",
            items(
                item(UNIT_B, "P12", "2026-11-24T12:00:00-06:00"),
                item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00")),
            "t.nakamura");

    assertThat(response.statusCode()).isEqualTo(422);
    Map<String, Object> problem = json(response);
    assertThat((String) problem.get("type")).endsWith("/blocked-by-rules");
    assertThat(problem.get("outcome")).isEqualTo("BLOCK");
    assertThat(list(problem, "items")).extracting(i -> i.get("outcome")).containsExactly("PASS", "BLOCK");
    assertThat(jdbc.queryForObject("SELECT count(*) FROM proposal", Integer.class)).isZero();
    assertThat(jdbc.queryForObject("SELECT count(*) FROM proposal_item", Integer.class)).isZero();
  }

  @Test
  void submitRefusesBadRequestsWith400() throws Exception {
    // A retired template (L16, V13).
    assertThat(
            post("/api/v1/proposals", items(item(UNIT_A, "L16", "2026-11-25T07:00:00-06:00")), "t.nakamura")
                .statusCode())
        .isEqualTo(400);
    // Already started: the demo day is 19 Nov and noon has passed.
    assertThat(
            post("/api/v1/proposals", items(item(UNIT_A, "D8", "2026-11-19T07:00:00-06:00")), "t.nakamura")
                .statusCode())
        .isEqualTo(400);
    // Past the end of the planned quarter.
    assertThat(
            post("/api/v1/proposals", items(item(UNIT_A, "D8", "2027-05-03T07:00:00-06:00")), "t.nakamura")
                .statusCode())
        .isEqualTo(400);
    // Nothing to send.
    assertThat(post("/api/v1/proposals", items(), "t.nakamura").statusCode()).isEqualTo(400);
    // Two items at the same time.
    assertThat(
            post(
                    "/api/v1/proposals",
                    items(
                        item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"),
                        item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00")),
                    "t.nakamura")
                .statusCode())
        .isEqualTo(400);
    // Too many items.
    List<Map<String, Object>> eleven = new ArrayList<>();
    for (int i = 0; i < 11; i++) {
      eleven.add(item(UNIT_A, "D8", "2026-12-" + String.format("%02d", i + 1) + "T07:00:00-06:00"));
    }
    Map<String, Object> tooMany = new LinkedHashMap<>();
    tooMany.put("items", eleven);
    assertThat(post("/api/v1/proposals", tooMany, "t.nakamura").statusCode()).isEqualTo(400);
    // A note that is an essay.
    Map<String, Object> longNote = items(item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"));
    longNote.put("note", "x".repeat(501));
    assertThat(post("/api/v1/proposals", longNote, "t.nakamura").statusCode()).isEqualTo(400);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM proposal", Integer.class)).isZero();
  }

  @Test
  void submitRefusesALockedPayPeriodAClosedUnitAndADuplicateWith409() throws Exception {
    jdbc.update(
        "INSERT INTO pay_period (start_date, end_date, status) VALUES (DATE '2026-12-14',"
            + " DATE '2026-12-27', 'LOCKED')");
    HttpResponse<String> locked =
        post("/api/v1/proposals", items(item(UNIT_A, "D8", "2026-12-20T07:00:00-06:00")), "t.nakamura");
    assertThat(locked.statusCode()).isEqualTo(409);
    assertThat((String) json(locked).get("type")).endsWith("/pay-period-locked");

    jdbc.update(
        "INSERT INTO unit_availability (unit_id, disabled_from, enabled_from, reason)"
            + " VALUES (?, DATE '2026-11-26', DATE '2026-12-05', 'Renovation closure')",
        UNIT_C);
    HttpResponse<String> closed =
        post("/api/v1/proposals", items(item(UNIT_C, "D8", "2026-11-27T07:00:00-06:00")), "t.nakamura");
    assertThat(closed.statusCode()).isEqualTo(409);
    assertThat((String) json(closed).get("type")).endsWith("/unit-closed");

    Map<String, Object> once = items(item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"));
    assertThat(post("/api/v1/proposals", once, "t.nakamura").statusCode()).isEqualTo(201);
    HttpResponse<String> twice = post("/api/v1/proposals", once, "t.nakamura");
    assertThat(twice.statusCode()).isEqualTo(409);
    assertThat((String) json(twice).get("type")).endsWith("/duplicate-waiting-item");
    // Another officer can propose the same shift: the limit is per officer.
    assertThat(post("/api/v1/proposals", once, "m.ellis").statusCode()).isEqualTo(201);
  }

  @Test
  void anOfficerCanHaveAtMostTwentyShiftsWaiting() throws Exception {
    UUID proposal = insertProposal(TARA);
    for (int i = 0; i < 20; i++) {
      insertItem(
          proposal,
          TARA,
          OffsetDateTime.parse("2026-12-01T07:00:00-06:00").plusDays(i).toString(),
          "D8",
          UNIT_A,
          "PENDING");
    }
    HttpResponse<String> response =
        post("/api/v1/proposals", items(item(UNIT_A, "D8", "2027-01-05T07:00:00-06:00")), "t.nakamura");
    assertThat(response.statusCode()).isEqualTo(409);
    assertThat((String) json(response).get("type")).endsWith("/too-many-waiting");
  }

  // ---------------------------------------------------------------------------------------------
  // My proposals and withdraw
  // ---------------------------------------------------------------------------------------------

  @Test
  void myProposalsListsOnlyMineNewestFirstAndFiltersByState() throws Exception {
    UUID first = send("t.nakamura", item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"));
    UUID second = send("t.nakamura", item(UNIT_A, "D8", "2026-11-26T07:00:00-06:00"));
    send("m.ellis", item(UNIT_A, "D8", "2026-11-27T07:00:00-06:00"));
    jdbc.update(
        "UPDATE proposal SET submitted_at = submitted_at - interval '1 hour' WHERE id = ?", first);

    List<Map<String, Object>> mine = listOf(get("/api/v1/me/proposals", "t.nakamura"));
    assertThat(mine).extracting(p -> p.get("id")).containsExactly(second.toString(), first.toString());

    assertThat(listOf(get("/api/v1/me/proposals?status=WAITING", "t.nakamura"))).hasSize(2);
    assertThat(listOf(get("/api/v1/me/proposals?status=APPROVED", "t.nakamura"))).isEmpty();
    assertThat(get("/api/v1/me/proposals?status=SOON", "t.nakamura").statusCode()).isEqualTo(400);
  }

  @Test
  void withdrawWorksWithTheVersionAndAuditsIt() throws Exception {
    UUID id = send("t.nakamura", item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"));
    HttpResponse<String> response = post("/api/v1/proposals/" + id + "/withdraw", null, "t.nakamura", "\"0\"");

    assertThat(response.statusCode()).isEqualTo(200);
    Map<String, Object> view = json(response);
    assertThat(view.get("status")).isEqualTo("WITHDRAWN");
    assertThat(view.get("displayState")).isEqualTo("WITHDRAWN");
    assertThat(view.get("canWithdraw")).isEqualTo(false);
    assertThat(view.get("version")).isEqualTo(1);
    assertThat(list(view, "items")).extracting(i -> i.get("decision")).containsOnly("WITHDRAWN");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM audit_event WHERE entity_id = ? AND action = 'withdraw_proposal'",
                Integer.class,
                id))
        .isEqualTo(1);
    // The same shift can be proposed again once the first is withdrawn.
    assertThat(
            post("/api/v1/proposals", items(item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00")), "t.nakamura")
                .statusCode())
        .isEqualTo(201);
  }

  @Test
  void withdrawNeedsIfMatchAndTheCurrentVersion() throws Exception {
    UUID id = send("t.nakamura", item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"));
    assertThat(post("/api/v1/proposals/" + id + "/withdraw", null, "t.nakamura").statusCode())
        .isEqualTo(428);
    assertThat(post("/api/v1/proposals/" + id + "/withdraw", null, "t.nakamura", "\"7\"").statusCode())
        .isEqualTo(412);
    assertThat(post("/api/v1/proposals/" + id + "/withdraw", null, "t.nakamura", "abc").statusCode())
        .isEqualTo(400);
    // Nothing changed by the refused calls.
    assertThat(jdbc.queryForObject("SELECT status FROM proposal WHERE id = ?", String.class, id))
        .isEqualTo("WAITING");
  }

  @Test
  void withdrawIsRefusedOnceAnItemIsDecidedAndWithdrawingTwiceIsRefused() throws Exception {
    UUID id = send(
        "t.nakamura",
        item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"),
        item(UNIT_A, "D8", "2026-11-26T07:00:00-06:00"));
    jdbc.update(
        "UPDATE proposal_item SET decision = 'ACCEPTED' WHERE proposal_id = ? AND start_at = ?",
        id,
        Timestamp.from(OffsetDateTime.parse("2026-11-25T07:00:00-06:00").toInstant()));

    HttpResponse<String> refused = post("/api/v1/proposals/" + id + "/withdraw", null, "t.nakamura", "\"0\"");
    assertThat(refused.statusCode()).isEqualTo(409);
    assertThat((String) json(refused).get("type")).endsWith("/not-withdrawable");

    UUID other = send("t.nakamura", item(UNIT_A, "D8", "2026-11-27T07:00:00-06:00"));
    assertThat(post("/api/v1/proposals/" + other + "/withdraw", null, "t.nakamura", "\"0\"").statusCode())
        .isEqualTo(200);
    assertThat(post("/api/v1/proposals/" + other + "/withdraw", null, "t.nakamura", "\"1\"").statusCode())
        .isEqualTo(409);
  }

  // ---------------------------------------------------------------------------------------------
  // Expiry
  // ---------------------------------------------------------------------------------------------

  @Test
  void aWaitingItemExpiresAtItsStartWhenSomeoneReadsAndIsAuditedOnce() throws Exception {
    // 07:00 on the demo day has passed (the clock reads noon); 15:00 has not.
    UUID proposal = insertProposal(TARA);
    UUID past = insertItem(proposal, TARA, "2026-11-19T07:00:00-06:00", "D8", UNIT_A, "PENDING");
    insertItem(proposal, TARA, "2026-11-19T15:00:00-06:00", "E8", UNIT_A, "PENDING");

    List<Map<String, Object>> mine = listOf(get("/api/v1/me/proposals", "t.nakamura"));
    assertThat(mine).hasSize(1);
    Map<String, Object> view = mine.get(0);
    assertThat(view.get("displayState")).isEqualTo("WAITING");
    assertThat(list(view, "items")).extracting(i -> i.get("decision")).containsExactly("EXPIRED", "PENDING");
    // One item is no longer waiting, so the whole proposal can't be withdrawn any more.
    assertThat(view.get("canWithdraw")).isEqualTo(false);

    // Reading again changes and audits nothing more.
    get("/api/v1/me/proposals", "t.nakamura");
    Map<String, Object> audit =
        jdbc.queryForMap(
            "SELECT actor_user_id, after::text AS after FROM audit_event"
                + " WHERE entity_id = ? AND action = 'expire_proposal_item'",
            proposal);
    assertThat(audit.get("actor_user_id")).isNull();
    assertThat((String) audit.get("after")).contains(past.toString());
  }

  @Test
  void aProposalWhoseOnlyItemExpiredReadsExpiredAndTheSweepDoesTheSame() throws Exception {
    UUID proposal = insertProposal(TARA);
    insertItem(proposal, TARA, "2026-11-19T07:00:00-06:00", "D8", UNIT_A, "PENDING");

    // The hourly sweep calls this; no read has happened yet.
    assertThat(expiry.apply()).isEqualTo(1);
    assertThat(expiry.apply()).isZero();
    assertThat(jdbc.queryForObject("SELECT status FROM proposal WHERE id = ?", String.class, proposal))
        .isEqualTo("EXPIRED");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM audit_event WHERE entity_id = ? AND action = 'expire_proposal_item'",
                Integer.class,
                proposal))
        .isEqualTo(1);

    Map<String, Object> view = listOf(get("/api/v1/me/proposals", "t.nakamura")).get(0);
    assertThat(view.get("displayState")).isEqualTo("EXPIRED");
    assertThat(listOf(get("/api/v1/me/proposals?status=EXPIRED", "t.nakamura"))).hasSize(1);
    // An expired proposal can't be withdrawn.
    assertThat(
            post("/api/v1/proposals/" + proposal + "/withdraw", null, "t.nakamura", "\"1\"")
                .statusCode())
        .isEqualTo(409);
  }

  // ---------------------------------------------------------------------------------------------
  // Scope
  // ---------------------------------------------------------------------------------------------

  @Test
  void anEmployeeIdInTheBodyIsRejectedSoNobodyProposesForSomeoneElse() throws Exception {
    Map<String, Object> request = items(item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"));
    request.put("employeeId", ELLIS.toString());
    assertThat(post("/api/v1/proposals", request, "t.nakamura").statusCode()).isEqualTo(400);
    Map<String, Object> inItem = item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00");
    inItem.put("employeeId", ELLIS.toString());
    assertThat(post("/api/v1/proposals", items(inItem), "t.nakamura").statusCode()).isEqualTo(400);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM proposal", Integer.class)).isZero();
  }

  @Test
  void aProposalIsVisibleAndWithdrawableOnlyByItsOwner() throws Exception {
    UUID id = send("t.nakamura", item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"));

    assertThat(listOf(get("/api/v1/me/proposals", "m.ellis"))).isEmpty();
    assertThat(post("/api/v1/proposals/" + id + "/withdraw", null, "m.ellis", "\"0\"").statusCode())
        .isEqualTo(404);
    assertThat(jdbc.queryForObject("SELECT status FROM proposal WHERE id = ?", String.class, id))
        .isEqualTo("WAITING");
  }

  @Test
  void onlyALinkedOfficerCanUseIt() throws Exception {
    Map<String, Object> request = items(item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"));
    // J. Chen is a supervisor and an employee role, but has no linked officer record here.
    assertThat(post("/api/v1/proposals", request, "j.chen").statusCode()).isEqualTo(404);
    assertThat(get("/api/v1/me/proposals", "j.chen").statusCode()).isEqualTo(404);
    // The auditor reads the audit log only.
    assertThat(post("/api/v1/proposals/preview", request, "a.reviewer").statusCode()).isEqualTo(403);
    assertThat(get("/api/v1/me/proposals", "a.reviewer").statusCode()).isEqualTo(403);
    // Signed out.
    assertThat(post("/api/v1/proposals", request, null).statusCode()).isEqualTo(401);
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  @SafeVarargs
  private UUID send(String user, Map<String, Object>... shifts) throws Exception {
    HttpResponse<String> response = post("/api/v1/proposals", items(shifts), user);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(201);
    return UUID.fromString((String) json(response).get("id"));
  }

  private static Map<String, Object> item(UUID unit, String template, String startAt) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("unitId", unit.toString());
    item.put("shiftTemplate", template);
    item.put("startAt", OffsetDateTime.parse(startAt).toInstant().toString());
    return item;
  }

  @SafeVarargs
  private static Map<String, Object> items(Map<String, Object>... shifts) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("items", List.of(shifts));
    return body;
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> list(Map<String, Object> body, String key) {
    return (List<Map<String, Object>>) body.get(key);
  }

  @SuppressWarnings("unchecked")
  private static List<String> ruleCodes(Map<String, Object> item) {
    return ((List<Map<String, Object>>) item.get("ruleResults"))
        .stream().map(r -> (String) r.get("ruleCode")).toList();
  }

  private void insertEmployee(UUID id, String number, String first, String last) {
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, ?, ?, ?, ?, DATE '2015-01-01')"
            + " ON CONFLICT (id) DO UPDATE SET home_unit_id = excluded.home_unit_id",
        id,
        number,
        first,
        last,
        UNIT_B);
  }

  private UUID insertProposal(UUID employeeId) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO proposal (id, employee_id, status, submitted_at)"
            + " VALUES (?, ?, 'WAITING', TIMESTAMPTZ '2026-11-19 09:00:00-06')",
        id,
        employeeId);
    return id;
  }

  private UUID insertItem(
      UUID proposal, UUID employeeId, String startAt, String template, UUID unit, String decision) {
    java.time.Instant start = OffsetDateTime.parse(startAt).toInstant();
    int minutes = template.endsWith("12") ? 720 : 480;
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO proposal_item (id, proposal_id, employee_id, action, shift_template_id,"
            + " unit_id, start_at, end_at, work_date, decision)"
            + " SELECT ?, ?, ?, 'ADD', t.id, ?, ?, ?, ?, ? FROM shift_template t WHERE t.code = ?",
        id,
        proposal,
        employeeId,
        unit,
        Timestamp.from(start),
        Timestamp.from(start.plusSeconds(minutes * 60L)),
        java.sql.Date.valueOf(start.atZone(java.time.ZoneId.of("America/Regina")).toLocalDate()),
        decision,
        template);
    return id;
  }

  private void insertAssignment(UUID employeeId, UUID unit, String template, String startAt) {
    java.time.Instant start = OffsetDateTime.parse(startAt).toInstant();
    int minutes = template.endsWith("12") ? 720 : 480;
    jdbc.update(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) SELECT ?, ?, ?, t.id, ?, ?, ?, 'ROSTERED',"
            + " 'ROTATION' FROM shift_template t WHERE t.code = ?",
        UUID.randomUUID(),
        employeeId,
        unit,
        Timestamp.from(start),
        Timestamp.from(start.plusSeconds(minutes * 60L)),
        java.sql.Date.valueOf(start.atZone(java.time.ZoneId.of("America/Regina")).toLocalDate()),
        template);
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

  private HttpResponse<String> get(String path, String user) throws Exception {
    return send("GET", path, null, user, null);
  }

  private HttpResponse<String> post(String path, Object body, String user) throws Exception {
    return send("POST", path, body, user, null);
  }

  private HttpResponse<String> post(String path, Object body, String user, String ifMatch)
      throws Exception {
    return send("POST", path, body, user, ifMatch);
  }

  private HttpResponse<String> send(String method, String path, Object body, String user, String ifMatch)
      throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body != null) {
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    if (user != null) {
      builder.header("Authorization", "Bearer " + tokens.get(user));
    }
    if (ifMatch != null) {
      builder.header("If-Match", ifMatch);
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> listOf(HttpResponse<String> response) throws Exception {
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return mapper.readValue(response.body(), List.class);
  }
}
