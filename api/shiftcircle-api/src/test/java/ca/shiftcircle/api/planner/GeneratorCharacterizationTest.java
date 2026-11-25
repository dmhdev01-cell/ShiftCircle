package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import ca.shiftcircle.infrastructure.demo.DemoChecksum;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
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

/**
 * Release 7 characterization before the scorecard assessor is extracted from PlanGenerator. Pins
 * the generator output that no release-7 change may move: dataset checksums, the payroll golden,
 * plan fingerprints, row counts and warning totals.
 *
 * <p>Release v1.3 (S4) re-pinned every value once, when the datasets gained their supervisors. The
 * pre-S4 values are kept as the <b>officer-only</b> pins: the checksum over the officers' roster
 * and periods, the plan fingerprint and rows over the officers, the officer scorecard's warnings
 * and the payroll export without the supervisor rows still equal them, which proves that adding
 * the supervisors left every officer row unchanged.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"sc.demo.generate=true", "sc.demo.today=2026-11-19"})
@ActiveProfiles("demo")
class GeneratorCharacterizationTest {

  private static final Map<String, String> CHECKSUMS =
      Map.of(
          "100", "beb2e222b8c9100c98d329e37f5ffcf670f81d0083045d84f179f7f0681ab7d1",
          "120", "ca73467d7c8436f8be28d5e5488b63b80b2dc162a8c815527dd674fe6dcfa64a",
          "150", "353e2e62a1627a9ba31b7e411064065e2d0c36510a3e145f010251c4713991a5");

  private static final Map<String, String> PLAN_FINGERPRINTS =
      Map.of(
          "100", "94aeae1f27463fdf2b588a65c2ca8f87b12bc3bfe80cc56cb60969d3ce1e7c11",
          "120", "5a3763c73ae896645fec328dac7e2cb9e95434d18a0a94b45038b5cd0d33983f",
          "150", "7368ef1377e3e38b3b507d49e9dc29f481ba706778506a6e3140eb34ec450587");

  private static final Map<String, Integer> ROWS = Map.of("100", 7266, "120", 5595, "150", 5877);
  /** The scorecard's warnings card is the officers' (S3), so it keeps its pre-S4 value. */
  private static final Map<String, Integer> WARNINGS = Map.of("100", 135, "120", 7, "150", 39);
  /** Everyone's warnings: the officers' plus those raised on the supervisor posts. */
  private static final Map<String, Integer> TOTAL_WARNINGS =
      Map.of("100", 155, "120", 7, "150", 41);
  /** Supervisor-post block-days short: 120's crews cover every block, 150's leave leaves gaps. */
  private static final Map<String, Integer> SUPERVISOR_GAPS =
      Map.of("100", 230, "120", 0, "150", 93);
  private static final String PAYROLL_GOLDEN =
      "b946ef1f9f3d3529bd826e41a9452fe35633d9e1ee38e7d79d7a70732bc200e6";

  // The pre-S4 pins, which the officers alone must still produce.
  private static final Map<String, String> OFFICER_CHECKSUMS =
      Map.of(
          "100", "4156077d76d41bd5fcf6d6a9a0f51111e9007d16c8a0c6b311e09c6fe801da6b",
          "120", "82b19cf814acde5c5740f9a9aa1162e61d4b7f5598848f99861d2f4ea66732ca",
          "150", "2e6cd938254002892c06d9800652666e5a9e786f78f5ca2ed11c7005a987d7f8");
  private static final Map<String, String> OFFICER_PLAN_FINGERPRINTS =
      Map.of(
          "100", "ec33701459f92998c1ea84ee5fae17fbadc3e8894c9d52df344ae24cf1409e1b",
          "120", "e8b29ce687767e5ce4fefd5347333447ca9cc5b55f82c08195f36f8f4cfe9d31",
          "150", "a1e093f7c3630371a0762067a8aed55d6ccb1b6f7a30372257e326d892ceb381");
  private static final Map<String, Integer> OFFICER_ROWS =
      Map.of("100", 6586, "120", 5103, "150", 5414);
  private static final String OFFICER_PAYROLL_GOLDEN =
      "9f2d51b38581abea673fe5c85aead3670ca45b36db390fee1d2033d1faa004ff";
  private static final int OFFICER_PAYROLL_LINES = 1038;

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @LocalServerPort private int port;
  @Autowired private JdbcTemplate jdbc;

  private final HttpClient client = HttpClient.newHttpClient();
  private final ObjectMapper mapper = new ObjectMapper();

  @BeforeAll
  void login() throws Exception {
    loginToken("p.planner");
  }

  @Test
  @SuppressWarnings("unchecked")
  void theGeneratorOutputAndPinnedDataAreUnchanged() throws Exception {
    String planner = loginToken("p.planner");
    String supervisor = loginToken("m.ellis");
    for (String dataset : List.of("100", "120", "150")) {
      Map<String, Object> done = reset(planner, dataset);
      assertThat(done.get("checksum")).as(dataset + " checksum").isEqualTo(CHECKSUMS.get(dataset));
      // Officer-only invariance (S4): 100's checksum is names-blind, 120/150 add the names.
      assertThat(
              "100".equals(dataset)
                  ? DemoChecksum.officersOnly(jdbc)
                  : DemoChecksum.officersOnlyWithNames(jdbc))
          .as(dataset + " officer-only checksum equals the pre-supervisor checksum")
          .isEqualTo(OFFICER_CHECKSUMS.get(dataset));

      UUID draft = generate(planner);
      Map<String, Object> body =
          mapper.readValue(send("GET", "/api/v1/planner/drafts/" + draft, null, planner).body(), Map.class);
      @SuppressWarnings("unchecked")
      Map<String, Object> scorecard = (Map<String, Object>) body.get("scorecard");
      @SuppressWarnings("unchecked")
      Map<String, Object> warnings = (Map<String, Object>) scorecard.get("warnings");
      assertThat(((Number) warnings.get("total")).intValue())
          .as(dataset + " warning total")
          .isEqualTo(WARNINGS.get(dataset));
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM plan_draft_assignment WHERE draft_id = ?", Integer.class, draft))
          .as(dataset + " draft rows")
          .isEqualTo(ROWS.get(dataset));
      assertThat(fingerprint(draft))
          .as(dataset + " plan fingerprint")
          .isEqualTo(PLAN_FINGERPRINTS.get(dataset));
      assertThat(((Number) ((Map<String, Object>) scorecard.get("totals")).get("warnings")).intValue())
          .as(dataset + " warnings, officers and supervisors")
          .isEqualTo(TOTAL_WARNINGS.get(dataset));
      assertThat(
              ((Number)
                      ((Map<String, Object>)
                              ((Map<String, Object>) scorecard.get("supervisors")).get("coverage"))
                          .get("shortBlockDays"))
                  .intValue())
          .as(dataset + " supervisor-post block-days short")
          .isEqualTo(SUPERVISOR_GAPS.get(dataset));
      // Officer-only invariance (S4): the officers' plan is shift for shift the pre-S4 plan.
      assertThat(officerFingerprint(draft))
          .as(dataset + " officer-only plan fingerprint equals the pre-supervisor fingerprint")
          .isEqualTo(OFFICER_PLAN_FINGERPRINTS.get(dataset));
      assertThat(jdbc.queryForObject(
              "SELECT count(*) FROM plan_draft_assignment a JOIN employee e ON e.id = a.employee_id"
                  + " WHERE a.draft_id = ? AND e.classification = 'CO'",
              Integer.class,
              draft))
          .as(dataset + " officer draft rows")
          .isEqualTo(OFFICER_ROWS.get(dataset));

      // PR-N: the tailoring options sent explicitly at their defaults are the same plan.
      UUID withDefaults =
          generate(
              planner,
              "{\"seed\":20261001,\"staffTypes\":[\"FULL_TIME\",\"PART_TIME\"],"
                  + "\"partTimeFill\":\"AFTER_FULL_TIME\"}");
      assertThat(fingerprint(withDefaults))
          .as(dataset + " plan fingerprint with the default options sent")
          .isEqualTo(PLAN_FINGERPRINTS.get(dataset));
      Map<String, Object> defaultsBody =
          mapper.readValue(
              send("GET", "/api/v1/planner/drafts/" + withDefaults, null, planner).body(),
              Map.class);
      assertThat(((Map<String, Object>) defaultsBody.get("scorecard")).get("warnings"))
          .as(dataset + " warnings with the default options sent")
          .isEqualTo(warnings);

      if ("100".equals(dataset)) {
        List<Map<String, Object>> periods =
            mapper.readValue(send("GET", "/api/v1/pay-periods", null, supervisor).body(), List.class);
        Map<String, Object> period =
            periods.stream()
                .map(row -> (Map<String, Object>) row)
                .filter(row -> "2026-10-26".equals(row.get("from")))
                .findFirst()
                .orElseThrow();
        String csv =
            send(
                "GET",
                "/api/v1/pay-periods/" + period.get("id") + "/payroll-export",
                null,
                supervisor)
                .body();
        assertThat(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(csv.getBytes(StandardCharsets.UTF_8))))
            .as("payroll golden")
            .isEqualTo(PAYROLL_GOLDEN);
        // Officer-only invariance (S4): the supervisor rows (S-…) sort after every officer row,
        // so the file's first lines are the pre-S4 file byte for byte, and only S- rows follow.
        List<String> lines = csv.lines().toList();
        assertThat(lines.subList(OFFICER_PAYROLL_LINES, lines.size()))
            .as("only supervisor rows are appended")
            .isNotEmpty()
            .allMatch(line -> line.startsWith("S-"));
        String officerRows =
            String.join("\n", lines.subList(0, OFFICER_PAYROLL_LINES)) + "\n";
        assertThat(csv).startsWith(officerRows);
        assertThat(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(officerRows.getBytes(StandardCharsets.UTF_8))))
            .as("the officers' payroll rows equal the pre-supervisor golden")
            .isEqualTo(OFFICER_PAYROLL_GOLDEN);
      }
    }
  }

  private Map<String, Object> reset(String token, String dataset) throws Exception {
    HttpResponse<String> started =
        send("POST", "/api/v1/demo/reset", "{\"confirm\":\"RESET\",\"dataset\":\"" + dataset + "\"}", token);
    assertThat(started.statusCode()).as(started.body()).isEqualTo(200);
    long deadline = System.nanoTime() + 240_000_000_000L;
    while (System.nanoTime() < deadline) {
      Map<String, Object> status =
          mapper.readValue(send("GET", "/api/v1/demo/reset/status", null, token).body(), Map.class);
      if ("DONE".equals(status.get("state"))) return status;
      if ("FAILED".equals(status.get("state"))) {
        throw new AssertionError(status.toString());
      }
      Thread.sleep(250);
    }
    throw new AssertionError("reset " + dataset + " did not finish");
  }

  private UUID generate(String token) throws Exception {
    return generate(token, "{\"seed\":20261001}");
  }

  private UUID generate(String token, String body) throws Exception {
    HttpResponse<String> generated = send("POST", "/api/v1/planner/drafts", body, token);
    assertThat(generated.statusCode()).as(generated.body()).isEqualTo(201);
    return UUID.fromString((String) mapper.readValue(generated.body(), Map.class).get("id"));
  }

  private String fingerprint(UUID draftId) {
    return fingerprint(draftId, "");
  }

  private String officerFingerprint(UUID draftId) {
    return fingerprint(draftId, " AND e.classification = 'CO'");
  }

  private String fingerprint(UUID draftId, String filter) {
    List<String> rows =
        jdbc.queryForList(
            "SELECT e.employee_no || '|' || u.code || '|' || t.code || '|' || a.work_date"
                + " || '|' || to_char(a.start_at AT TIME ZONE 'America/Regina', 'YYYY-MM-DD\"T\"HH24:MI')"
                + " || '|' || to_char(a.end_at AT TIME ZONE 'America/Regina', 'YYYY-MM-DD\"T\"HH24:MI')"
                + " || '|' || a.kind FROM plan_draft_assignment a JOIN employee e ON e.id = a.employee_id"
                + " JOIN unit u ON u.id = a.unit_id JOIN shift_template t ON t.id = a.shift_template_id"
                + " WHERE a.draft_id = ?" + filter + " ORDER BY 1",
            String.class,
            draftId);
    MessageDigest digest;
    try {
      digest = MessageDigest.getInstance("SHA-256");
    } catch (Exception impossible) {
      throw new IllegalStateException(impossible);
    }
    for (String row : rows) {
      digest.update(row.getBytes(StandardCharsets.UTF_8));
      digest.update((byte) '\n');
    }
    return HexFormat.of().formatHex(digest.digest());
  }

  private String loginToken(String username) throws Exception {
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
      builder.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    if (token != null) builder.header("Authorization", "Bearer " + token);
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
