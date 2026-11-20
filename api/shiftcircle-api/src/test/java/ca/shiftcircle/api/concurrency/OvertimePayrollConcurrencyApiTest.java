package ca.shiftcircle.api.concurrency;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
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
 * Two supervisors racing the same open shift or the same pay period must not both win.
 *
 * <p>review-r3's scope 7: open-shift direct assign read the shift without a row lock and filled it
 * unconditionally, so three different officers could all be assigned to a needs=1 shift; confirm
 * read the shift without a lock too. Unlock audited unconditionally, so concurrent unlocks wrote
 * one audit row each for one real change.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class OvertimePayrollConcurrencyApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private String token;

  private static final UUID UNIT_B = UUID.fromString("11111111-1111-1111-1111-000000000002");
  private static final UUID SHIFT_A = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
  private static final UUID SHIFT_B = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");
  private static final UUID PERIOD = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");
  private static final UUID[] OFFICERS = {
    UUID.fromString("cccccccc-0000-0000-0000-000000000001"),
    UUID.fromString("cccccccc-0000-0000-0000-000000000002"),
    UUID.fromString("cccccccc-0000-0000-0000-000000000003"),
    UUID.fromString("cccccccc-0000-0000-0000-000000000004"),
    UUID.fromString("cccccccc-0000-0000-0000-000000000005")
  };

  @BeforeEach
  void fixture() throws Exception {
    for (UUID shift : List.of(SHIFT_A, SHIFT_B)) {
      jdbc.update("UPDATE open_shift SET filled_assignment_id = NULL WHERE id = ?", shift);
    }
    for (UUID officer : OFFICERS) {
      jdbc.update("DELETE FROM shift_assignment WHERE employee_id = ?", officer);
      jdbc.update("DELETE FROM overtime_offer WHERE employee_id = ?", officer);
      jdbc.update(
          "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id,"
              + " seniority_date) VALUES (?, ?, 'Race', 'Officer', ?, DATE '2020-01-01')"
              + " ON CONFLICT (id) DO UPDATE SET active = true",
          officer,
          "E-RACE-" + officer.toString().substring(32),
          UNIT_B);
    }
    for (UUID shift : List.of(SHIFT_A, SHIFT_B)) {
      jdbc.update(
          "INSERT INTO open_shift (id, unit_id, shift_template_id, start_at, end_at, reason,"
              + " status) SELECT ?, ?, t.id, TIMESTAMPTZ '2026-11-25 07:00:00-06',"
              + " TIMESTAMPTZ '2026-11-25 15:00:00-06', 'EXTRA_COVERAGE', 'OPEN'"
              + " FROM shift_template t WHERE t.code = 'D8'"
              + " ON CONFLICT (id) DO UPDATE SET status = 'OPEN', filled_assignment_id = NULL",
          shift,
          UNIT_B);
    }
    jdbc.update("DELETE FROM pay_period WHERE id = ?", PERIOD);
    jdbc.update(
        "INSERT INTO pay_period (id, start_date, end_date, status, locked_at, unlock_reason)"
            + " VALUES (?, DATE '2026-11-09', DATE '2026-11-22', 'LOCKED', now(), 'fixture')",
        PERIOD);

    String port = environment.getRequiredProperty("local.server.port");
    HttpResponse<String> login =
        client.send(
            HttpRequest.newBuilder(
                    URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"m.ellis\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(login.statusCode()).isEqualTo(200);
    token = (String) mapper.readValue(login.body(), Map.class).get("token");
  }

  @Test
  void threeDifferentOfficersCannotFillOneOpenShift() throws Exception {
    List<Callable<HttpResponse<String>>> calls = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      UUID officer = OFFICERS[i];
      calls.add(
          () ->
              send(
                  "POST",
                  "/api/v1/open-shifts/" + SHIFT_A + "/assign",
                  "{\"employeeId\":\"" + officer + "\"}"));
    }

    List<HttpResponse<String>> responses = inParallel(calls);

    long accepted = responses.stream().filter(response -> response.statusCode() == 200).count();
    assertThat(accepted).as("exactly one officer gets the shift").isEqualTo(1);
    assertThat(responses.stream().filter(response -> response.statusCode() == 409).count())
        .as("the others are refused as already filled")
        .isEqualTo(2);
    assertThat(count("SELECT count(*) FROM shift_assignment WHERE employee_id IN (?,?,?)",
            OFFICERS[0], OFFICERS[1], OFFICERS[2]))
        .as("one assignment exists, not three")
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM open_shift WHERE id = ?", String.class, SHIFT_A))
        .isEqualTo("FILLED");
  }

  @Test
  void twoAcceptedOffersForOneShiftConfirmOnlyOnce() throws Exception {
    UUID offerA = UUID.fromString("dddddddd-0000-0000-0000-000000000001");
    UUID offerB = UUID.fromString("dddddddd-0000-0000-0000-000000000002");
    jdbc.update("DELETE FROM overtime_offer WHERE id IN (?,?)", offerA, offerB);
    jdbc.update(
        "INSERT INTO overtime_offer (id, open_shift_id, employee_id, status)"
            + " VALUES (?, ?, ?, 'ACCEPTED'), (?, ?, ?, 'ACCEPTED')",
        offerA,
        SHIFT_B,
        OFFICERS[3],
        offerB,
        SHIFT_B,
        OFFICERS[4]);

    List<HttpResponse<String>> responses =
        inParallel(
            List.of(
                () -> send("POST", "/api/v1/offers/" + offerA + "/confirm", null),
                () -> send("POST", "/api/v1/offers/" + offerB + "/confirm", null)));

    assertThat(responses.stream().filter(response -> response.statusCode() == 200).count())
        .as("exactly one offer is confirmed")
        .isEqualTo(1);
    assertThat(responses.stream().filter(response -> response.statusCode() == 409).count())
        .isEqualTo(1);
    assertThat(count("SELECT count(*) FROM shift_assignment WHERE employee_id IN (?,?)",
            OFFICERS[3], OFFICERS[4]))
        .as("the shift has one assignment, not two")
        .isEqualTo(1);
  }

  @Test
  void twoShiftsAndTwoOfficersAssignInParallelWithoutDeadlock() throws Exception {
    List<HttpResponse<String>> responses =
        inParallel(
            List.of(
                () ->
                    send(
                        "POST",
                        "/api/v1/open-shifts/" + SHIFT_A + "/assign",
                        "{\"employeeId\":\"" + OFFICERS[0] + "\"}"),
                () ->
                    send(
                        "POST",
                        "/api/v1/open-shifts/" + SHIFT_B + "/assign",
                        "{\"employeeId\":\"" + OFFICERS[1] + "\"}")));

    assertThat(responses).allMatch(response -> response.statusCode() == 200);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment WHERE employee_id IN (?,?)",
                Integer.class,
                OFFICERS[0],
                OFFICERS[1]))
        .isEqualTo(2);
  }

  @Test
  void concurrentUnlocksWriteOneAuditRow() throws Exception {
    List<Callable<HttpResponse<String>>> calls = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      calls.add(
          () ->
              send(
                  "POST",
                  "/api/v1/pay-periods/" + PERIOD + "/unlock",
                  "{\"reason\":\"Concurrent unlock attempt\"}"));
    }

    List<HttpResponse<String>> responses = inParallel(calls);

    assertThat(responses.stream().allMatch(response -> response.statusCode() == 200)).isTrue();
    assertThat(
            jdbc.queryForObject(
                "SELECT status FROM pay_period WHERE id = ?", String.class, PERIOD))
        .isEqualTo("OPEN");
    assertThat(
            count(
                "SELECT count(*) FROM audit_event WHERE action = 'unlock_pay_period'"
                    + " AND entity_id = ?",
                PERIOD))
        .as("one real unlock writes one audit row")
        .isEqualTo(1);
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  private List<HttpResponse<String>> inParallel(List<Callable<HttpResponse<String>>> calls)
      throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(calls.size());
    CountDownLatch ready = new CountDownLatch(calls.size());
    CountDownLatch go = new CountDownLatch(1);
    List<Future<HttpResponse<String>>> futures = new ArrayList<>();
    try {
      for (Callable<HttpResponse<String>> call : calls) {
        futures.add(
            pool.submit(
                () -> {
                  ready.countDown();
                  go.await(10, TimeUnit.SECONDS);
                  return call.call();
                }));
      }
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      go.countDown();
      List<HttpResponse<String>> responses = new ArrayList<>();
      for (Future<HttpResponse<String>> future : futures) {
        responses.add(future.get(30, TimeUnit.SECONDS));
      }
      return responses;
    } finally {
      pool.shutdownNow();
    }
  }

  private long count(String sql, Object... args) {
    return jdbc.queryForObject(sql, Long.class, args);
  }

  private HttpResponse<String> send(String method, String path, String body) throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    if (body != null) {
      builder
          .header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body));
    } else {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    }
    builder.header("Authorization", "Bearer " + token);
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }
}
