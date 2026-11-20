package ca.shiftcircle.api.schedule;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.infrastructure.demo.DemoDataGenerator;
import ca.shiftcircle.infrastructure.demo.DemoSettings;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/**
 * The demo dataset seeds the roster weeks a supervisor publishes, so the publish feature works on a
 * fresh stack without a planted row: the period comes from the generator, the publish comes from the
 * live endpoint, and the board reads the row it wrote.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(OrderAnnotation.class)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class SchedulePeriodSeedApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private final Map<String, String> tokens = new LinkedHashMap<>();

  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");
  private static final LocalDate DEMO_WEEK_START = LocalDate.of(2026, 11, 16);
  private static final LocalDate DEMO_WEEK_END = LocalDate.of(2026, 11, 22);

  @BeforeAll
  void generateTheDataset() {
    new DemoDataGenerator(jdbc).generate(DemoSettings.defaults());
    for (String user : new String[] {"m.ellis", "t.nakamura", "a.reviewer"}) {
      tokens.put(user, login(user));
    }
  }

  private String login(String username) {
    try {
      HttpResponse<String> response =
          client.send(
              HttpRequest.newBuilder(URI.create("http://localhost:" + port() + "/api/v1/auth/mock-login"))
                  .header("Content-Type", "application/json")
                  .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"" + username + "\"}"))
                  .build(),
              HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      assertThat(response.statusCode()).isEqualTo(200);
      return (String) mapper.readValue(response.body(), Map.class).get("token");
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private String port() {
    return environment.getRequiredProperty("local.server.port");
  }

  private HttpResponse<String> post(String path, String user) throws Exception {
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port() + path))
            .POST(HttpRequest.BodyPublishers.noBody());
    if (user != null) {
      builder.header("Authorization", "Bearer " + tokens.get(user));
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private HttpResponse<String> get(String path, String user) throws Exception {
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create("http://localhost:" + port() + path)).GET();
    if (user != null) {
      builder.header("Authorization", "Bearer " + tokens.get(user));
    }
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }

  private String board() {
    return "/api/v1/schedule?unitId=" + UNIT_A + "&from=" + DEMO_WEEK_START + "&to=" + DEMO_WEEK_END;
  }

  private UUID seededPeriod(LocalDate start, String status) {
    List<UUID> ids =
        jdbc.queryForList(
            "SELECT id FROM schedule_period WHERE unit_id = ? AND start_date = ? AND status = ?",
            UUID.class,
            UNIT_A,
            start,
            status);
    assertThat(ids).as("a seeded period for the week of " + start).hasSize(1);
    return ids.get(0);
  }

  @Test
  @Order(1)
  void everyUnitHasARosterWeekForTheWindowAndOnlyThePastOnesArePublished() {
    assertThat(
            jdbc.queryForObject(
                "SELECT count(DISTINCT unit_id) FROM schedule_period", Integer.class))
        .isEqualTo(6);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM schedule_period WHERE unit_id = ?", Integer.class, UNIT_A))
        .isEqualTo(14);

    // The week before the demo day is history: published, with a timestamp and no publisher.
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM schedule_period WHERE unit_id = ?"
                    + " AND start_date = DATE '2026-11-09' AND status = 'PUBLISHED'"
                    + " AND published_at IS NOT NULL AND published_by IS NULL",
                Integer.class,
                UNIT_A))
        .isEqualTo(1);

    // The demo week and the week after it are drafts: that is what a supervisor publishes.
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM schedule_period WHERE unit_id = ?"
                    + " AND start_date = DATE '2026-11-16' AND status = 'DRAFT'",
                Integer.class,
                UNIT_A))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM schedule_period WHERE unit_id = ?"
                    + " AND start_date = DATE '2026-11-23' AND status = 'DRAFT'",
                Integer.class,
                UNIT_A))
        .isEqualTo(1);

    // Every shift belongs to the period that covers its work date.
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM shift_assignment WHERE schedule_period_id IS NULL",
                Integer.class))
        .isZero();
  }

  @Test
  @Order(2)
  void theBoardCarriesThePeriodItReadsSoTheWebCanPublish() throws Exception {
    Map<String, Object> body = json(get(board(), "m.ellis"));
    Map<String, Object> state = (Map<String, Object>) body.get("publishedState");

    assertThat(state.get("published")).isEqualTo(false);
    assertThat(state.get("unpublishedChanges"))
        .as("a draft period has nothing published to compare against")
        .isNull();

    Map<?, ?> period = (Map<?, ?>) body.get("period");
    assertThat(period).isNotNull();
    assertThat(period.get("id")).isEqualTo(seededPeriod(DEMO_WEEK_START, "DRAFT").toString());
    assertThat(period.get("label")).isEqualTo("16 – 22 Nov 2026");
    assertThat(period.get("status")).isEqualTo("DRAFT");
  }

  @Test
  @Order(3)
  void publishingASeededPeriodWorksOnAFreshDataset() throws Exception {
    UUID period = seededPeriod(DEMO_WEEK_START, "DRAFT");
    String path = "/api/v1/schedule-periods/" + period + "/publish";

    assertThat(post(path, null).statusCode()).isEqualTo(401);
    assertThat(post(path, "t.nakamura").statusCode())
        .as("an employee cannot publish a roster")
        .isEqualTo(403);
    assertThat(post(path, "a.reviewer").statusCode())
        .as("an auditor is read-only")
        .isEqualTo(403);

    HttpResponse<String> published = post(path, "m.ellis");
    assertThat(published.statusCode()).isEqualTo(200);
    Map<String, Object> body = json(published);
    assertThat(body.get("id")).isEqualTo(period.toString());
    assertThat(body.get("status")).isEqualTo("PUBLISHED");
    assertThat((String) body.get("publishedAt")).isNotBlank();

    Map<String, Object> board = json(get(board(), "m.ellis"));
    Map<String, Object> state = (Map<String, Object>) board.get("publishedState");
    assertThat(state.get("published")).isEqualTo(true);
    assertThat(state.get("unpublishedChanges"))
        .as("nothing changed after the publication yet")
        .isEqualTo(0);
    Map<?, ?> publishedPeriod = (Map<?, ?>) board.get("period");
    assertThat(publishedPeriod.get("status")).isEqualTo("PUBLISHED");

    assertThat(post(path, "m.ellis").statusCode())
        .as("publishing is one-way")
        .isEqualTo(409);

    Integer audits =
        jdbc.queryForObject(
            "SELECT count(*) FROM audit_event WHERE action = 'publish_schedule_period'"
                + " AND entity_id = ?",
            Integer.class,
            period);
    assertThat(audits).isEqualTo(1);
  }

  @Test
  @Order(4)
  void aPastWeekIsAlreadyPublishedAndCannotBePublishedAgain() throws Exception {
    UUID past = seededPeriod(LocalDate.of(2026, 11, 9), "PUBLISHED");

    assertThat(post("/api/v1/schedule-periods/" + past + "/publish", "m.ellis").statusCode())
        .as("a published period is not published twice")
        .isEqualTo(409);

    Map<String, Object> body = json(get(pastBoard(), "m.ellis"));
    Map<String, Object> state = (Map<String, Object>) body.get("publishedState");
    assertThat(state.get("published")).isEqualTo(true);
    assertThat(state.get("unpublishedChanges")).isEqualTo(0);
  }

  @Test
  @Order(5)
  void theBoardCountsTheShiftsChangedAfterThePublication() throws Exception {
    // A published period: the shifts assigned, moved or cancelled after it was published are the
    // ones the board shows as not published yet. The audit trail is the source.
    UUID moved =
        jdbc.queryForObject(
            "SELECT s.id FROM shift_assignment s WHERE s.unit_id = ?"
                + " AND s.work_date BETWEEN DATE '2026-11-09' AND DATE '2026-11-15' LIMIT 1",
            UUID.class,
            UNIT_A);
    UUID elsewhere =
        jdbc.queryForObject(
            "SELECT s.id FROM shift_assignment s WHERE s.unit_id = ?"
                + " AND s.work_date BETWEEN DATE '2026-12-01' AND DATE '2026-12-07' LIMIT 1",
            UUID.class,
            UNIT_A);

    jdbc.update(
        "INSERT INTO audit_event (occurred_at, action, entity_type, entity_id, after) VALUES"
            + " (TIMESTAMPTZ '2026-11-16 10:00:00-06', 'move_assignment', 'shift_assignment', ?,"
            + " '{}'::jsonb),"
            + " (TIMESTAMPTZ '2026-11-16 10:00:00-06', 'move_assignment', 'shift_assignment', ?,"
            + " '{}'::jsonb)",
        moved,
        elsewhere);

    Map<String, Object> body = json(get(pastBoard(), "m.ellis"));
    Map<String, Object> state = (Map<String, Object>) body.get("publishedState");
    assertThat(state.get("published")).isEqualTo(true);
    assertThat(state.get("unpublishedChanges"))
        .as("only the shift in this period counts")
        .isEqualTo(1);
  }

  private String pastBoard() {
    return "/api/v1/schedule?unitId=" + UNIT_A + "&from=2026-11-09&to=2026-11-15";
  }

  @Test
  @Order(6)
  void aBoardThatSpansTwoWeeksHasNoSinglePeriod() throws Exception {
    // The contract: the period whose dates contain the board's range. Two weeks are not inside one
    // period, so the board says it has none rather than guessing which week to publish.
    String twoWeeks = "/api/v1/schedule?unitId=" + UNIT_A + "&from=2026-11-09&to=2026-11-22";

    Map<String, Object> body = json(get(twoWeeks, "m.ellis"));

    assertThat(body.get("period")).isNull();
    Map<String, Object> state = (Map<String, Object>) body.get("publishedState");
    assertThat(state.get("published")).isEqualTo(false);
    assertThat(state.get("unpublishedChanges")).isNull();
  }
}
