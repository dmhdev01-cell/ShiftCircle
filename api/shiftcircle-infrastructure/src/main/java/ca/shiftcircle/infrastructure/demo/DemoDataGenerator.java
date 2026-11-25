package ca.shiftcircle.infrastructure.demo;

import ca.shiftcircle.rules.build.BusinessTime;
import ca.shiftcircle.rules.pay.PayClassification;
import ca.shiftcircle.rules.pay.PayClassifier;
import ca.shiftcircle.rules.pay.PayPolicy;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Generates the synthetic demo dataset (docs/10-testing.md §6) on the {@code demo} profile, once,
 * when the database has no officers.
 *
 * <p>Everything is seeded: the same seed and "today" produce the same roster, the same absences, the
 * same overtime and the same checksum. The generator fails its own self-check loudly rather than
 * leaving a dataset that only looks plausible.
 */
@Component
@Profile("demo")
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
    name = "sc.demo.generate", havingValue = "true", matchIfMissing = true)
public class DemoDataGenerator implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(DemoDataGenerator.class);

  static final String[] UNIT_CODES = {"A", "B", "C", "ADM", "CTL", "ESC"};

  // Docs/10 §6.5 says "~4% sick, ~4% vacation". With an 80 h period threshold and a roster that
  // already averages 84 h per period for the 12-hour crews, 8% absences cannot be covered without
  // pushing overtime past the 3-6% band the same section asks for, so the rates are 2% + 2%:
  // the demo keeps real gaps and real overtime without breaking either target. Recorded in
  // docs/process/ai-dev-log.md.
  static final double SICK_RATE = 0.02;
  static final double VACATION_RATE = 0.02;
  static final Map<String, Integer> OFFICERS_PER_UNIT =
      Map.of("A", 18, "B", 18, "C", 17, "ADM", 13, "CTL", 15, "ESC", 19);

  private static final Map<String, String> UNIT_QUALIFICATION =
      Map.of("CTL", "CONTROL", "ESC", "ESCORT");

  private final JdbcTemplate jdbc;
  private final Environment environment;
  private final DemoDataReadiness readiness;
  private List<DemoSeedFollowUp> followUps = List.of();

  @org.springframework.beans.factory.annotation.Autowired
  public DemoDataGenerator(
      JdbcTemplate jdbc, Environment environment, DemoDataReadiness readiness) {
    this.jdbc = jdbc;
    this.environment = environment;
    this.readiness = readiness;
  }

  public DemoDataGenerator(JdbcTemplate jdbc, Environment environment) {
    this(jdbc, environment, null);
  }

  /** For tests and tools that generate with explicit settings instead of environment defaults. */
  public DemoDataGenerator(JdbcTemplate jdbc) {
    this(jdbc, null, null);
  }

  /** v1.3 P5: seeding in other modules that runs after a fresh boot generation (none in tests). */
  @org.springframework.beans.factory.annotation.Autowired(required = false)
  public void setFollowUps(List<DemoSeedFollowUp> followUps) {
    this.followUps = followUps == null ? List.of() : List.copyOf(followUps);
  }

  @Override
  public void run(ApplicationArguments args) {
    if (generateIfEmpty()) {
      long seed = settingsFromEnvironment().seed();
      for (DemoSeedFollowUp followUp : followUps) {
        followUp.afterGenerate(seed);
      }
    }
    // A failed generation throws, so readiness stays DOWN instead of advertising an empty board.
    if (readiness != null) {
      readiness.markReady();
    }
  }

  /** Generates the dataset when the database has no officers; returns true when it generated. */
  public boolean generateIfEmpty() {
    Integer officers = jdbc.queryForObject("SELECT count(*) FROM employee", Integer.class);
    if (officers != null && officers > 0) {
      log.info("Demo data already present ({} officers); generator skipped", officers);
      return false;
    }
    generate(settingsFromEnvironment());
    return true;
  }

  public DemoSettings settingsFromEnvironment() {
    return DemoSettings.of(
        environment.getProperty("SC_DEMO_SEED", "20261001"),
        environment.getProperty("SC_DEMO_TODAY", "2026-11-19"),
        environment.getProperty("SC_DEMO_WINDOW_START", "2026-10-01"),
        environment.getProperty("SC_DEMO_WINDOW_END", "2026-12-29"));
  }

  public void generate(DemoSettings settings) {
    long started = System.currentTimeMillis();
    Random random = new Random(settings.seed());

    Map<String, Unit> units = loadUnits();
    Map<String, Map<String, Integer>> requirements = loadRequirements();
    Map<String, UUID> templates = loadTemplates();
    UUID ruleSetVersion = publishedRuleSetVersion();

    List<PayPeriod> payPeriods = createPayPeriods(settings);
    List<SchedulePeriod> schedulePeriods = createSchedulePeriods(settings, units, UNIT_CODES);
    List<Officer> officers = createOfficers(settings, random, units);
    seedPreferences(settings, officers);

    RosterPlanner planner = new RosterPlanner();
    List<RosterPlanner.Shift> shifts = planShifts(settings, units, requirements, planner);
    Map<RosterPlanner.Shift, String> assigned =
        planner.assign(shifts, officersByUnit(officers));

    List<Assignment> assignments = persistAssignments(settings, units, templates, assigned, shifts);
    List<Absence> absences = createAbsences(random, assignments);
    persistAbsences(absences);
    assignments = linkAbsences(assignments, absences);

    List<OpenShift> openShifts =
        createOpenShifts(settings, units, templates, assignments, absences, UNIT_CODES);
    List<Offer> offers = fillOpenShifts(settings, random, openShifts, assignments, officers, units);
    persistExtraAssignments(assignments);
    persistOpenShifts(openShifts);
    persistOffers(offers);
    linkDemoSignIn();

    Instant now = settings.today().atTime(LocalTime.NOON).atZone(BusinessTime.REGINA).toInstant();
    persistTimeEntries(settings, payPeriods, assignments, absences, now, random);
    new DemoPlantedCases(jdbc).apply();
    // Release v1.3 (S4): the supervisors come after every officer row is written, from their own
    // Random, so the officers' roster, absences, overtime and actuals stay byte-identical.
    seedSupervisors(settings, units, templates, payPeriods, now);
    linkAssignmentsToPeriods();
    assignPayCodes(payPeriods);
    lockPastPayPeriods(settings, payPeriods);
    persistAuditEvents(settings);

    DemoDataSelfCheck.Summary summary = new DemoDataSelfCheck(jdbc, environment, now).verify();
    log.info(
        "Demo data generated in {} ms: {} assignments, {} absences, {} open shifts, {} offers,"
            + " {} schedule periods, checksum {}",
        System.currentTimeMillis() - started,
        summary.assignments(),
        summary.absences(),
        summary.openShifts(),
        summary.offers(),
        schedulePeriods.size(),
        DemoChecksum.of(jdbc));
  }

  // ---------------------------------------------------------------------------------------------
  // Reference data
  // ---------------------------------------------------------------------------------------------

  record Unit(UUID id, String code, boolean allows12h, boolean allows16h) {}

  private Map<String, Unit> loadUnits() {
    Map<String, Unit> units = new LinkedHashMap<>();
    jdbc.query(
        "SELECT id, code, allows_12h, allows_16h FROM unit ORDER BY code",
        (org.springframework.jdbc.core.RowCallbackHandler) resultSet -> {
          Unit unit =
              new Unit(
                  (UUID) resultSet.getObject("id"),
                  resultSet.getString("code"),
                  resultSet.getBoolean("allows_12h"),
                  resultSet.getBoolean("allows_16h"));
          units.put(unit.code(), unit);
        });
    return units;
  }

  private Map<String, Map<String, Integer>> loadRequirements() {
    Map<String, Map<String, Integer>> requirements = new LinkedHashMap<>();
    jdbc.query(
        "SELECT u.code AS unit_code, r.block, r.min_staff FROM unit_requirement r"
            + " JOIN unit u ON u.id = r.unit_id WHERE r.effective_to IS NULL",
        (org.springframework.jdbc.core.RowCallbackHandler) resultSet -> {
          requirements
              .computeIfAbsent(resultSet.getString("unit_code"), key -> new LinkedHashMap<>())
              .put(resultSet.getString("block"), resultSet.getInt("min_staff"));
        });
    return requirements;
  }

  private Map<String, UUID> loadTemplates() {
    Map<String, UUID> templates = new LinkedHashMap<>();
    jdbc.query(
        "SELECT id, code FROM shift_template",
        (org.springframework.jdbc.core.RowCallbackHandler)
            resultSet ->
                templates.put(resultSet.getString("code"), (UUID) resultSet.getObject("id")));
    return templates;
  }

  private UUID publishedRuleSetVersion() {
    return jdbc.queryForObject(
        "SELECT id FROM rule_set_version WHERE status = 'PUBLISHED'", UUID.class);
  }

  // ---------------------------------------------------------------------------------------------
  // Pay periods (docs/10 §6.1): biweekly, Monday start; periods ending before today are locked.
  // ---------------------------------------------------------------------------------------------

  record PayPeriod(UUID id, LocalDate start, LocalDate end, boolean locked) {}

  private List<PayPeriod> createPayPeriods(DemoSettings settings) {
    List<PayPeriod> periods = new ArrayList<>();
    LocalDate start = LocalDate.of(2026, 9, 28);
    LocalDate windowStart = settings.windowStart();
    while (start.isBefore(settings.windowEnd())) {
      LocalDate end = start.plusDays(13);
      boolean locked = end.isBefore(settings.today());
      UUID id = id("pay-period:" + start);
      periods.add(new PayPeriod(id, start, end, locked));
      start = end.plusDays(1);
    }
    // Only periods that overlap the roster window are useful; keep the one before it so early
    // October shifts have a period (the 28 Sep period covers 1-11 Oct).
    jdbc.batchUpdate(
        "INSERT INTO pay_period (id, start_date, end_date, status) VALUES (?, ?, ?, ?)",
        periods.stream()
            .filter(period -> !period.end().isBefore(windowStart))
            .map(
                period ->
                    new Object[] {
                      period.id(), period.start(), period.end(), "OPEN"
                    })
            .toList());
    return periods.stream().filter(period -> !period.end().isBefore(windowStart)).toList();
  }

  // ---------------------------------------------------------------------------------------------
  // Schedule periods (docs/10 §6.1): one roster week per unit, so a supervisor has a period to
  // publish. Weeks that ended before "today" are published history; the current week and the weeks
  // after it are drafts, which is what the planning board shows and what the demo publishes.
  // ---------------------------------------------------------------------------------------------

  record SchedulePeriod(
      UUID id, UUID unitId, String unitCode, LocalDate start, LocalDate end, boolean published) {}

  private List<SchedulePeriod> createSchedulePeriods(
      DemoSettings settings, Map<String, Unit> units, String[] unitCodes) {
    List<SchedulePeriod> periods = new ArrayList<>();
    LocalDate week = weekStart(settings.windowStart());
    while (!week.isAfter(settings.windowEnd())) {
      LocalDate end = week.plusDays(6);
      // A period that has ended is history and reads as published; the period "today" falls in and
      // everything after it is still to be planned.
      boolean published = end.isBefore(settings.today());
      for (String unitCode : unitCodes) {
        Unit unit = units.get(unitCode);
        periods.add(
            new SchedulePeriod(
                id("schedule-period:" + unitCode + ":" + week),
                unit.id(),
                unitCode,
                week,
                end,
                published));
      }
      week = week.plusDays(7);
    }
    jdbc.batchUpdate(
        "INSERT INTO schedule_period (id, unit_id, start_date, end_date, status, published_at)"
            + " VALUES (?, ?, ?, ?, ?, ?)",
        periods.stream()
            .map(
                period ->
                    new Object[] {
                      period.id(),
                      period.unitId(),
                      period.start(),
                      period.end(),
                      period.published() ? "PUBLISHED" : "DRAFT",
                      period.published() ? ts(publishedAt(period.end())) : null
                    })
            .toList());
    return periods;
  }

  /** Roster weeks start on Monday, like the pay periods. */
  private static LocalDate weekStart(LocalDate date) {
    return date.minusDays(date.getDayOfWeek().getValue() - 1L);
  }

  /**
   * A past week was published the morning after it ended. The timestamp is derived from the period,
   * not from the clock, so the same seed always produces the same dataset.
   */
  private static Instant publishedAt(LocalDate end) {
    return end.plusDays(1).atTime(9, 0).atZone(DemoSettings.REGINA).toInstant();
  }

  /** Every rostered shift belongs to the period that covers its work date (docs/06). */
  private void linkAssignmentsToPeriods() {
    jdbc.update(
        "UPDATE shift_assignment s SET schedule_period_id = p.id FROM schedule_period p"
            + " WHERE p.unit_id = s.unit_id AND s.work_date BETWEEN p.start_date AND p.end_date"
            + " AND s.schedule_period_id IS NULL");
  }

  // ---------------------------------------------------------------------------------------------
  // Officers
  // ---------------------------------------------------------------------------------------------

  record Officer(UUID id, String employeeNo, String firstName, String lastName, String unitCode,
      UUID unitId, LocalDate seniorityDate, List<String> qualifications) {}

  private List<Officer> createOfficers(
      DemoSettings settings, Random random, Map<String, Unit> units) {
    List<Officer> officers = new ArrayList<>();
    int index = 0;

    List<DemoNames.Named> named = DemoNames.NAMED;
    Map<String, Integer> remaining = new LinkedHashMap<>();
    for (String unitCode : UNIT_CODES) {
      remaining.put(unitCode, OFFICERS_PER_UNIT.get(unitCode));
    }

    for (DemoNames.Named character : named) {
      index++;
      officers.add(
          officer(
              index,
              character.employeeNo(),
              character.firstName(),
              character.lastName(),
              character.unitCode(),
              units,
              random));
      remaining.computeIfPresent(character.unitCode(), (code, count) -> count - 1);
    }

    List<String> firstNames = new ArrayList<>(DemoNames.FIRST_NAMES);
    List<String> lastNames = new ArrayList<>(DemoNames.LAST_NAMES);
    List<String> usedPairs = new ArrayList<>();
    named.forEach(character -> usedPairs.add(character.firstName() + " " + character.lastName()));

    for (String unitCode : UNIT_CODES) {
      int count = remaining.get(unitCode);
      for (int i = 0; i < count; i++) {
        index++;
        String first;
        String last;
        do {
          first = firstNames.get(random.nextInt(firstNames.size()));
          last = lastNames.get(random.nextInt(lastNames.size()));
        } while (usedPairs.contains(first + " " + last));
        usedPairs.add(first + " " + last);
        officers.add(
            officer(index, String.format("E-%03d", index), first, last, unitCode, units, random));
      }
    }
    return officers;
  }

  private Officer officer(
      int index,
      String employeeNo,
      String firstName,
      String lastName,
      String unitCode,
      Map<String, Unit> units,
      Random random) {
    LocalDate seniority =
        LocalDate.of(2006, 1, 1).plusDays(random.nextInt(19 * 365));
    List<String> qualifications = new ArrayList<>();
    String required = UNIT_QUALIFICATION.get(unitCode);
    if (required != null) {
      qualifications.add(required);
    } else if (random.nextDouble() < 0.25) {
      qualifications.add(random.nextBoolean() ? "CONTROL" : "ESCORT");
    }
    if (random.nextDouble() < 0.7) {
      qualifications.add("FIRST_AID");
    }

    UUID id = id("employee:" + employeeNo);
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, home_unit_id,"
            + " shift_pattern, seniority_date, is_synthetic)"
            + " VALUES (?, ?, ?, ?, ?, 'ROTATING_5_2', ?, true)",
        id,
        employeeNo,
        firstName,
        lastName,
        units.get(unitCode).id(),
        seniority);
    for (String qualification : qualifications) {
      jdbc.update(
          "INSERT INTO employee_qualification (employee_id, qualification_id, valid_from)"
              + " SELECT ?, id, DATE '2020-01-01' FROM qualification WHERE code = ?",
          id,
          qualification);
    }
    return new Officer(
        id, employeeNo, firstName, lastName, unitCode, units.get(unitCode).id(), seniority,
        qualifications);
  }

  /**
   * Synthetic preferences for the planner, deterministic from the dataset seed and the officer
   * number. They are demo data, not a checksum input (the checksum covers the roster and the
   * schedule periods), so seeding them leaves the dataset checksum unchanged.
   */
  private void seedPreferences(DemoSettings settings, List<Officer> officers) {
    String[] weekdays = {"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"};
    for (Officer officer : officers) {
      int h = Math.floorMod((settings.seed() + "|" + officer.employeeNo()).hashCode(), 20);
      int shiftLength = h == 0 ? 16 : h < 3 ? 12 : 8;
      int t = Math.floorMod((settings.seed() + "|time|" + officer.employeeNo()).hashCode(), 20);
      String timeOfDay = t == 0 ? "NIGHT" : t < 3 ? "EVENING" : t < 5 ? "DAY" : "NONE";
      String[] timesOfDay =
          "NONE".equals(timeOfDay) ? new String[] {} : new String[] {timeOfDay};
      String dayOne = weekdays[Math.floorMod((officer.employeeNo() + "|off1").hashCode(), 7)];
      String dayTwo = weekdays[Math.floorMod((officer.employeeNo() + "|off2").hashCode(), 7)];
      jdbc.update(
          connection -> {
            var statement =
                connection.prepareStatement(
                    "INSERT INTO officer_preference (employee_id, shift_length, times_of_day,"
                        + " days_off) VALUES (?, ?, ?, ?) ON CONFLICT (employee_id) DO NOTHING");
            statement.setObject(1, officer.id());
            statement.setInt(2, shiftLength);
            statement.setArray(3, connection.createArrayOf("text", timesOfDay));
            statement.setArray(
                4,
                connection.createArrayOf(
                    "text",
                    dayOne.equals(dayTwo) ? new String[] {dayOne} : new String[] {dayOne, dayTwo}));
            return statement;
          });
    }
  }

  /**
   * The demo sign-in {@code t.nakamura} is Tara Nakamura (E-001), so My schedule and her overtime
   * offers show real rows. V3 seeds the account; only the generator knows which officer she is.
   */
  private void linkDemoSignIn() {
    jdbc.update(
        "UPDATE app_user SET employee_id = (SELECT id FROM employee WHERE employee_no = 'E-001')"
            + " WHERE username = 't.nakamura'");
  }

  private Map<String, List<String>> officersByUnit(List<Officer> officers) {
    Map<String, List<String>> byUnit = new LinkedHashMap<>();
    officers.forEach(
        officer ->
            byUnit.computeIfAbsent(officer.unitCode(), key -> new ArrayList<>())
                .add(officer.employeeNo()));
    return byUnit;
  }

  // ---------------------------------------------------------------------------------------------
  // Supervisors (release v1.3, S4; docs/10-testing.md §6.4)
  // ---------------------------------------------------------------------------------------------

  /** The two supervisor posts (V19), each needing one supervisor per block, 24/7. */
  static final String[] SUPERVISOR_POSTS = {"SUP-L", "SUP-O"};

  /** Five per post: 21 eight-hour shifts a week per post over five people on 5 on / 2 off. */
  static final int SUPERVISORS_PER_POST = 5;

  /**
   * The supervisors draw from their own Random (seed XOR this salt, the plan's "0x5u9"), so not one
   * officer draw moves and the officers' rows stay byte-identical to the pre-supervisor dataset.
   */
  static final long SUPERVISOR_SALT = 0x509L;

  /**
   * Seeds the ten supervisors on the two posts: their schedule periods, an 8 h D8/E8/N8 rotating
   * roster, 2% sick and 2% vacation like the officers, the sick calls offered as overtime to the
   * other supervisors, and their actuals. M. Ellis (S-001, SUP-L) and J. Chen (S-006, SUP-O) are the
   * demo sign-ins, so their My schedule shows real rows.
   */
  private void seedSupervisors(
      DemoSettings settings,
      Map<String, Unit> units,
      Map<String, UUID> templates,
      List<PayPeriod> payPeriods,
      Instant now) {
    for (String post : SUPERVISOR_POSTS) {
      if (!units.containsKey(post)) {
        // A schema without the posts (before V19) has no supervisors to seed.
        return;
      }
    }
    Random random = new Random(settings.seed() ^ SUPERVISOR_SALT);
    createSchedulePeriods(settings, units, SUPERVISOR_POSTS);
    List<Officer> supervisors = createSupervisors(random, units);

    RosterPlanner planner = new RosterPlanner();
    List<RosterPlanner.Shift> shifts = new ArrayList<>();
    for (int dayIndex = 0; dayIndex < settings.days(); dayIndex++) {
      LocalDate date = settings.windowStart().plusDays(dayIndex);
      for (String post : SUPERVISOR_POSTS) {
        // 8 h only on Dataset 100: no 12 h swap, whatever the post allows.
        shifts.addAll(planner.shiftsFor(date, post, new RosterPlanner.Requirements(1, 1, 1), false));
      }
    }
    Map<RosterPlanner.Shift, String> assigned = planner.assign(shifts, officersByUnit(supervisors));
    List<Assignment> assignments = persistAssignments(settings, units, templates, assigned, shifts);
    List<Absence> absences = createAbsences(random, assignments);
    persistAbsences(absences);
    assignments = linkAbsences(assignments, absences);

    List<OpenShift> openShifts =
        createOpenShifts(settings, units, templates, assignments, absences, SUPERVISOR_POSTS);
    // The candidates are the supervisors only: a supervisor post is never offered to an officer.
    List<Offer> offers = fillOpenShifts(settings, random, openShifts, assignments, supervisors, units);
    persistExtraAssignments(assignments);
    persistOpenShifts(openShifts);
    persistOffers(offers);
    persistTimeEntries(settings, payPeriods, assignments, absences, now, random);

    jdbc.update(
        "UPDATE app_user SET employee_id = (SELECT id FROM employee WHERE employee_no = 'S-001')"
            + " WHERE username = 'm.ellis'");
    jdbc.update(
        "UPDATE app_user SET employee_id = (SELECT id FROM employee WHERE employee_no = 'S-006')"
            + " WHERE username = 'j.chen'");
  }

  private List<Officer> createSupervisors(Random random, Map<String, Unit> units) {
    List<String> usedPairs =
        new ArrayList<>(
            jdbc.queryForList("SELECT first_name || ' ' || last_name FROM employee", String.class));
    List<Officer> supervisors = new ArrayList<>();
    int number = 0;
    for (String post : SUPERVISOR_POSTS) {
      for (int index = 0; index < SUPERVISORS_PER_POST; index++) {
        number++;
        String first;
        String last;
        if (number == 1) {
          first = "Morgan";
          last = "Ellis";
        } else if (number == SUPERVISORS_PER_POST + 1) {
          first = "Jamie";
          last = "Chen";
        } else {
          do {
            first = DemoNames.FIRST_NAMES.get(random.nextInt(DemoNames.FIRST_NAMES.size()));
            last = DemoNames.LAST_NAMES.get(random.nextInt(DemoNames.LAST_NAMES.size()));
          } while (usedPairs.contains(first + " " + last)
              || "Ellis".equals(last)
              || "Chen".equals(last));
        }
        usedPairs.add(first + " " + last);
        String employeeNo = String.format("S-%03d", number);
        // Service 2004-2014 and promotion 2018-2025: distinct, deterministic, and the promotion is
        // always after the service date (the V16 check).
        LocalDate seniority = LocalDate.of(2004, 1, 1).plusDays((number - 1) * 400L);
        LocalDate positionSince = LocalDate.of(2018, 1, 1).plusDays((number - 1) * 290L);
        UUID id = id("employee:" + employeeNo);
        jdbc.update(
            "INSERT INTO employee (id, employee_no, first_name, last_name, classification,"
                + " position_since, home_unit_id, shift_pattern, seniority_date, is_synthetic)"
                + " VALUES (?, ?, ?, ?, 'CS', ?, ?, 'ROTATING_5_2', ?, true)",
            id,
            employeeNo,
            first,
            last,
            positionSince,
            units.get(post).id(),
            seniority);
        // Supervisors have preferences too (the table name is historical): 8 h, and the two demo
        // supervisors prefer days. The quarter planner puts only 12 h staff on nights, so its
        // Dataset 100 plan leaves the posts' nights short, as it does the 8 h officers' (a 12 h
        // preference for some supervisors was measured and left more posts short, not fewer).
        boolean demoUser = number == 1 || number == SUPERVISORS_PER_POST + 1;
        String[] timesOfDay = demoUser ? new String[] {"DAY"} : new String[] {};
        int shiftLength = 8;
        jdbc.update(
            connection -> {
              var statement =
                  connection.prepareStatement(
                      "INSERT INTO officer_preference (employee_id, shift_length, times_of_day,"
                          + " days_off) VALUES (?, ?, ?, '{}')");
              statement.setObject(1, id);
              statement.setInt(2, shiftLength);
              statement.setArray(3, connection.createArrayOf("text", timesOfDay));
              return statement;
            });
        supervisors.add(
            new Officer(
                id, employeeNo, first, last, post, units.get(post).id(), seniority, List.of()));
      }
    }
    return supervisors;
  }

  // ---------------------------------------------------------------------------------------------
  // Roster
  // ---------------------------------------------------------------------------------------------

  private List<RosterPlanner.Shift> planShifts(
      DemoSettings settings,
      Map<String, Unit> units,
      Map<String, Map<String, Integer>> requirements,
      RosterPlanner planner) {
    List<RosterPlanner.Shift> shifts = new ArrayList<>();
    for (int dayIndex = 0; dayIndex < settings.days(); dayIndex++) {
      LocalDate date = settings.windowStart().plusDays(dayIndex);
      for (String unitCode : UNIT_CODES) {
        Unit unit = units.get(unitCode);
        Map<String, Integer> requirement = requirements.get(unitCode);
        RosterPlanner.Requirements counts =
            new RosterPlanner.Requirements(
                requirement.getOrDefault("DAY", 0),
                requirement.getOrDefault("EVENING", 0),
                requirement.getOrDefault("NIGHT", 0));
        shifts.addAll(planner.shiftsFor(date, unitCode, counts, unit.allows12h()));
      }
    }
    return shifts;
  }

  record Assignment(
      UUID id,
      String employeeNo,
      UUID employeeId,
      String unitCode,
      UUID unitId,
      String templateCode,
      UUID templateId,
      Instant start,
      Instant end,
      LocalDate workDate,
      String kind,
      String source,
      UUID overrideId,
      UUID absenceId) {}

  private List<Assignment> persistAssignments(
      DemoSettings settings,
      Map<String, Unit> units,
      Map<String, UUID> templates,
      Map<RosterPlanner.Shift, String> assigned,
      List<RosterPlanner.Shift> shifts) {
    List<Assignment> assignments = new ArrayList<>();
    for (RosterPlanner.Shift shift : shifts) {
      String employeeNo = assigned.get(shift);
      if (employeeNo == null) {
        continue;
      }
      Assignment assignment = assignment(shift, employeeNo, assignments.size(), units, templates);
      assignments.add(assignment);
    }
    List<Object[]> rows =
        assignments.stream()
            .map(
                assignment ->
                    new Object[] {
                      assignment.id(),
                      assignment.employeeId(),
                      assignment.unitId(),
                      assignment.templateId(),
                      ts(assignment.start()),
                      ts(assignment.end()),
                      assignment.workDate(),
                      assignment.kind(),
                      assignment.source()
                    })
            .toList();
    jdbc.batchUpdate(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows);
    return assignments;
  }

  /** Overtime assignments are added to the list after the roster insert; persist the new ones. */
  private void persistExtraAssignments(List<Assignment> assignments) {
    List<Object[]> rows =
        assignments.stream()
            .filter(assignment -> "EXTRA".equals(assignment.kind()))
            .map(
                assignment ->
                    new Object[] {
                      assignment.id(),
                      assignment.employeeId(),
                      assignment.unitId(),
                      assignment.templateId(),
                      ts(assignment.start()),
                      ts(assignment.end()),
                      assignment.workDate(),
                      assignment.kind(),
                      assignment.source()
                    })
            .toList();
    if (rows.isEmpty()) {
      return;
    }
    jdbc.batchUpdate(
        "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
            + " end_at, work_date, kind, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows);
  }

  private Assignment assignment(
      RosterPlanner.Shift shift,
      String employeeNo,
      int sequence,
      Map<String, Unit> units,
      Map<String, UUID> templates) {
    UUID employeeId = id("employee:" + employeeNo);
    UUID id = id(
        "assignment:" + employeeNo + ":" + shift.start() + ":" + shift.templateCode() + ":"
            + shift.sequence());
    return new Assignment(
        id,
        employeeNo,
        employeeId,
        shift.unitCode(),
        units.get(shift.unitCode()).id(),
        shift.templateCode(),
        templates.get(shift.templateCode()),
        shift.start(),
        shift.end(),
        shift.date(),
        "ROSTERED",
        "ROTATION",
        null,
        null);
  }

  // ---------------------------------------------------------------------------------------------
  // Absences: ~4% sick shifts and ~4% vacation in 3-7 day blocks (docs/10 §6.5)
  // ---------------------------------------------------------------------------------------------

  record Absence(UUID id, UUID assignmentId, String employeeNo, String type, Instant start,
      Instant end) {}

  private List<Absence> createAbsences(Random random, List<Assignment> assignments) {
    List<Absence> absences = new ArrayList<>();
    Map<String, LocalDate> vacationUntil = new HashMap<>();

    List<Assignment> ordered =
        assignments.stream().sorted(Comparator.comparing(Assignment::start)).toList();
    for (Assignment assignment : ordered) {
      LocalDate date = assignment.workDate();
      String employee = assignment.employeeNo();

      LocalDate until = vacationUntil.get(employee);
      boolean onVacation = until != null && !date.isAfter(until);
      if (!onVacation && random.nextDouble() < VACATION_RATE / 7) {
        int days = 3 + random.nextInt(5);
        vacationUntil.put(employee, date.plusDays(days - 1L));
        onVacation = true;
      }

      boolean sick = !onVacation && random.nextDouble() < SICK_RATE;
      if (onVacation || sick) {
        String type = onVacation ? "VACATION" : "SICK";
        absences.add(
            new Absence(
                id("absence:" + assignment.id()),
                assignment.id(),
                employee,
                type,
                assignment.start(),
                assignment.end()));
      }
    }
    return absences;
  }

  private void persistAbsences(List<Absence> absences) {
    jdbc.batchUpdate(
        "INSERT INTO absence (id, employee_id, shift_assignment_id, type, start_at, end_at)"
            + " VALUES (?, (SELECT id FROM employee WHERE employee_no = ?), ?, ?, ?, ?)",
        absences.stream()
            .map(
                absence ->
                    new Object[] {
                      absence.id(),
                      absence.employeeNo(),
                      absence.assignmentId(),
                      absence.type(),
                      ts(absence.start()),
                      ts(absence.end())
                    })
            .toList());
  }

  private List<Assignment> linkAbsences(List<Assignment> assignments, List<Absence> absences) {
    Map<UUID, Absence> byAssignment = new HashMap<>();
    absences.forEach(absence -> byAssignment.put(absence.assignmentId(), absence));
    List<Assignment> linked = new ArrayList<>();
    for (Assignment assignment : assignments) {
      Absence absence = byAssignment.get(assignment.id());
      linked.add(
          absence == null
              ? assignment
              : new Assignment(
                  assignment.id(),
                  assignment.employeeNo(),
                  assignment.employeeId(),
                  assignment.unitCode(),
                  assignment.unitId(),
                  assignment.templateCode(),
                  assignment.templateId(),
                  assignment.start(),
                  assignment.end(),
                  assignment.workDate(),
                  assignment.kind(),
                  assignment.source(),
                  assignment.overrideId(),
                  absence.id()));
    }
    return linked;
  }

  // ---------------------------------------------------------------------------------------------
  // Open shifts and overtime (docs/10 §6.5)
  // ---------------------------------------------------------------------------------------------

  record OpenShift(UUID id, String unitCode, UUID unitId, String templateCode, UUID templateId,
      Instant start, Instant end, LocalDate workDate, int requiredStaff, int filled) {}

  record Offer(UUID id, UUID openShiftId, String employeeNo, int rank, String status,
      Instant respondedAt) {}

  private List<OpenShift> createOpenShifts(
      DemoSettings settings,
      Map<String, Unit> units,
      Map<String, UUID> templates,
      List<Assignment> assignments,
      List<Absence> absences,
      String[] unitCodes) {
    // Hourly coverage from assignments that are not absent.
    Map<String, Integer> coverage = new HashMap<>();
    assignments.stream()
        .filter(assignment -> assignment.absenceId() == null)
        .forEach(
            assignment -> {
              long startHour = assignment.start().getEpochSecond() / 3600;
              long endHour = assignment.end().getEpochSecond() / 3600;
              for (long hour = startHour; hour < endHour; hour++) {
                String key = assignment.unitCode() + "|" + hour;
                coverage.merge(key, 1, Integer::sum);
              }
            });

    Map<String, Map<String, Integer>> requirements = loadRequirements();
    List<OpenShift> openShifts = new ArrayList<>();
    int sequence = 0;
    for (int dayIndex = 0; dayIndex < settings.days(); dayIndex++) {
      LocalDate date = settings.windowStart().plusDays(dayIndex);
      for (String unitCode : unitCodes) {
        for (String block : List.of("DAY", "EVENING", "NIGHT")) {
          int required = requirements.get(unitCode).getOrDefault(block, 0);
          String template = blockTemplate(block);
          Instant start = date.atTime(templateStart(template)).atZone(BusinessTime.REGINA).toInstant();
          int minutes = templateMinutes(template);
          int deficit = 0;
          for (int minute = 0; minute < minutes; minute += 60) {
            long hour = start.plusSeconds(minute * 60L).getEpochSecond() / 3600;
            int covered = coverage.getOrDefault(unitCode + "|" + hour, 0);
            deficit = Math.max(deficit, Math.max(0, required - covered));
          }
          for (int i = 0; i < deficit; i++) {
            sequence++;
            openShifts.add(
                new OpenShift(
                    id("open-shift:" + unitCode + ":" + date + ":" + block + ":" + i),
                    unitCode,
                    units.get(unitCode).id(),
                    template,
                    templates.get(template),
                    start,
                    start.plusSeconds(minutes * 60L),
                    date,
                    required,
                    0));
          }
        }
      }
    }
    return openShifts;
  }

  private static String blockTemplate(String block) {
    return switch (block) {
      case "DAY" -> "D8";
      case "EVENING" -> "E8";
      default -> "N8";
    };
  }

  private static LocalTime templateStart(String template) {
    return switch (template) {
      case "D8" -> LocalTime.of(7, 0);
      case "E8" -> LocalTime.of(15, 0);
      case "A12" -> LocalTime.of(0, 0);
      case "P12" -> LocalTime.of(12, 0);
      default -> LocalTime.of(23, 0);
    };
  }

  private static int templateMinutes(String template) {
    return switch (template) {
      case "A12", "P12" -> 720;
      default -> 480;
    };
  }

  private List<Offer> fillOpenShifts(
      DemoSettings settings,
      Random random,
      List<OpenShift> openShifts,
      List<Assignment> assignments,
      List<Officer> officers,
      Map<String, Unit> units) {
    Map<String, Double> overtimeHours = new HashMap<>();
    Map<String, List<Assignment>> byEmployee = new HashMap<>();
    assignments.forEach(
        assignment ->
            byEmployee.computeIfAbsent(assignment.employeeNo(), key -> new ArrayList<>())
                .add(assignment));

    List<Offer> offers = new ArrayList<>();
    for (OpenShift openShift : openShifts) {
      List<Officer> candidates =
          officers.stream()
              .filter(officer -> qualified(officer, openShift.unitCode()))
              .filter(officer -> canTake(byEmployee.get(officer.employeeNo()), openShift))
              .sorted(
                  Comparator.comparingDouble(
                          (Officer officer) -> overtimeHours.getOrDefault(officer.employeeNo(), 0.0))
                      .thenComparing(Officer::seniorityDate))
              .limit(3)
              .toList();

      int rank = 0;
      boolean filled = false;
      for (Officer candidate : candidates) {
        rank++;
        boolean accepts = random.nextDouble() < 0.6;
        offers.add(
            new Offer(
                id("offer:" + openShift.id() + ":" + candidate.employeeNo()),
                openShift.id(),
                candidate.employeeNo(),
                rank,
                accepts ? "ACCEPTED" : "DECLINED",
                accepts ? openShift.start().minusSeconds(86_400) : openShift.start()));
        if (accepts) {
          Assignment extra =
              new Assignment(
                  id("assignment:extra:" + openShift.id() + ":" + candidate.employeeNo()),
                  candidate.employeeNo(),
                  candidate.id(),
                  openShift.unitCode(),
                  openShift.unitId(),
                  openShift.templateCode(),
                  openShift.templateId(),
                  openShift.start(),
                  openShift.end(),
                  openShift.workDate(),
                  "EXTRA",
                  "OVERTIME_OFFER",
                  null,
                  null);
          assignments.add(extra);
          byEmployee.computeIfAbsent(candidate.employeeNo(), key -> new ArrayList<>()).add(extra);
          overtimeHours.merge(
              candidate.employeeNo(),
              (openShift.end().getEpochSecond() - openShift.start().getEpochSecond()) / 3600.0,
              Double::sum);
          filled = true;
          break;
        }
      }
      openShifts.set(
          openShifts.indexOf(openShift),
          new OpenShift(
              openShift.id(),
              openShift.unitCode(),
              openShift.unitId(),
              openShift.templateCode(),
              openShift.templateId(),
              openShift.start(),
              openShift.end(),
              openShift.workDate(),
              openShift.requiredStaff(),
              filled ? 1 : 0));
    }
    return offers;
  }

  private boolean qualified(Officer officer, String unitCode) {
    String required = UNIT_QUALIFICATION.get(unitCode);
    return required == null || officer.qualifications().contains(required);
  }

  private boolean canTake(List<Assignment> existing, OpenShift openShift) {
    if (existing == null) {
      return true;
    }
    for (Assignment assignment : existing) {
      long restBefore = 8 * 3600L;
      long restAfter = 8 * 3600L;
      boolean restBlocked =
          openShift.start().isBefore(assignment.end().plusSeconds(restBefore))
              && assignment.start().isBefore(openShift.end().plusSeconds(restAfter));
      if (restBlocked) {
        return false;
      }
    }
    // Employees cannot be offered a shift on a day they already work.
    if (existing.stream().anyMatch(assignment -> assignment.workDate().equals(openShift.workDate()))) {
      return false;
    }

    // Keep every rolling 168-hour window under the 60-hour ceiling (U-14 blocks above it). The rule
    // builder measures rolling windows, so a calendar week is not enough: a Monday shift can combine
    // with the previous weekend. Rostered weeks sit at 40-48 h, so one pick-up fits.
    if (maxHoursInAnyWindow(existing, openShift, 168) > 60) {
      return false;
    }

    // No more than two picked-up shifts in any 14 days, and never an eighth consecutive work day:
    // the rules warn about overtime-caused runs, but the dataset must not contain blocked runs.
    long extrasNearby =
        existing.stream()
            .filter(assignment -> "EXTRA".equals(assignment.kind()))
            .filter(
                assignment ->
                    Math.abs(
                            assignment.workDate().toEpochDay() - openShift.workDate().toEpochDay())
                        <= 7)
            .count();
    if (extrasNearby >= 2) {
      return false;
    }
    // An extra shift can bridge two rostered runs, so count the days before *and* after it.
    int run = 1;
    for (LocalDate cursor = openShift.workDate().minusDays(1);
        hasWorkDay(existing, cursor);
        cursor = cursor.minusDays(1)) {
      run++;
    }
    for (LocalDate cursor = openShift.workDate().plusDays(1);
        hasWorkDay(existing, cursor);
        cursor = cursor.plusDays(1)) {
      run++;
    }
    return run <= 7;
  }

  /** Most hours in any window of {@code windowHours} anchored at a worked start, candidate included. */
  private static double maxHoursInAnyWindow(
      List<Assignment> existing, OpenShift candidate, int windowHours) {
    List<Instant[]> intervals = new ArrayList<>();
    existing.forEach(
        assignment -> intervals.add(new Instant[] {assignment.start(), assignment.end()}));
    intervals.add(new Instant[] {candidate.start(), candidate.end()});
    return maxHoursInAnyWindow(intervals, windowHours);
  }

  private static double maxHoursInAnyWindow(List<Instant[]> intervals, int windowHours) {

    double best = 0;
    for (Instant[] anchor : intervals) {
      Instant from = anchor[0];
      Instant to = from.plusSeconds(windowHours * 3600L);
      double hours = 0;
      for (Instant[] interval : intervals) {
        Instant start = interval[0].isAfter(from) ? interval[0] : from;
        Instant end = interval[1].isBefore(to) ? interval[1] : to;
        if (end.isAfter(start)) {
          hours += (end.getEpochSecond() - start.getEpochSecond()) / 3600.0;
        }
      }
      best = Math.max(best, hours);
    }
    return best;
  }

  private static boolean hasWorkDay(List<Assignment> assignments, LocalDate date) {
    return assignments.stream().anyMatch(assignment -> assignment.workDate().equals(date));
  }

  private void persistOpenShifts(List<OpenShift> openShifts) {
    jdbc.batchUpdate(
        "INSERT INTO open_shift (id, unit_id, shift_template_id, start_at, end_at, reason, status)"
            + " VALUES (?, ?, ?, ?, ?, 'SICK_CALL', ?)",
        openShifts.stream()
            .map(
                openShift ->
                    new Object[] {
                      openShift.id(),
                      openShift.unitId(),
                      openShift.templateId(),
                      ts(openShift.start()),
                      ts(openShift.end()),
                      openShift.filled() == 1 ? "FILLED" : "OPEN"
                    })
            .toList());
  }

  private void persistOffers(List<Offer> offers) {
    jdbc.batchUpdate(
        "INSERT INTO overtime_offer (id, open_shift_id, employee_id, rank, status, offered_at,"
            + " responded_at) VALUES (?, ?, (SELECT id FROM employee WHERE employee_no = ?), ?, ?,"
            + " ?, ?)",
        offers.stream()
            .map(
                offer ->
                    new Object[] {
                      offer.id(),
                      offer.openShiftId(),
                      offer.employeeNo(),
                      offer.rank(),
                      offer.status(),
                      ts(offer.respondedAt()),
                      "OFFERED".equals(offer.status()) ? null : ts(offer.respondedAt())
                    })
            .toList());
  }

  // ---------------------------------------------------------------------------------------------
  // Actuals and pay codes
  // ---------------------------------------------------------------------------------------------

  private void persistTimeEntries(
      DemoSettings settings,
      List<PayPeriod> payPeriods,
      List<Assignment> assignments,
      List<Absence> absences,
      Instant now,
      Random random) {
    UUID ruleSetVersion = publishedRuleSetVersion();
    Map<UUID, Absence> absenceByAssignment = new HashMap<>();
    absences.forEach(absence -> absenceByAssignment.put(absence.assignmentId(), absence));

    // A worked extension must not eat the rest before the officer's next shift (U-01 blocks below
    // 8 h, and 12 h after a 16-hour shift), so the next start is looked up before extending.
    Map<String, List<Assignment>> byEmployee = new HashMap<>();
    assignments.forEach(
        assignment ->
            byEmployee.computeIfAbsent(assignment.employeeNo(), key -> new ArrayList<>())
                .add(assignment));
    Map<UUID, Instant> nextStart = new HashMap<>();
    Map<String, Double> weeklyHeadroom = new HashMap<>();
    byEmployee.forEach(
        (employee, list) -> {
          list.sort(Comparator.comparing(Assignment::start));
          for (int i = 0; i < list.size() - 1; i++) {
            nextStart.put(list.get(i).id(), list.get(i + 1).start());
          }
          List<Instant[]> intervals = new ArrayList<>();
          list.forEach(a -> intervals.add(new Instant[] {a.start(), a.end()}));
          // Extensions must not push a rolling 168 h window over the 60 h ceiling (U-14).
          weeklyHeadroom.put(employee, 60.0 - maxHoursInAnyWindow(intervals, 168));
        });

    List<Object[]> rows = new ArrayList<>();
    for (Assignment assignment : assignments) {
      if (assignment.end().isAfter(now)) {
        continue;
      }
      PayPeriod period = periodFor(payPeriods, assignment.workDate());
      if (period == null) {
        continue;
      }
      Absence absence = absenceByAssignment.get(assignment.id());
      if (absence != null) {
        double hours = durationHours(assignment.start(), assignment.end());
        rows.add(
            new Object[] {
              id("time-entry:absent:" + assignment.id()),
              assignment.employeeId(),
              period.id(),
              assignment.id(),
              assignment.workDate(),
              ts(assignment.start()),
              ts(assignment.end()),
              hours,
              "ACTUAL",
              absence.type(),
              "VACATION".equals(absence.type()) ? "VAC" : "SICK",
              ruleSetVersion
            });
        continue;
      }

      Instant start = assignment.start();
      Instant end = assignment.end();
      double roll = random.nextDouble();
      double maxExtensionHours =
          Math.min(2.0, weeklyHeadroom.getOrDefault(assignment.employeeNo(), 0.0));
      Instant candidateEnd = end.plusSeconds((int) (maxExtensionHours * 3600));
      Instant next = nextStart.get(assignment.id());
      long restNeeded = 8 * 3600L;
      boolean canExtend =
          maxExtensionHours >= 0.5
              && durationHours(start, end) + maxExtensionHours <= 16.0
              && (next == null || !candidateEnd.plusSeconds(restNeeded).isAfter(next));
      if (roll < 0.03 && canExtend) {
        int maxMinutes = (int) (maxExtensionHours * 60);
        end = end.plusSeconds((30 + random.nextInt(Math.max(1, maxMinutes - 29))) * 60L);
      } else if (roll < 0.04) {
        end = end.minusSeconds((30 + random.nextInt(31)) * 60L);
      }
      rows.add(
          new Object[] {
            id("time-entry:" + assignment.id()),
            assignment.employeeId(),
            period.id(),
            assignment.id(),
            assignment.workDate(),
            ts(start),
            ts(end),
            durationHours(start, end),
            "ACTUAL",
            null,
            null,
            ruleSetVersion
          });
    }
    jdbc.batchUpdate(
        "INSERT INTO time_entry (id, employee_id, pay_period_id, shift_assignment_id, work_date,"
            + " start_at, end_at, hours, entry_type, absence_type, pay_code, rule_set_version_id)"
            + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows);
  }

  private PayPeriod periodFor(List<PayPeriod> periods, LocalDate date) {
    return periods.stream()
        .filter(period -> !date.isBefore(period.start()) && !date.isAfter(period.end()))
        .findFirst()
        .orElse(null);
  }

  private static double durationHours(Instant start, Instant end) {
    return (end.getEpochSecond() - start.getEpochSecond()) / 3600.0;
  }

  private void assignPayCodes(List<PayPeriod> payPeriods) {
    PayClassifier classifier = new PayClassifier();
    PayPolicy policy = classifier.policyFrom(RuleRowsV1.ruleSet());

    for (PayPeriod period : payPeriods) {
      List<Map<String, Object>> entries =
          jdbc.queryForList(
              "SELECT id, employee_id, hours FROM time_entry WHERE pay_period_id = ?"
                  + " AND absence_type IS NULL ORDER BY employee_id, start_at",
              period.id());

      Map<UUID, Double> totals = new java.util.LinkedHashMap<>();
      for (Map<String, Object> entry : entries) {
        totals.merge(
            (UUID) entry.get("employee_id"),
            ((Number) entry.get("hours")).doubleValue(),
            Double::sum);
      }

      Map<UUID, Double> consumed = new java.util.HashMap<>();
      for (Map<String, Object> entry : entries) {
        UUID employee = (UUID) entry.get("employee_id");
        double hours = ((Number) entry.get("hours")).doubleValue();
        PayClassification classification =
            classifier.classify(totals.getOrDefault(employee, 0.0), policy);

        double before = consumed.getOrDefault(employee, 0.0);
        double regularPart = Math.max(0, Math.min(hours, policy.thresholdHours() - before));
        consumed.put(employee, before + hours);

        // P-04: a period whose overtime is under 30 minutes is paid as regular time; the classifier
        // owns that decision, not this loop (review R3).
        String code = classification.overtimeHours() > 0 && regularPart < hours ? "OT15" : "REG";
        jdbc.update("UPDATE time_entry SET pay_code = ? WHERE id = ?", code, entry.get("id"));
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Overrides, locks, audit
  // ---------------------------------------------------------------------------------------------

  private void lockPastPayPeriods(DemoSettings settings, List<PayPeriod> payPeriods) {
    for (PayPeriod period : payPeriods) {
      if (period.locked()) {
        jdbc.update(
            "UPDATE pay_period SET status = 'LOCKED', locked_at = now(),"
                + " locked_by = (SELECT id FROM app_user WHERE username = 'm.ellis') WHERE id = ?",
            period.id());
      }
    }
  }

  private void persistAuditEvents(DemoSettings settings) {
    jdbc.update(
        "INSERT INTO audit_event (action, entity_type, after) VALUES ('generate_demo_dataset',"
            + " 'demo', jsonb_build_object('seed', ?, 'today', ?))",
        String.valueOf(settings.seed()),
        settings.today().toString());
  }

  // ---------------------------------------------------------------------------------------------
  // Checksum and helpers
  // ---------------------------------------------------------------------------------------------

  /** JDBC needs a Timestamp for timestamptz; Instant is not inferred by the PostgreSQL driver. */
  private static java.sql.Timestamp ts(Instant instant) {
    return java.sql.Timestamp.from(instant);
  }

  /** Deterministic identifier, so the same seed produces the same IDs as well as the same rows. */
  static UUID id(String key) {
    return UUID.nameUUIDFromBytes(("shiftcircle:" + key).getBytes(StandardCharsets.UTF_8));
  }
}
