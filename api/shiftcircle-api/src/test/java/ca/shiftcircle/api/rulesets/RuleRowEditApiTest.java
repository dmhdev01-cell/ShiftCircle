package ca.shiftcircle.api.rulesets;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
 * A row edit must be saved or refused, never silently dropped (review-r2's final security pass,
 * 2026-11-20). The probes found three ways the PUT answered 200 and changed nothing or stored a
 * value the build then crashed on:
 *
 * <ul>
 *   <li>an {@code afterShiftKind} edit was overwritten with {@code .*} by the stale friendly label
 *       the web leaves in {@code after};
 *   <li>a string in a numeric column was stored and crashed the build with a ClassCastException;
 *   <li>an unknown params key was ignored, so the caller believed it saved.
 * </ul>
 *
 * <p>Every test goes through HTTP because the defect was in the API mapping, not in the validator.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class RuleRowEditApiTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private Environment environment;

  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient client = HttpClient.newHttpClient();
  private String token;

  @BeforeEach
  void login() throws Exception {
    String port = environment.getRequiredProperty("local.server.port");
    HttpResponse<String> response =
        client.send(
            HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/mock-login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"userId\":\"l.fraser\"}"))
                .build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertThat(response.statusCode()).isEqualTo(200);
    token = (String) mapper.readValue(response.body(), Map.class).get("token");
  }

  // -------------------------------------------------------------------------------------------
  // (a) the shift-kind column is editable, and every bad edit is refused in words
  // -------------------------------------------------------------------------------------------

  @Test
  void aRawAfterShiftKindEditIsSavedInsteadOfDropped() throws Exception {
    int draft = draft();
    Map<String, Object> table = table(draft, "REST");
    Map<String, Object> row = row(table, "U-01");
    // The web leaves the old friendly label in 'after' and puts the edit in params.
    row.put("after", "Any shift");
    params(row).put("afterShiftKind", "D8|E8");

    HttpResponse<String> response = save(draft, "REST", table);
    assertThat(response.statusCode()).isEqualTo(200);

    assertThat(storedAfter(draft)).isEqualTo("D8|E8");
    assertThat(row(table(draft, "REST"), "U-01").get("after")).isEqualTo("D8|E8");
  }

  @Test
  void aFriendlyAfterLabelStillMapsToTheStoredPattern() throws Exception {
    int draft = draft();
    Map<String, Object> table = table(draft, "REST");
    Map<String, Object> row = row(table, "U-01");
    row.put("after", "Regular shift");
    params(row).put("afterShiftKind", "Regular shift");

    assertThat(save(draft, "REST", table).statusCode()).isEqualTo(200);
    assertThat(storedAfter(draft)).isEqualTo("(D8|E8|N8|A12|P12)");
  }

  @Test
  void aHostileAfterShiftKindIsRefusedAndNothingIsSaved() throws Exception {
    int draft = draft();
    Map<String, Object> table = table(draft, "REST");
    Map<String, Object> row = row(table, "U-01");
    row.put("after", "Any shift");
    params(row).put("afterShiftKind", ".*)|System.exit(0)|(");

    HttpResponse<String> response = save(draft, "REST", table);
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(problem(response).get("title").toString()).contains("After this kind of shift");
    assertThat(storedAfter(draft)).as("the refusal saved nothing").isEqualTo(".*");
  }

  // -------------------------------------------------------------------------------------------
  // (a) unknown keys and wrong types are refused at PUT, naming the column
  // -------------------------------------------------------------------------------------------

  @Test
  void anUnknownParamsKeyIsRefusedNamingIt() throws Exception {
    int draft = draft();
    Map<String, Object> table = table(draft, "REST");
    params(row(table, "U-01")).put("surpriseKey", 7);

    HttpResponse<String> response = save(draft, "REST", table);
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(problem(response).get("title").toString()).contains("surpriseKey");
  }

  @Test
  void aStringInANumericColumnIsRefusedNamingTheColumn() throws Exception {
    int draft = draft();
    Map<String, Object> table = table(draft, "REST");
    params(row(table, "U-01")).put("windowHours", "24\ninjected");

    HttpResponse<String> response = save(draft, "REST", table);
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(problem(response).get("title").toString()).contains("Within (hours)");
  }

  @Test
  void aStringInTheExtensionColumnIsRefusedNamingTheColumn() throws Exception {
    int draft = draft();
    Map<String, Object> table = table(draft, "REST");
    params(row(table, "U-01")).put("minExtensionMinutes", "x");

    HttpResponse<String> response = save(draft, "REST", table);
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(problem(response).get("title").toString()).contains("Overtime extension trigger");
  }

  @Test
  void aStringAllowedLengthsIsRefused() throws Exception {
    int draft = draft();
    Map<String, Object> table = table(draft, "SHIFT_LENGTHS");
    params(row(table, "L-01")).put("allowedLengths", "8,12");

    HttpResponse<String> response = save(draft, "SHIFT_LENGTHS", table);
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(problem(response).get("title").toString()).contains("Allowed regular lengths");
  }

  @Test
  void aNullAllowedLengthsIsRefused() throws Exception {
    int draft = draft();
    Map<String, Object> table = table(draft, "SHIFT_LENGTHS");
    params(row(table, "L-01")).put("allowedLengths", null);

    HttpResponse<String> response = save(draft, "SHIFT_LENGTHS", table);
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(problem(response).get("title").toString()).contains("Allowed regular lengths");
  }

  @Test
  void aHugeAllowedLengthsListIsRefusedAtTheCap() throws Exception {
    int draft = draft();
    Map<String, Object> table = table(draft, "SHIFT_LENGTHS");
    List<Integer> huge = new ArrayList<>();
    for (int i = 0; i < 4000; i++) {
      huge.add(8);
    }
    params(row(table, "L-01")).put("allowedLengths", huge);

    HttpResponse<String> response = save(draft, "SHIFT_LENGTHS", table);
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(problem(response).get("title").toString()).contains("at most");
  }

  @Test
  void minRestHoursOutsideTheRangeIsRefused() throws Exception {
    int draft = draft();
    Map<String, Object> table = table(draft, "REST");
    params(row(table, "U-01")).put("minRestHours", 999999);

    HttpResponse<String> response = save(draft, "REST", table);
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(problem(response).get("title").toString()).contains("At least (hours) off");
  }

  @Test
  void anUnsafeRuleCodeIsRefusedInPlainWords() throws Exception {
    int draft = draft();
    Map<String, Object> table = table(draft, "REST");
    row(table, "U-01").put("ruleCode", "U 01");

    HttpResponse<String> response = save(draft, "REST", table);
    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(problem(response).get("title").toString()).contains("letters, digits and hyphens");
  }

  // -------------------------------------------------------------------------------------------
  // (b) and (c) a stored bad value is a validation error, never a 500; the error list is capped
  // -------------------------------------------------------------------------------------------

  @Test
  void aBuildWithAStoredWrongTypeAnswersValidationNotAFiveHundred() throws Exception {
    int draft = draft();
    storeRaw(draft, "U-01", "{\"windowHours\":\"24\\ninjected\"}");

    HttpResponse<String> response = build(draft);
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat((List<?>) json(response).get("errors")).isNotEmpty();
  }

  @Test
  void aBuildWithAStoredAllowedLengthsStringAnswersValidationNotAFiveHundred() throws Exception {
    int draft = draft();
    storeRaw(draft, "L-01", "{\"allowedLengths\":\"8,12\"}");

    HttpResponse<String> response = build(draft);
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat((List<?>) json(response).get("errors")).isNotEmpty();
  }

  @Test
  void aBuildWithAStoredAllowedLengthsNullAnswersValidationNotAFiveHundred() throws Exception {
    int draft = draft();
    storeRaw(draft, "L-01", "{\"allowedLengths\":null}");

    HttpResponse<String> response = build(draft);
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat((List<?>) json(response).get("errors")).isNotEmpty();
  }

  @Test
  void aBuildRefusesAStoredRestAboveTheCeiling() throws Exception {
    int draft = draft();
    storeRaw(draft, "U-01", "{\"minRestHours\":999999}");

    HttpResponse<String> response = build(draft);
    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.body()).contains("between 8 and 24");
  }

  @Test
  void aBuildDoesNotReturnThousandsOfErrorsForOneHugeList() throws Exception {
    int draft = draft();
    StringBuilder lengths = new StringBuilder("[");
    for (int i = 0; i < 3999; i++) {
      lengths.append(i == 0 ? "" : ",").append(99);
    }
    lengths.append(']');
    storeRaw(draft, "L-01", "{\"allowedLengths\":" + lengths + "}");

    HttpResponse<String> response = build(draft);
    assertThat(response.statusCode()).isEqualTo(200);
    List<?> errors = (List<?>) json(response).get("errors");
    assertThat(errors).as("the list cap stops the explosion at the source").hasSizeLessThan(25);
  }

  @Test
  void aBuildCapsTheNumberOfErrorsItReturns() throws Exception {
    int draft = draft();
    for (int i = 1; i <= 30; i++) {
      jdbc.update(
          "INSERT INTO rule_row (rule_set_version_id, rule_table_id, code, enabled, params,"
              + " severity, override_policy, message, source, is_placeholder, sort_order)"
              + " SELECT v.id, t.id, ?, true,"
              + " '{\"afterShiftKind\":\".*\",\"windowHours\":24,\"minExtensionMinutes\":0,"
              + "\"minRestHours\":999999}'::jsonb, 'WARN', 'ACKNOWLEDGE', 'Extra row', 'MOCK',"
              + " false, ? FROM rule_set_version v JOIN rule_table t ON t.code = 'REST'"
              + " WHERE v.version = ?",
          "X-" + i,
          300 + i,
          draft);
    }

    HttpResponse<String> response = build(draft);
    assertThat(response.statusCode()).isEqualTo(200);
    List<?> errors = (List<?>) json(response).get("errors");
    assertThat(errors).as("the report shows 20 and counts the rest").hasSize(21);
    assertThat(errors.get(errors.size() - 1).toString()).contains("more");
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  private int draft() throws Exception {
    HttpResponse<String> response =
        send(
            "POST",
            "/api/v1/rule-sets/drafts",
            "{\"basedOn\":1,\"reason\":\"review-r2 row-edit probes\"}");
    assertThat(response.statusCode()).isEqualTo(201);
    return ((Number) json(response).get("version")).intValue();
  }

  private Map<String, Object> table(int version, String code) throws Exception {
    HttpResponse<String> response =
        send("GET", "/api/v1/rule-sets/" + version + "/tables/" + code, null);
    assertThat(response.statusCode()).isEqualTo(200);
    return json(response);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> row(Map<String, Object> table, String ruleCode) {
    return ((List<Map<String, Object>>) table.get("rows"))
        .stream().filter(row -> ruleCode.equals(row.get("ruleCode"))).findFirst().orElseThrow();
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> params(Map<String, Object> row) {
    return (Map<String, Object>) row.get("params");
  }

  private HttpResponse<String> save(int version, String code, Map<String, Object> table)
      throws Exception {
    String body = mapper.writeValueAsString(Map.of("rows", table.get("rows")));
    return send("PUT", "/api/v1/rule-sets/" + version + "/tables/" + code + "/rows", body);
  }

  private HttpResponse<String> build(int version) throws Exception {
    return send("POST", "/api/v1/rule-sets/" + version + "/build", null);
  }

  private String storedAfter(int version) {
    String params =
        jdbc.queryForObject(
            "SELECT rr.params::text FROM rule_row rr JOIN rule_set_version v"
                + " ON v.id = rr.rule_set_version_id WHERE v.version = ? AND rr.code = 'U-01'",
            String.class,
            version);
    Map<String, Object> parsed = mapper.readValue(params, Map.class);
    return (String) parsed.get("afterShiftKind");
  }

  private void storeRaw(int version, String code, String json) {
    jdbc.update(
        "UPDATE rule_row rr SET params = rr.params || ?::jsonb FROM rule_set_version v"
            + " WHERE v.id = rr.rule_set_version_id AND v.version = ? AND rr.code = ?",
        json,
        version,
        code);
  }

  private Map<?, ?> problem(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
  }

  private Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return mapper.readValue(response.body(), Map.class);
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
