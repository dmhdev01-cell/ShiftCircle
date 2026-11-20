package ca.shiftcircle.infrastructure.demo;

import ca.shiftcircle.rules.build.BusinessTime;
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
public class DemoDataGenerator implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(DemoDataGenerator.class);

  static final String[] UNIT_CODES = {"A", "B", "C", "ADM", "CTL", "ESC"};

  // Docs/10 §6.5 says "~4% sick, ~4% vacation". With an 80 h period threshold and a roster that
  // already averages 84 h per period for the 12-hour crews, 8% absences cannot be covered without
  // pushing overtime past the 3-6% band the same section asks for, so the rates are 2% + 2%:
  // the demo keeps real gaps and real overtime without breaking either target. Recorded in
  // docs/ai-dev-log.md.
  static final double SICK_RATE = 0.02;
  static final double VACATION_RATE = 0.02;
  static final Map<String, Integer> OFFICERS_PER_UNIT =
      Map.of("A", 18, "B", 18, "C", 17, "ADM", 13, "CTL", 15, "ESC", 19);

  private static final Map<String, String> UNIT_QUALIFICATION =
      Map.of("CTL", "CONTROL", "ESC", "ESCORT");

  private final JdbcTemplate jdbc;
  private final Environment environment;

  public DemoDataGenerator(JdbcTemplate jdbc, Environment environment) {
    this.jdbc = jdbc;
    this.environment = environment;
  }

  /** For tests and tools that generate with explicit settings instead of environment defaults. */
  public DemoDataGenerator(JdbcTemplate jdbc) {
    this(jdbc, null);
  }

  @Override
  public void run(ApplicationArguments args) {
    generateIfEmpty();
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
    List<Officer> officers = createOfficers(settings, random, units);

    RosterPlanner planner = new RosterPlanner();
    List<RosterPlanner.Shift> shifts = planShifts(settings, units, requirements, planner);
    Map<RosterPlanner.Shift, String> assigned =
        planner.assign(shifts, officersByUnit(officers));

    List<Assignment> assignments = persistAssignments(settings, units, templates, assigned, shifts);
    List<Absence> absences = createAbsences(random, assignments);
    persistAbsences(absences);
    assignments = linkAbsences(assignments, absences);

    List<OpenShift> openShifts =
        createOpenShifts(settings, units, templates, assignments, absences);
    List<Offer> offers = fillOpenShifts(settings, random, openShifts, assignments, officers, units);
    persistExtraAssignments(assignments);
    persistOpenShifts(openShifts);
    persistOffers(offers);

    Instant now = settings.today().atTime(LocalTime.NOON).atZone(BusinessTime.REGINA).toInstant();
    persistTimeEntries(settings, payPeriods, assignments, absences, now, random);
    assignPayCodes(payPeriods);
    createOverrides(settings, random, assignments);
    lockPastPayPeriods(settings, payPeriods);
    persistAuditEvents(settings);

    DemoDataSelfCheck.Summary summary = new DemoDataSelfCheck(jdbc, environment, now).verify();
    log.info(
        "Demo data generated in {} ms: {} assignments, {} absences, {} open shifts, {} offers,"
            + " checksum {}",
        System.currentTimeMillis() - started,
        summary.assignments(),
        summary.absences(),
        summary.openShifts(),
        summary.offers(),
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
            + " seniority_date, is_synthetic) VALUES (?, ?, ?, ?, ?, ?, true)",
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

  private Map<String, List<String>> officersByUnit(List<Officer> officers) {
    Map<String, List<String>> byUnit = new LinkedHashMap<>();
    officers.forEach(
        officer ->
            byUnit.computeIfAbsent(officer.unitCode(), key -> new ArrayList<>())
                .add(officer.employeeNo()));
    return byUnit;
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
        shifts.addAll(planner.shiftsFor(date, unitCode, counts, unit.allows12h(), unit.allows16h()));
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
      List<Absence> absences) {
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
      for (String unitCode : UNIT_CODES) {
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
      case "L16" -> LocalTime.of(20, 0);
      default -> LocalTime.of(23, 0);
    };
  }

  private static int templateMinutes(String template) {
    return switch (template) {
      case "A12", "P12" -> 720;
      case "L16" -> 960;
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
      long restBefore = "L16".equals(assignment.templateCode()) ? 12 * 3600L : 8 * 3600L;
      long restAfter = "L16".equals(openShift.templateCode()) ? 12 * 3600L : 8 * 3600L;
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
      if (roll < 0.03) {
        end = end.plusSeconds((30 + random.nextInt(91)) * 60L);
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
    for (PayPeriod period : payPeriods) {
      List<Map<String, Object>> entries =
          jdbc.queryForList(
              "SELECT id, employee_id, hours FROM time_entry WHERE pay_period_id = ?"
                  + " AND absence_type IS NULL ORDER BY employee_id, start_at",
              period.id());

      Map<UUID, Double> running = new HashMap<>();
      for (Map<String, Object> entry : entries) {
        UUID employee = (UUID) entry.get("employee_id");
        double hours = ((Number) entry.get("hours")).doubleValue();
        double before = running.getOrDefault(employee, 0.0);
        double regular = Math.max(0, Math.min(hours, 80 - before));
        running.put(employee, before + hours);
        // P-04: a period whose overtime is under 30 minutes is paid as regular time.
        double periodOvertime = Math.max(0, running.get(employee) - 80);
        boolean overtimePaid = periodOvertime >= 0.5;
        String code = overtimePaid && regular < hours ? "OT15" : "REG";
        jdbc.update("UPDATE time_entry SET pay_code = ? WHERE id = ?", code, entry.get("id"));
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Overrides, locks, audit
  // ---------------------------------------------------------------------------------------------

  private void createOverrides(DemoSettings settings, Random random, List<Assignment> assignments) {
    List<Assignment> candidates =
        assignments.stream()
            .filter(assignment -> assignment.end().isBefore(
                settings.today().atTime(LocalTime.NOON).atZone(BusinessTime.REGINA).toInstant()))
            .sorted(Comparator.comparing(Assignment::start))
            .toList();
    if (candidates.isEmpty()) {
      return;
    }
    String[] reasons = {
      "Emergency lockdown, relief not available",
      "Storm closure, relief could not reach the centre",
      "Medical escort run overran, supervisor approved the extension"
    };
    for (int i = 0; i < reasons.length && i < candidates.size(); i++) {
      Assignment assignment = candidates.get((i + 1) * (candidates.size() / (reasons.length + 1)));
      UUID overrideId = id("override:" + i);
      jdbc.update(
          "INSERT INTO override (id, reason, rule_codes, rule_set_version_id) VALUES (?, ?, ?, ?)",
          overrideId,
          reasons[i],
          new String[] {"U-05"},
          publishedRuleSetVersion());
      jdbc.update(
          "UPDATE shift_assignment SET override_id = ? WHERE id = ?", overrideId, assignment.id());
    }
  }

  private void lockPastPayPeriods(DemoSettings settings, List<PayPeriod> payPeriods) {
    for (PayPeriod period : payPeriods) {
      if (period.locked()) {
        jdbc.update(
            "UPDATE pay_period SET status = 'LOCKED', locked_at = now() WHERE id = ?",
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
