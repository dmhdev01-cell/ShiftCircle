package ca.shiftcircle.api.proposals;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
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
 * Shift proposals, the decider's side (v1.3 P2): the inbox and its scope, the count, the detail
 * (rules then and now, pay-period overtime, the open-shift match), and the decision (the fresh
 * rule check, acknowledgements, the overtime order, self-approval, scope, expiry, locked periods).
 *
 * <p>The business clock is the demo day, 19 Nov 2026 at noon. Shifts are proposed on 24 to 28 Nov,
 * after the demo day. Tara (t.nakamura) and the officer behind M. Ellis's account are both on
 * Unit B; Ellis supervises Units A and B, Chen supervises ADM, CTL and ESC, and P. Planner sees
 * every unit.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class ProposalDecisionApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;
  @Autowired private ProposalRateLimiter limiter;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");
  private static final UUID UNIT_B = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final UUID UNIT_C = UUID.fromString("11111111-1111-1111-1111-000000000003");
  private static final UUID UNIT_ADM = UUID.fromString("11111111-1111-1111-1111-000000000004");

  private static final UUID TARA = UUID.fromString("44444444-4444-4444-4444-0000000000b1");
  private static final UUID ELLIS = UUID.fromString("44444444-4444-4444-4444-0000000000b2");
  private static final UUID OTHER = UUID.fromString("44444444-4444-4444-4444-0000000000b3");

  @BeforeEach
  void fixture() throws Exception {
    limiter.reset();
    jdbc.update("DELETE FROM proposal_item");
    jdbc.update("DELETE FROM proposal");
    jdbc.update("DELETE FROM overtime_offer");
    jdbc.update("DELETE FROM open_shift");
    jdbc.update("DELETE FROM shift_assignment WHERE employee_id IN (?, ?, ?)", TARA, ELLIS, OTHER);
    jdbc.update("DELETE FROM pay_period");
    jdbc.update("UPDATE app_user SET employee_id = NULL WHERE username IN ('t.nakamura', 'm.ellis')");
    insertEmployee(TARA, "E-PD1", "Tara", "Proposer", "2015-01-01");
    insertEmployee(ELLIS, "E-PD2", "Mel", "Ellis", "2015-01-01");
    insertEmployee(OTHER, "E-PD3", "Omar", "Other", "2015-01-01");
    jdbc.update("UPDATE app_user SET employee_id = ? WHERE username = 't.nakamura'", TARA);
    jdbc.update("UPDATE app_user SET employee_id = ? WHERE username = 'm.ellis'", ELLIS);
    for (String user : new String[] {"t.nakamura", "m.ellis", "j.chen", "p.planner", "a.reviewer"}) {
      tokens.put(user, login(user));
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Inbox and count
  // ---------------------------------------------------------------------------------------------

  @Test
  void theInboxShowsAProposalToTheSupervisorInScopeAndToThePlannerOnly() throws Exception {
    UUID onB = id(send("t.nakamura", item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00")));
    UUID onC = id(send("t.nakamura", item(UNIT_C, "D8", "2026-11-26T07:00:00-06:00")));

    List<Map<String, Object>> ellis = listOf(get("/api/v1/proposals", "m.ellis"));
    assertThat(ellis).extracting(c -> c.get("id")).containsExactly(onB.toString());
    Map<String, Object> card = ellis.get(0);
    assertThat(card.get("officerName")).isEqualTo("Tara Proposer");
    assertThat(card.get("homeUnit")).isEqualTo("B");
    assertThat(card.get("units")).isEqualTo(List.of("B"));
    assertThat(card.get("waitingInScope")).isEqualTo(1);
    assertThat(card.get("displayState")).isEqualTo("WAITING");
    assertThat(card.get("own")).isEqualTo(false);

    // Unit C has no supervisor in the demo: only the planner sees it (owner Q4).
    assertThat(listOf(get("/api/v1/proposals", "j.chen"))).isEmpty();
    assertThat(listOf(get("/api/v1/proposals", "p.planner")))
        .extracting(c -> c.get("id"))
        .containsExactlyInAnyOrder(onB.toString(), onC.toString());

    // Out of scope is "not found", never "forbidden".
    assertThat(get("/api/v1/proposals/" + onB, "j.chen").statusCode()).isEqualTo(404);
    assertThat(get("/api/v1/proposals/" + onC, "m.ellis").statusCode()).isEqualTo(404);
    assertThat(get("/api/v1/proposals/" + UUID.randomUUID(), "p.planner").statusCode())
        .isEqualTo(404);
    assertThat(get("/api/v1/proposals/" + onC, "p.planner").statusCode()).isEqualTo(200);

    // Officers and the auditor have no inbox.
    assertThat(get("/api/v1/proposals", "t.nakamura").statusCode()).isEqualTo(403);
    assertThat(get("/api/v1/proposals", "a.reviewer").statusCode()).isEqualTo(403);
    assertThat(get("/api/v1/proposals/" + onB, "a.reviewer").statusCode()).isEqualTo(403);
  }

  @Test
  void theCountIsTheWaitingProposalsTheCallerMayDecide() throws Exception {
    Map<String, Object> tara = send("t.nakamura", item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00"));
    send("m.ellis", item(UNIT_A, "D8", "2026-11-26T07:00:00-06:00"));

    // Ellis's own proposal waits for someone else, so his count leaves it out.
    assertThat(json(get("/api/v1/proposals/count?status=WAITING", "m.ellis")).get("count"))
        .isEqualTo(1);
    assertThat(json(get("/api/v1/proposals/count", "p.planner")).get("count")).isEqualTo(2);
    assertThat(json(get("/api/v1/proposals/count", "j.chen")).get("count")).isEqualTo(0);
    assertThat(get("/api/v1/proposals/count?status=ALL", "m.ellis").statusCode()).isEqualTo(400);

    decide("m.ellis", tara, decline(itemId(tara, 0), "Unit is fully staffed that night"));
    assertThat(json(get("/api/v1/proposals/count", "m.ellis")).get("count")).isEqualTo(0);
  }

  @Test
  void theInboxFiltersByStateUnitAndDate() throws Exception {
    Map<String, Object> decided =
        send("t.nakamura", item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00"));
    UUID waiting = id(send("t.nakamura", item(UNIT_A, "D8", "2026-11-27T07:00:00-06:00")));
    decide("m.ellis", decided, decline(itemId(decided, 0), "Fully staffed"));

    assertThat(listOf(get("/api/v1/proposals?status=WAITING", "m.ellis")))
        .extracting(c -> c.get("id"))
        .containsExactly(waiting.toString());
    List<Map<String, Object>> all = listOf(get("/api/v1/proposals?status=ALL", "m.ellis"));
    assertThat(all).hasSize(2);
    assertThat(all)
        .filteredOn(c -> c.get("id").equals(id(decided).toString()))
        .extracting(c -> c.get("displayState"))
        .containsExactly("DECLINED");
    assertThat(listOf(get("/api/v1/proposals?status=ALL&unitId=" + UNIT_B, "m.ellis")))
        .extracting(c -> c.get("id"))
        .containsExactly(id(decided).toString());
    assertThat(listOf(get("/api/v1/proposals?status=ALL&from=2026-11-26&to=2026-11-30", "m.ellis")))
        .extracting(c -> c.get("id"))
        .containsExactly(waiting.toString());
    // A unit outside the caller's scope is "not found"; a bad state word is a 400.
    assertThat(get("/api/v1/proposals?unitId=" + UNIT_C, "m.ellis").statusCode()).isEqualTo(404);
    assertThat(get("/api/v1/proposals?status=MAYBE", "m.ellis").statusCode()).isEqualTo(400);
  }

  // ---------------------------------------------------------------------------------------------
  // Approve and decline
  // ---------------------------------------------------------------------------------------------

  @Test
  void approvingCreatesAnExtraShiftFromTheProposalAndAuditsIt() throws Exception {
    Map<String, Object> request = items(item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00"));
    request.put("note", "Happy to help with the weekend");
    HttpResponse<String> sent = post("/api/v1/proposals", request, "t.nakamura", null);
    assertThat(sent.statusCode()).as(sent.body()).isEqualTo(201);
    Map<String, Object> proposal = json(sent);

    Map<String, Object> detail = json(get("/api/v1/proposals/" + id(proposal), "m.ellis"));
    assertThat(detail.get("note")).isEqualTo("Happy to help with the weekend");
    assertThat(detail.get("canDecide")).isEqualTo(true);
    Map<String, Object> before = list(detail, "items").get(0);
    assertThat(before.get("outcomeAtSubmit")).isEqualTo("PASS");
    assertThat(before.get("outcomeNow")).isEqualTo("PASS");
    assertThat(before.get("ruleChanged")).isEqualTo(false);
    assertThat(before.get("canDecide")).isEqualTo(true);

    HttpResponse<String> response =
        decideRaw("m.ellis", proposal, "\"0\"", accept(itemId(proposal, 0)));
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    Map<String, Object> view = json(response);
    assertThat(view.get("status")).isEqualTo("DECIDED");
    assertThat(view.get("displayState")).isEqualTo("APPROVED");
    assertThat(view.get("version")).isEqualTo(1);
    Map<String, Object> item = list(view, "items").get(0);
    assertThat(item.get("decision")).isEqualTo("ACCEPTED");
    assertThat(item.get("decidedBy")).isEqualTo("M. Ellis");
    UUID assignmentId = UUID.fromString((String) item.get("assignmentId"));

    Map<String, Object> shift =
        jdbc.queryForMap(
            "SELECT employee_id, kind, source, override_id, unit_id FROM shift_assignment"
                + " WHERE id = ?",
            assignmentId);
    assertThat(shift.get("employee_id")).isEqualTo(TARA);
    assertThat(shift.get("kind")).isEqualTo("EXTRA");
    assertThat(shift.get("source")).isEqualTo("PROPOSAL");
    assertThat(shift.get("override_id")).isNull();
    assertThat(shift.get("unit_id")).isEqualTo(UNIT_B);

    String decideAudit =
        jdbc.queryForObject(
            "SELECT after::text FROM audit_event WHERE action = 'decide_proposal_item'"
                + " AND entity_id = ? AND actor_user_id IS NOT NULL",
            String.class,
            id(proposal));
    assertThat(decideAudit)
        .contains("\"decision\": \"ACCEPTED\"")
        .contains(assignmentId.toString())
        .contains("\"outOfOvertimeOrder\": false");
    String assignAudit =
        jdbc.queryForObject(
            "SELECT after::text FROM audit_event WHERE action = 'assign_shift' AND entity_id = ?",
            String.class,
            assignmentId);
    assertThat(assignAudit)
        .contains("\"source\": \"PROPOSAL\"")
        .contains("\"proposalId\": \"" + id(proposal) + "\"");

    // The officer sees the outcome and who decided.
    Map<String, Object> mine = listOf(get("/api/v1/me/proposals", "t.nakamura")).get(0);
    assertThat(mine.get("displayState")).isEqualTo("APPROVED");
    assertThat(list(mine, "items").get(0).get("decidedBy")).isEqualTo("M. Ellis");
  }

  @Test
  void aBlockAtDecisionTimeIsRefusedAndNothingIsSaved() throws Exception {
    Map<String, Object> proposal =
        send("t.nakamura", item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00"));
    // After the send, the officer gets a P12 that ends at midnight: 7 h of rest, Block U-01.
    insertAssignment(TARA, UNIT_B, "P12", "2026-11-24T12:00:00-06:00");

    Map<String, Object> item =
        list(json(get("/api/v1/proposals/" + id(proposal), "m.ellis")), "items").get(0);
    assertThat(item.get("outcomeAtSubmit")).isEqualTo("PASS");
    assertThat(item.get("outcomeNow")).isEqualTo("BLOCK");
    assertThat(item.get("ruleChanged")).isEqualTo(true);

    HttpResponse<String> refused = decideRaw("m.ellis", proposal, "\"0\"", accept(itemId(proposal, 0)));
    assertThat(refused.statusCode()).isEqualTo(422);
    Map<String, Object> problem = json(refused);
    assertThat((String) problem.get("type")).endsWith("/blocked-by-rules");
    assertThat(list(problem, "items").get(0).get("outcome")).isEqualTo("BLOCK");
    assertThat(ruleCodes(list(problem, "items").get(0))).contains("U-01");

    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment WHERE source = 'PROPOSAL'", Integer.class))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT decision FROM proposal_item WHERE proposal_id = ?", String.class, id(proposal)))
        .isEqualTo("PENDING");
    assertThat(
            jdbc.queryForObject(
                "SELECT version FROM proposal WHERE id = ?", Integer.class, id(proposal)))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM audit_event WHERE action = 'decide_proposal_item'"
                    + " AND entity_id = ?",
                Integer.class,
                id(proposal)))
        .isZero();
  }

  @Test
  void aWarningThatAppearedAfterTheSendNeedsAcknowledgement() throws Exception {
    Map<String, Object> proposal =
        send("t.nakamura", item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"));
    // After the send, an E8 to 23:00 the evening before: exactly 8 h of rest is a Warn (U-02).
    insertAssignment(TARA, UNIT_A, "E8", "2026-11-24T15:00:00-06:00");

    HttpResponse<String> refused = decideRaw("m.ellis", proposal, "\"0\"", accept(itemId(proposal, 0)));
    assertThat(refused.statusCode()).isEqualTo(422);
    Map<String, Object> problem = json(refused);
    assertThat((String) problem.get("type")).endsWith("/warnings-need-acknowledgement");
    @SuppressWarnings("unchecked")
    List<String> warnCodes = (List<String>) list(problem, "items").get(0).get("warnCodes");
    assertThat(warnCodes).contains("U-02");

    HttpResponse<String> approved =
        decideRaw(
            "m.ellis",
            proposal,
            "\"0\"",
            accept(itemId(proposal, 0), warnCodes.toArray(new String[0])));
    assertThat(approved.statusCode()).as(approved.body()).isEqualTo(200);
    assertThat(
            jdbc.queryForObject(
                "SELECT array_to_string(acknowledged_codes, ',') FROM proposal_item"
                    + " WHERE proposal_id = ?",
                String.class,
                id(proposal)))
        .isEqualTo(String.join(",", warnCodes));
  }

  @Test
  void shiftsApprovedInTheSameSendAreCheckedTogetherAndNotCountedTwice() throws Exception {
    // E8 to 23:00, then a D8 at 07:00: together the D8 has 8 h of rest (U-02 Warn).
    Map<String, Object> proposal =
        send(
            "t.nakamura",
            item(UNIT_A, "E8", "2026-11-24T15:00:00-06:00"),
            item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"));
    UUID evening = itemId(proposal, 0);
    UUID day = itemId(proposal, 1);
    assertThat(warnNow(proposal, 1)).contains("U-02");

    // Both accepted: the D8 sees the E8 approved just before it, so its U-02 needs acknowledging.
    HttpResponse<String> refused =
        decideRaw("m.ellis", proposal, "\"0\"", accept(evening), accept(day));
    assertThat(refused.statusCode()).isEqualTo(422);
    assertThat((String) json(refused).get("type")).endsWith("/warnings-need-acknowledgement");

    // Declining the E8 takes the warning away: the D8 alone needs no acknowledgement.
    HttpResponse<String> partly =
        decideRaw(
            "m.ellis", proposal, "\"0\"", decline(evening, "Not that evening, sorry"), accept(day));
    assertThat(partly.statusCode()).as(partly.body()).isEqualTo(200);
    assertThat(json(partly).get("displayState")).isEqualTo("PARTLY_APPROVED");

    // Two shifts approved together with the warning acknowledged: both are saved, and the second
    // is not judged against the first twice (no false Block from double-counted hours).
    Map<String, Object> second =
        send(
            "t.nakamura",
            item(UNIT_A, "E8", "2026-11-26T15:00:00-06:00"),
            item(UNIT_A, "D8", "2026-11-27T07:00:00-06:00"));
    HttpResponse<String> both =
        decideRaw(
            "m.ellis",
            second,
            "\"0\"",
            accept(itemId(second, 0), warnNow(second, 0).toArray(new String[0])),
            accept(itemId(second, 1), warnNow(second, 1).toArray(new String[0])));
    assertThat(both.statusCode()).as(both.body()).isEqualTo(200);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment WHERE employee_id = ? AND source = 'PROPOSAL'",
                Integer.class,
                TARA))
        .isEqualTo(3);
  }

  @Test
  void aDeclineNeedsACommentAndTheOfficerSeesIt() throws Exception {
    Map<String, Object> proposal =
        send("t.nakamura", item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00"));
    UUID item = itemId(proposal, 0);

    assertThat(decideRaw("m.ellis", proposal, "\"0\"", decline(item, null)).statusCode())
        .isEqualTo(400);
    assertThat(decideRaw("m.ellis", proposal, "\"0\"", decline(item, " no ")).statusCode())
        .isEqualTo(400);
    HttpResponse<String> declined =
        decideRaw("m.ellis", proposal, "\"0\"", decline(item, "Unit is fully staffed that night"));
    assertThat(declined.statusCode()).as(declined.body()).isEqualTo(200);
    assertThat(json(declined).get("displayState")).isEqualTo("DECLINED");

    Map<String, Object> mine = listOf(get("/api/v1/me/proposals", "t.nakamura")).get(0);
    assertThat(mine.get("displayState")).isEqualTo("DECLINED");
    Map<String, Object> outcome = list(mine, "items").get(0);
    assertThat(outcome.get("decidedBy")).isEqualTo("M. Ellis");
    assertThat(outcome.get("comment")).isEqualTo("Unit is fully staffed that night");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment WHERE employee_id = ?", Integer.class, TARA))
        .isZero();
  }

  // ---------------------------------------------------------------------------------------------
  // Who may decide
  // ---------------------------------------------------------------------------------------------

  @Test
  void nobodyApprovesTheirOwnProposal() throws Exception {
    // M. Ellis is a supervisor of Unit A and also an officer (supervisors are employees).
    Map<String, Object> own = send("m.ellis", item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"));

    Map<String, Object> detail = json(get("/api/v1/proposals/" + id(own), "m.ellis"));
    assertThat(detail.get("own")).isEqualTo(true);
    assertThat(detail.get("canDecide")).isEqualTo(false);
    assertThat(list(detail, "items").get(0).get("canDecide")).isEqualTo(false);
    assertThat(listOf(get("/api/v1/proposals", "m.ellis")).get(0).get("own")).isEqualTo(true);

    HttpResponse<String> refused = decideRaw("m.ellis", own, "\"0\"", accept(itemId(own, 0)));
    assertThat(refused.statusCode()).isEqualTo(403);
    assertThat(refused.body()).contains("can't approve your own proposal");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment WHERE employee_id = ?", Integer.class, ELLIS))
        .isZero();
  }

  @Test
  void aSupervisorsOwnProposalIsDecidedByThePlanner() throws Exception {
    Map<String, Object> own = send("m.ellis", item(UNIT_A, "D8", "2026-11-25T07:00:00-06:00"));
    Map<String, Object> detail = json(get("/api/v1/proposals/" + id(own), "p.planner"));
    assertThat(detail.get("own")).isEqualTo(false);
    assertThat(detail.get("canDecide")).isEqualTo(true);

    HttpResponse<String> approved = decideRaw("p.planner", own, "\"0\"", accept(itemId(own, 0)));
    assertThat(approved.statusCode()).as(approved.body()).isEqualTo(200);
    assertThat(list(json(approved), "items").get(0).get("decidedBy")).isEqualTo("P. Planner");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment WHERE employee_id = ? AND source = 'PROPOSAL'",
                Integer.class,
                ELLIS))
        .isEqualTo(1);
  }

  @Test
  void aSupervisorDecidesOnlyTheShiftsOnTheirUnits() throws Exception {
    Map<String, Object> proposal =
        send(
            "t.nakamura",
            item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00"),
            item(UNIT_ADM, "D8", "2026-11-27T07:00:00-06:00"));
    UUID onB = itemId(proposal, 0);
    UUID onAdm = itemId(proposal, 1);

    // Ellis sees the ADM shift without its rule details and can't act on it.
    Map<String, Object> admForEllis =
        list(json(get("/api/v1/proposals/" + id(proposal), "m.ellis")), "items").get(1);
    assertThat(admForEllis.get("unit")).isEqualTo("ADM");
    assertThat(admForEllis.get("inScope")).isEqualTo(false);
    assertThat(admForEllis.get("canDecide")).isEqualTo(false);
    assertThat(admForEllis.get("ruleAtSubmit")).isNull();

    HttpResponse<String> refused = decideRaw("m.ellis", proposal, "\"0\"", accept(onAdm));
    assertThat(refused.statusCode()).isEqualTo(403);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM shift_assignment WHERE employee_id = ?",
        Integer.class, TARA)).isZero();

    // Each supervisor decides their own unit's shift; then the proposal is decided.
    HttpResponse<String> chen = decideRaw("j.chen", proposal, "\"0\"", accept(onAdm));
    assertThat(chen.statusCode()).as(chen.body()).isEqualTo(200);
    assertThat(json(chen).get("status")).isEqualTo("WAITING");
    HttpResponse<String> ellis =
        decideRaw("m.ellis", proposal, "\"1\"", decline(onB, "Unit B is covered"));
    assertThat(ellis.statusCode()).as(ellis.body()).isEqualTo(200);
    assertThat(json(ellis).get("status")).isEqualTo("DECIDED");
    assertThat(json(ellis).get("displayState")).isEqualTo("PARTLY_APPROVED");
  }

  // ---------------------------------------------------------------------------------------------
  // State and concurrency
  // ---------------------------------------------------------------------------------------------

  @Test
  void aShiftThatHasStartedCanNoLongerBeApproved() throws Exception {
    UUID proposal = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO proposal (id, employee_id, status, submitted_at)"
            + " VALUES (?, ?, 'WAITING', TIMESTAMPTZ '2026-11-18 09:00:00-06')",
        proposal,
        TARA);
    UUID item = UUID.randomUUID();
    java.time.Instant start = OffsetDateTime.parse("2026-11-19T07:00:00-06:00").toInstant();
    jdbc.update(
        "INSERT INTO proposal_item (id, proposal_id, employee_id, action, shift_template_id,"
            + " unit_id, start_at, end_at, work_date, decision)"
            + " SELECT ?, ?, ?, 'ADD', t.id, ?, ?, ?, DATE '2026-11-19', 'PENDING'"
            + " FROM shift_template t WHERE t.code = 'D8'",
        item,
        proposal,
        TARA,
        UNIT_B,
        Timestamp.from(start),
        Timestamp.from(start.plusSeconds(8 * 3600)));

    HttpResponse<String> refused =
        post("/api/v1/proposals/" + proposal + "/decision", body(accept(item)), "m.ellis", "\"0\"");
    assertThat(refused.statusCode()).isEqualTo(409);
    assertThat((String) json(refused).get("type")).endsWith("/shift-started");

    // Any read shows it expired.
    Map<String, Object> detail = json(get("/api/v1/proposals/" + proposal, "m.ellis"));
    assertThat(detail.get("displayState")).isEqualTo("EXPIRED");
    assertThat(list(detail, "items").get(0).get("canDecide")).isEqualTo(false);
  }

  @Test
  void aDecisionNeedsTheCurrentVersionAndAWaitingShift() throws Exception {
    Map<String, Object> proposal =
        send("t.nakamura", item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00"));
    UUID item = itemId(proposal, 0);

    assertThat(decideRaw("m.ellis", proposal, null, accept(item)).statusCode()).isEqualTo(428);
    assertThat(decideRaw("m.ellis", proposal, "\"7\"", accept(item)).statusCode()).isEqualTo(412);
    assertThat(decideRaw("m.ellis", proposal, "\"0\"", accept(UUID.randomUUID())).statusCode())
        .isEqualTo(400);
    assertThat(decideRaw("m.ellis", proposal, "\"0\"", accept(item)).statusCode()).isEqualTo(200);
    HttpResponse<String> again = decideRaw("m.ellis", proposal, "\"1\"", accept(item));
    assertThat(again.statusCode()).isEqualTo(409);
    assertThat((String) json(again).get("type")).endsWith("/already-decided");

    Map<String, Object> withdrawn =
        send("t.nakamura", item(UNIT_B, "D8", "2026-11-27T07:00:00-06:00"));
    assertThat(
            post("/api/v1/proposals/" + id(withdrawn) + "/withdraw", null, "t.nakamura", "\"0\"")
                .statusCode())
        .isEqualTo(200);
    HttpResponse<String> late = decideRaw("m.ellis", withdrawn, "\"1\"", accept(itemId(withdrawn, 0)));
    assertThat(late.statusCode()).isEqualTo(409);
    assertThat((String) json(late).get("type")).endsWith("/proposal-withdrawn");
  }

  @Test
  void aLockedPayPeriodRefusesTheApproval() throws Exception {
    jdbc.update(
        "INSERT INTO pay_period (start_date, end_date, status) VALUES (DATE '2026-11-16',"
            + " DATE '2026-11-29', 'OPEN')");
    Map<String, Object> proposal =
        send("t.nakamura", item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00"));
    jdbc.update("UPDATE pay_period SET status = 'LOCKED'");

    HttpResponse<String> refused = decideRaw("m.ellis", proposal, "\"0\"", accept(itemId(proposal, 0)));
    assertThat(refused.statusCode()).isEqualTo(409);
    assertThat((String) json(refused).get("type")).endsWith("/pay-period-locked");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment WHERE employee_id = ?", Integer.class, TARA))
        .isZero();
  }

  // ---------------------------------------------------------------------------------------------
  // Overtime: pay-period hours and the open-shift match (owner Q1, Q5)
  // ---------------------------------------------------------------------------------------------

  @Test
  void theDetailShowsTheOvertimeTheShiftWouldAdd() throws Exception {
    jdbc.update(
        "INSERT INTO pay_period (start_date, end_date, status) VALUES (DATE '2026-11-16',"
            + " DATE '2026-11-29', 'OPEN')");
    // 76 scheduled hours from the demo day on: five P12 and two D8.
    for (String day : new String[] {"19", "20", "21", "22", "23"}) {
      insertAssignment(TARA, UNIT_B, "P12", "2026-11-" + day + "T12:00:00-06:00");
    }
    insertAssignment(TARA, UNIT_B, "D8", "2026-11-27T07:00:00-06:00");
    insertAssignment(TARA, UNIT_B, "D8", "2026-11-28T07:00:00-06:00");
    UUID proposal = insertWaitingItem(TARA, UNIT_B, "D8", "2026-11-25T07:00:00-06:00");

    Map<String, Object> item =
        list(json(get("/api/v1/proposals/" + proposal, "m.ellis")), "items").get(0);
    assertThat(item.get("wouldBeOvertimeHours")).isEqualTo(4.0);
    @SuppressWarnings("unchecked")
    Map<String, Object> pay = (Map<String, Object>) item.get("payPeriod");
    assertThat(pay.get("hoursBefore")).isEqualTo(76.0);
    assertThat(pay.get("hoursAfter")).isEqualTo(84.0);
    assertThat(pay.get("thresholdHours")).isEqualTo(80.0);
    assertThat(pay.get("overtimeStatus")).isEqualTo("IN_OVERTIME");
  }

  @Test
  void approvingFillsTheMatchingOpenShiftAndWithdrawsItsOffers() throws Exception {
    // Tara is first in the overtime order (most senior, no overtime yet).
    jdbc.update("UPDATE employee SET seniority_date = DATE '2000-01-01' WHERE id = ?", TARA);
    UUID openShift = insertOpenShift(UNIT_B, "D8", "2026-11-25T07:00:00-06:00");
    UUID offer = insertOffer(openShift, OTHER);
    Map<String, Object> proposal =
        send("t.nakamura", item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00"));

    @SuppressWarnings("unchecked")
    Map<String, Object> match =
        (Map<String, Object>)
            list(json(get("/api/v1/proposals/" + id(proposal), "m.ellis")), "items")
                .get(0)
                .get("openShift");
    assertThat(match.get("id")).isEqualTo(openShift.toString());
    assertThat(match.get("otOrderPosition")).isEqualTo(1);
    assertThat(match.get("otOrderSize")).isEqualTo(3);
    assertThat(match.get("outOfOrder")).isEqualTo(false);
    assertThat(match.get("liveOffers")).isEqualTo(1);

    HttpResponse<String> approved = decideRaw("m.ellis", proposal, "\"0\"", accept(itemId(proposal, 0)));
    assertThat(approved.statusCode()).as(approved.body()).isEqualTo(200);
    String assignmentId = (String) list(json(approved), "items").get(0).get("assignmentId");

    Map<String, Object> filled =
        jdbc.queryForMap("SELECT status, filled_assignment_id FROM open_shift WHERE id = ?", openShift);
    assertThat(filled.get("status")).isEqualTo("FILLED");
    assertThat(filled.get("filled_assignment_id").toString()).isEqualTo(assignmentId);
    assertThat(
            jdbc.queryForObject("SELECT status FROM overtime_offer WHERE id = ?", String.class, offer))
        .isEqualTo("WITHDRAWN");
    Map<String, Object> stored =
        jdbc.queryForMap(
            "SELECT open_shift_id, out_of_ot_order FROM proposal_item WHERE proposal_id = ?",
            id(proposal));
    assertThat(stored.get("open_shift_id")).isEqualTo(openShift);
    assertThat(stored.get("out_of_ot_order")).isEqualTo(false);
  }

  @Test
  void approvingOutsideTheOvertimeOrderNeedsItsOwnAcknowledgementAndIsAudited() throws Exception {
    // Omar ranks first (most senior); Tara is second, Ellis's officer third.
    jdbc.update("UPDATE employee SET seniority_date = DATE '2005-01-01' WHERE id = ?", OTHER);
    jdbc.update("UPDATE employee SET seniority_date = DATE '2020-01-01' WHERE id = ?", ELLIS);
    UUID openShift = insertOpenShift(UNIT_B, "D8", "2026-11-25T07:00:00-06:00");
    Map<String, Object> proposal =
        send("t.nakamura", item(UNIT_B, "D8", "2026-11-25T07:00:00-06:00"));
    UUID item = itemId(proposal, 0);

    HttpResponse<String> refused = decideRaw("m.ellis", proposal, "\"0\"", accept(item));
    assertThat(refused.statusCode()).isEqualTo(422);
    Map<String, Object> problem = json(refused);
    assertThat((String) problem.get("type")).endsWith("/out-of-overtime-order");
    assertThat(list(problem, "items").get(0).get("otOrderPosition")).isEqualTo(2);
    assertThat(jdbc.queryForObject("SELECT status FROM open_shift WHERE id = ?", String.class, openShift))
        .isEqualTo("OPEN");

    Map<String, Object> acknowledged = accept(item);
    acknowledged.put("acknowledgeOutOfOrder", true);
    HttpResponse<String> approved = decideRaw("m.ellis", proposal, "\"0\"", acknowledged);
    assertThat(approved.statusCode()).as(approved.body()).isEqualTo(200);
    assertThat(list(json(approved), "items").get(0).get("outOfOvertimeOrder")).isEqualTo(true);
    assertThat(jdbc.queryForObject("SELECT status FROM open_shift WHERE id = ?", String.class, openShift))
        .isEqualTo("FILLED");
    assertThat(
            jdbc.queryForObject(
                "SELECT after::text FROM audit_event WHERE action = 'decide_proposal_item'"
                    + " AND entity_id = ?",
                String.class,
                id(proposal)))
        .contains("\"outOfOvertimeOrder\": true")
        .contains("\"otOrderPosition\": 2");
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  /** The current Warn codes of an item, as the detail's "rules now" shows them to Ellis. */
  @SuppressWarnings("unchecked")
  private List<String> warnNow(Map<String, Object> proposal, int index) throws Exception {
    Map<String, Object> item =
        list(json(get("/api/v1/proposals/" + id(proposal), "m.ellis")), "items").get(index);
    return ((List<Map<String, Object>>) ((Map<String, Object>) item.get("ruleNow")).get("ruleResults"))
        .stream()
            .filter(r -> "WARN".equals(r.get("outcome")))
            .map(r -> (String) r.get("ruleCode"))
            .toList();
  }

  @SafeVarargs
  private Map<String, Object> send(String user, Map<String, Object>... shifts) throws Exception {
    HttpResponse<String> response = post("/api/v1/proposals", items(shifts), user, null);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(201);
    return json(response);
  }

  private void decide(String user, Map<String, Object> proposal, Map<String, Object> item)
      throws Exception {
    HttpResponse<String> response =
        decideRaw(user, proposal, "\"" + proposal.get("version") + "\"", item);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
  }

  @SafeVarargs
  private HttpResponse<String> decideRaw(
      String user, Map<String, Object> proposal, String ifMatch, Map<String, Object>... decisions)
      throws Exception {
    return post("/api/v1/proposals/" + id(proposal) + "/decision", body(decisions), user, ifMatch);
  }

  @SafeVarargs
  private static Map<String, Object> body(Map<String, Object>... decisions) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("items", List.of(decisions));
    return body;
  }

  private static Map<String, Object> accept(UUID itemId, String... acknowledge) {
    Map<String, Object> decision = new LinkedHashMap<>();
    decision.put("id", itemId.toString());
    decision.put("accept", true);
    if (acknowledge.length > 0) {
      decision.put("acknowledgeWarnings", List.of(acknowledge));
    }
    return decision;
  }

  private static Map<String, Object> decline(UUID itemId, String comment) {
    Map<String, Object> decision = new LinkedHashMap<>();
    decision.put("id", itemId.toString());
    decision.put("accept", false);
    if (comment != null) {
      decision.put("comment", comment);
    }
    return decision;
  }

  private static UUID id(Map<String, Object> proposal) {
    return UUID.fromString((String) proposal.get("id"));
  }

  private static UUID itemId(Map<String, Object> proposal, int index) {
    return UUID.fromString((String) list(proposal, "items").get(index).get("id"));
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

  private void insertEmployee(UUID id, String number, String first, String last, String seniority) {
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id, seniority_date)"
            + " VALUES (?, ?, ?, ?, ?, ?::date)"
            + " ON CONFLICT (id) DO UPDATE SET home_unit_id = excluded.home_unit_id,"
            + " seniority_date = excluded.seniority_date",
        id,
        number,
        first,
        last,
        UNIT_B,
        seniority);
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

  /** A waiting one-shift proposal stored directly (the send would refuse a Blocked shift). */
  private UUID insertWaitingItem(UUID employeeId, UUID unit, String template, String startAt) {
    UUID proposal = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO proposal (id, employee_id, status, submitted_at)"
            + " VALUES (?, ?, 'WAITING', TIMESTAMPTZ '2026-11-19 09:00:00-06')",
        proposal,
        employeeId);
    java.time.Instant start = OffsetDateTime.parse(startAt).toInstant();
    jdbc.update(
        "INSERT INTO proposal_item (proposal_id, employee_id, action, shift_template_id, unit_id,"
            + " start_at, end_at, work_date, decision)"
            + " SELECT ?, ?, 'ADD', t.id, ?, ?, ?, ?, 'PENDING' FROM shift_template t"
            + " WHERE t.code = ?",
        proposal,
        employeeId,
        unit,
        Timestamp.from(start),
        Timestamp.from(start.plusSeconds((template.endsWith("12") ? 720 : 480) * 60L)),
        java.sql.Date.valueOf(start.atZone(java.time.ZoneId.of("America/Regina")).toLocalDate()),
        template);
    return proposal;
  }

  private UUID insertOpenShift(UUID unit, String template, String startAt) {
    java.time.Instant start = OffsetDateTime.parse(startAt).toInstant();
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO open_shift (id, unit_id, shift_template_id, start_at, end_at, reason, status)"
            + " SELECT ?, ?, t.id, ?, ?, 'SICK_CALL', 'OPEN' FROM shift_template t WHERE t.code = ?",
        id,
        unit,
        Timestamp.from(start),
        Timestamp.from(start.plusSeconds(480 * 60L)),
        template);
    return id;
  }

  private UUID insertOffer(UUID openShift, UUID employeeId) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO overtime_offer (id, open_shift_id, employee_id, rank, ordered, status)"
            + " VALUES (?, ?, ?, 1, false, 'OFFERED')",
        id,
        openShift,
        employeeId);
    jdbc.update("UPDATE open_shift SET status = 'OFFERED' WHERE id = ?", openShift);
    return id;
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

  private HttpResponse<String> post(String path, Object body, String user, String ifMatch)
      throws Exception {
    return send("POST", path, body, user, ifMatch);
  }

  private HttpResponse<String> send(
      String method, String path, Object body, String user, String ifMatch) throws Exception {
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
