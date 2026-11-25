package ca.shiftcircle.api.planner;

import ca.shiftcircle.api.coverage.CoverageCalculator;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.build.ShiftKind;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The quarter-plan generator (ADR-026): a deterministic constructive heuristic over the next quarter.
 *
 * <p>It proposes, it does not decide: every assignment is handed to a {@link Verifier} that runs the
 * same rule check as the planning board, against the draft's own assignments plus the committed
 * history before the window. A proposal a rule blocks is skipped and the hour stays a visible gap.
 * No Spring, no JDBC, no clock — the same input always produces the same plan.
 */
public final class PlanGenerator {

  public static final LocalDate FROM = LocalDate.of(2027, 1, 4);
  public static final LocalDate TO = LocalDate.of(2027, 4, 11);

  /** Committed shifts this many days before FROM are the history every proposal is checked against. */
  public static final int HISTORY_DAYS = 35;
  public static final int PERIODS = 7;

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final List<String> BLOCKS = List.of("NIGHT", "DAY", "EVENING");

  public record Pref(Integer shiftLength, List<String> timesOfDay, List<String> daysOff) {}

  public record Employee(
      UUID id,
      String employeeNo,
      String name,
      UUID unitId,
      String unitCode,
      LocalDate seniority,
      double fte,
      Pref pref,
      int effectiveLength,
      int phase,
      String crew,
      String pattern) {

    /** Existing callers and the 100 seed: no crew row, so the planner uses the old patterns. */
    public Employee(
        UUID id,
        String employeeNo,
        String name,
        UUID unitId,
        String unitCode,
        LocalDate seniority,
        double fte,
        Pref pref,
        int effectiveLength,
        int phase) {
      this(id, employeeNo, name, unitId, unitCode, seniority, fte, pref, effectiveLength, phase,
          null, null);
    }

    /** A crew officer with no explicit pattern; 8 h falls back to the rotating default. */
    public Employee(
        UUID id,
        String employeeNo,
        String name,
        UUID unitId,
        String unitCode,
        LocalDate seniority,
        double fte,
        Pref pref,
        int effectiveLength,
        int phase,
        String crew) {
      this(id, employeeNo, name, unitId, unitCode, seniority, fte, pref, effectiveLength, phase,
          crew, null);
    }
  }

  public record Unit(
      UUID id,
      String code,
      String name,
      boolean allows12h,
      boolean allows16h,
      Map<String, Integer> required) {}

  public record Template(UUID id, String code, LocalTime start, int minutes) {}

  public record Assignment(
      UUID employeeId,
      String employeeName,
      UUID unitId,
      String unitCode,
      UUID templateId,
      String templateCode,
      LocalDate date,
      Instant start,
      Instant end,
      ShiftKind kind,
      List<RuleWarning> warnings) {}

  public record RuleWarning(String ruleCode, String message) {}

  public record Gap(
      UUID unitId, String unitCode, LocalDate date, String block, int required, int placed,
      String reason) {}

  public record Warning(
      String ruleCode,
      String ruleName,
      String message,
      String unitCode,
      String employeeName,
      LocalDate date,
      String shift) {}

  public record Result(
      List<Assignment> assignments,
      List<Gap> gaps,
      List<Warning> warnings,
      Map<String, Object> scorecard) {}

  /** True when the rule check blocks the proposal; warnings are kept, never hidden. */
  public record Check(boolean blocked, List<RuleWarning> warnings) {}

  @FunctionalInterface
  public interface Verifier {
    Check check(
        Employee employee,
        Unit unit,
        Template template,
        Instant start,
        List<ShiftFact> currentFacts);
  }

  /** The one active-units answer the generator uses; the default keeps every unit open. */
  @FunctionalInterface
  public interface Availability {
    boolean active(UUID unitId, LocalDate date);
  }

  public static final Availability ALWAYS = (unitId, date) -> true;

  /**
   * The planner's tailoring options (PR-N). {@link #DEFAULT} is today's generator exactly: the
   * same input gives the same plan, byte for byte.
   *
   * @param includePartTime officers below 1.0 FTE (the part-time and casual pool) may be placed
   * @param fillPartTimeToFte after the gaps are filled, top each part-time officer up towards
   *     their FTE target in their home unit, where cover is thinnest
   * @param crossUnitFill after the home-unit fills, cover each remaining gap with an officer from
   *     another unit who holds the gap's qualification and has hours left under FTE x 80 h
   */
  public record Options(boolean includePartTime, boolean fillPartTimeToFte, boolean crossUnitFill) {
    public static final Options DEFAULT = new Options(true, false, false);
  }

  /**
   * Who holds which qualification, and which qualification a unit's block asks for (only blocks
   * with a qualified minimum). Read by the cross-unit fill only: an officer from another unit is
   * offered a gap only if they hold the block's qualification, when it has one.
   */
  public record Qualifications(
      Map<UUID, Map<String, UUID>> requiredByUnitBlock, Map<UUID, Set<UUID>> held) {
    public static final Qualifications NONE = new Qualifications(Map.of(), Map.of());

    boolean allows(Employee employee, UUID unitId, String block) {
      UUID required = requiredByUnitBlock.getOrDefault(unitId, Map.of()).get(block);
      return required == null || held.getOrDefault(employee.id(), Set.of()).contains(required);
    }
  }

  public Result generate(
      List<Employee> employees,
      List<Unit> units,
      Map<String, Template> templates,
      Map<UUID, List<ShiftFact>> history,
      String pattern8h,
      long seed,
      Verifier verifier) {
    return generate(employees, units, templates, history, pattern8h, seed, verifier, Map.of());
  }

  /**
   * The overload with planned leave: an employee in {@code leave} on a date is not placed that
   * day. This is a read-only input, not leave management; everything else is unchanged.
   */
  public Result generate(
      List<Employee> employees,
      List<Unit> units,
      Map<String, Template> templates,
      Map<UUID, List<ShiftFact>> history,
      String pattern8h,
      long seed,
      Verifier verifier,
      Map<UUID, Set<LocalDate>> leave) {
    return generate(
        employees, units, templates, history, pattern8h, seed, verifier, leave, ALWAYS);
  }

  /**
   * Re-score an existing draft after a hand edit (release 7). It never generates or moves a shift:
   * the caller supplies the edited assignment list. Warnings, gaps and the scorecard are rebuilt
   * with the same helpers the generator uses, so an edit cannot invent a second scoring path.
   */
  public Result assess(
      List<Employee> employees,
      List<Unit> units,
      Map<String, Template> templates,
      Map<UUID, List<ShiftFact>> history,
      String pattern8h,
      Verifier verifier,
      Map<UUID, Set<LocalDate>> leave,
      Availability availability,
      List<Assignment> assignments) {
    long started = System.nanoTime();
    Map<UUID, Employee> employeesById =
        employees.stream().collect(Collectors.toMap(Employee::id, e -> e));
    Map<UUID, Unit> unitsById = units.stream().collect(Collectors.toMap(Unit::id, u -> u));
    Map<UUID, Template> templatesById =
        templates.values().stream().collect(Collectors.toMap(Template::id, t -> t));

    Map<UUID, List<ShiftFact>> facts = new HashMap<>();
    history.forEach((employee, shifts) -> facts.put(employee, new ArrayList<>(shifts)));
    Map<UUID, List<Assignment>> byEmployee = new HashMap<>();
    List<Assignment> ordered =
        assignments.stream()
            .sorted(Comparator.comparing(Assignment::start).thenComparing(Assignment::employeeId))
            .toList();
    List<Warning> warnings = new ArrayList<>();
    Set<String> warningKeys = new LinkedHashSet<>();
    for (Assignment assignment : ordered) {
      byEmployee.computeIfAbsent(assignment.employeeId(), key -> new ArrayList<>()).add(assignment);
      Employee employee = employeesById.get(assignment.employeeId());
      Unit unit = unitsById.get(assignment.unitId());
      Template template = templatesById.get(assignment.templateId());
      if (employee == null || unit == null || template == null) {
        continue;
      }
      List<ShiftFact> current =
          facts.computeIfAbsent(assignment.employeeId(), key -> new ArrayList<>());
      Check check = verifier.check(employee, unit, template, assignment.start(), current);
      for (RuleWarning warning : check.warnings()) {
        addWarning(
            warnings,
            warningKeys,
            employee.id().toString(),
            warning,
            unit.code(),
            employee.name(),
            assignment.date(),
            template.code());
      }
      current.add(
          new ShiftFact(
              assignment.employeeId() + ":" + assignment.start(),
              employee.employeeNo(),
              unit.code(),
              template.code(),
              assignment.start(),
              assignment.end(),
              assignment.kind(),
              0,
              unit.allows12h(),
              unit.allows16h()));
    }
    List<Gap> gaps = recomputeGaps(units, assignments, availability);
    Map<UUID, List<Employee>> baseStaff = new HashMap<>();
    employees.forEach(
        employee ->
            baseStaff.computeIfAbsent(employee.unitId(), key -> new ArrayList<>()).add(employee));
    baseStaff.values().forEach(list -> list.sort(Comparator.comparing(Employee::seniority)));
    Map<String, Object> scorecard =
        scorecard(
            employees,
            units,
            assignments,
            byEmployee,
            gaps,
            warnings,
            pattern8h,
            started,
            facts,
            templates,
            verifier,
            assignBlocks(units, baseStaff),
            leave,
            availability);
    return new Result(assignments, gaps, warnings, scorecard);
  }

  /**
   * The date-aware overload: a unit closed on a day is skipped for that day (no requirement, no
   * roster, no gaps). With no closures the answer is always true, so the 100/120 plans are
   * unchanged.
   */
  public Result generate(
      List<Employee> employees,
      List<Unit> units,
      Map<String, Template> templates,
      Map<UUID, List<ShiftFact>> history,
      String pattern8h,
      long seed,
      Verifier verifier,
      Map<UUID, Set<LocalDate>> leave,
      Availability availability) {
    return generate(
        employees, units, templates, history, pattern8h, seed, verifier, leave, availability,
        Options.DEFAULT);
  }

  /**
   * The overload with tailoring options. Placement uses the options; the scorecard always counts
   * every officer, so a draft made with an option shows its effect (an excluded part-timer reads
   * as unused capacity on the FTE bands).
   */
  public Result generate(
      List<Employee> employees,
      List<Unit> units,
      Map<String, Template> templates,
      Map<UUID, List<ShiftFact>> history,
      String pattern8h,
      long seed,
      Verifier verifier,
      Map<UUID, Set<LocalDate>> leave,
      Availability availability,
      Options options) {
    return generate(employees, units, templates, history, pattern8h, seed, verifier, leave,
        availability, options, Qualifications.NONE);
  }

  /** The overload with the qualifications the cross-unit fill checks. */
  public Result generate(
      List<Employee> employees,
      List<Unit> units,
      Map<String, Template> templates,
      Map<UUID, List<ShiftFact>> history,
      String pattern8h,
      long seed,
      Verifier verifier,
      Map<UUID, Set<LocalDate>> leave,
      Availability availability,
      Options options,
      Qualifications qualifications) {
    long started = System.nanoTime();
    List<Employee> pool =
        options.includePartTime()
            ? employees
            : employees.stream().filter(employee -> employee.fte() >= 1.0).toList();
    Map<UUID, List<ShiftFact>> facts = new HashMap<>();
    history.forEach((employee, shifts) -> facts.put(employee, new ArrayList<>(shifts)));
    Map<UUID, List<Assignment>> byEmployee = new HashMap<>();
    List<Assignment> assignments = new ArrayList<>();
    List<Warning> warnings = new ArrayList<>();
    Set<String> warningKeys = new LinkedHashSet<>();
    List<Gap> gaps = new ArrayList<>();

    Map<UUID, List<Employee>> baseStaff = new HashMap<>();
    employees.forEach(employee -> baseStaff.computeIfAbsent(employee.unitId(), k -> new ArrayList<>()).add(employee));
    baseStaff.values().forEach(list -> list.sort(Comparator.comparing(Employee::seniority)));
    Map<UUID, String> blockOf = assignBlocks(units, baseStaff);
    // Allocation improvement: stagger phases inside each unit's block group, not across the whole
    // unit, so a day group always works the same number of days on each weekday. With option C the
    // group is the pattern cohort, so a fixed and a rotating officer do not share a phase counter.
    List<Employee> rephased = rephase(employees, blockOf, pattern8h);
    Map<UUID, List<Employee>> staff = new HashMap<>();
    rephased.forEach(employee -> staff.computeIfAbsent(employee.unitId(), k -> new ArrayList<>()).add(employee));
    staff.values().forEach(list -> list.sort(Comparator.comparing(Employee::seniority)));

    for (LocalDate date = FROM; !date.isAfter(TO); date = date.plusDays(1)) {
      for (Unit unit : units) {
        if (!availability.active(unit.id(), date)) {
          continue;
        }
        int[] hours = new int[24];
        Set<UUID> assignedToday = new LinkedHashSet<>();
        for (String block : BLOCKS) {
          int required = unit.required().getOrDefault(block, 0);
          if (required <= 0) {
            continue;
          }
          int guard = 0;
          while (deficit(hours, block, required) > 0 && guard++ < 200) {
            Template template = null;
            Employee chosen = null;
            Check chosenCheck = null;
            for (Employee candidate :
                orderedCandidates(
                    staff.getOrDefault(unit.id(), List.of()), unit, block, date, assignedToday,
                    pattern8h, blockOf, leave)) {
              Template candidateTemplate = templateFor(candidate, unit, block, templates);
              if (candidateTemplate == null || !covers(candidateTemplate, block)) {
                continue;
              }
              Instant start = date.atTime(candidateTemplate.start()).atZone(REGINA).toInstant();
              Check check =
                  verifier.check(
                      candidate,
                      unit,
                      candidateTemplate,
                      start,
                      facts.getOrDefault(candidate.id(), List.of()));
              if (!check.blocked()) {
                template = candidateTemplate;
                chosen = candidate;
                chosenCheck = check;
                break;
              }
            }
            if (chosen == null) {
              break;
            }
            Instant start = date.atTime(template.start()).atZone(REGINA).toInstant();
            Instant end = start.plus(Duration.ofMinutes(template.minutes()));
            addHours(hours, template.start().getHour(), template.minutes());
            assignedToday.add(chosen.id());
            List<RuleWarning> checkedWarnings =
                chosenCheck == null ? List.of() : chosenCheck.warnings();
            Assignment assignment =
                new Assignment(
                    chosen.id(), chosen.name(), unit.id(), unit.code(), template.id(),
                    template.code(), date, start, end, ShiftKind.ROSTERED, checkedWarnings);
            assignments.add(assignment);
            byEmployee.computeIfAbsent(chosen.id(), k -> new ArrayList<>()).add(assignment);
            facts
                .computeIfAbsent(chosen.id(), k -> new ArrayList<>())
                .add(
                    new ShiftFact(
                        "plan:" + assignment.date() + ":" + template.code(),
                        chosen.employeeNo(),
                        unit.code(),
                        template.code(),
                        start,
                        end,
                        ShiftKind.ROSTERED,
                        0,
                        true,
                        true));
            for (RuleWarning result : checkedWarnings) {
              addWarning(warnings, warningKeys, chosen.id().toString(), result, unit.code(),
                  chosen.name(), date, template.code());
            }
          }
        }
        // Everyone whose pattern says they work today is planned, even where the unit is already
        // covered: the default 5/2 officer then works exactly 80 h per period instead of losing
        // shifts to a surplus. A Block rule still skips the day (and the scorecard shows it).
        for (Employee employee : staff.getOrDefault(unit.id(), List.of())) {
          if (employee.fte() < 1.0
              || assignedToday.contains(employee.id())
              || onLeave(employee.id(), date, leave)
              || !works(employee, date, pattern8h)) {
            continue;
          }
          String crew = crewOf(employee);
          String preferredBlock =
              crew != null
                  ? switch (crew) {
                    case "N12" -> "NIGHT";
                    case "D12", "D8" -> "DAY";
                    case "E8" -> "EVENING";
                    default -> "DAY";
                  }
                  : effectiveLength(employee) == 8
                      ? blockOf.getOrDefault(employee.id(), "DAY")
                      : preferenceBlock(employee.pref());
          Template template = templateFor(employee, unit, preferredBlock, templates);
          if (template == null || !covers(template, preferredBlock)) {
            continue;
          }
          Instant start = date.atTime(template.start()).atZone(REGINA).toInstant();
          Check check =
              verifier.check(
                  employee, unit, template, start, facts.getOrDefault(employee.id(), List.of()));
          if (check.blocked()) {
            continue;
          }
          Instant end = start.plus(Duration.ofMinutes(template.minutes()));
          addHours(hours, template.start().getHour(), template.minutes());
          assignedToday.add(employee.id());
          Assignment assignment =
              new Assignment(
                  employee.id(), employee.name(), unit.id(), unit.code(), template.id(),
                  template.code(), date, start, end, ShiftKind.ROSTERED, check.warnings());
          assignments.add(assignment);
          byEmployee.computeIfAbsent(employee.id(), key -> new ArrayList<>()).add(assignment);
          facts
              .computeIfAbsent(employee.id(), key -> new ArrayList<>())
              .add(
                  new ShiftFact(
                      "plan:" + date + ":" + template.code(),
                      employee.employeeNo(),
                      unit.code(),
                      template.code(),
                      start,
                      end,
                      ShiftKind.ROSTERED,
                      0,
                      true,
                      true));
          for (RuleWarning warning : check.warnings()) {
            addWarning(warnings, warningKeys, employee.id().toString(), warning, unit.code(),
                employee.name(), date, template.code());
          }
        }
        for (String block : BLOCKS) {
          int required = unit.required().getOrDefault(block, 0);
          if (required <= 0) {
            continue;
          }
          int placed = minimumCoverage(hours, block);
          if (placed < required) {
            gaps.add(
                new Gap(
                    unit.id(),
                    unit.code(),
                    date,
                    block,
                    required,
                    placed,
                    "No eligible officer left without a Block rule; a supervisor fills this"));
          }
        }
      }
    }

    casualPool(units, staff, blockOf, assignments, byEmployee, facts, warnings, templates,
        verifier, pool, leave, availability);
    reliefPool(units, staff, assignments, byEmployee, facts, warnings, templates, verifier,
        employees, leave, availability, pattern8h);
    Map<String, Object> crossUnit = null;
    if (options.crossUnitFill()) {
      // Gaps before the extras: cover what is short in other units first.
      crossUnit =
          crossUnitFill(units, assignments, byEmployee, facts, warnings, templates, verifier, pool,
              leave, availability, qualifications);
    }
    if (options.fillPartTimeToFte() && options.includePartTime()) {
      topUpPartTime(units, assignments, byEmployee, facts, warnings, templates, verifier,
          employees, leave, availability);
    }
    gaps = recomputeGaps(units, assignments, availability);
    Map<String, Object> scorecard =
        scorecard(
            employees, units, assignments, byEmployee, gaps, warnings, pattern8h, started, facts,
            templates, verifier, blockOf, leave, availability);
    if (crossUnit != null) {
      scorecard.put("crossUnit", crossUnit);
    }
    return new Result(assignments, gaps, warnings, scorecard);
  }

  /**
   * The night group per unit: volunteers first (most senior first), then the newest officers until
   * the unit's night requirement, scaled for a 5/2 week, is covered. The group keeps nights all
   * quarter, so a night shift never destroys the next day's pattern and the 80 h property holds.
   */
  /**
   * One block per 8 h officer for the quarter. Nights are volunteers senior-first, then newest-first,
   * at the size the unit needs; the rest fill day and evening by preference, then need. Keeping the
   * block fixed is what keeps the next day's rest at 16 h: the amendment allows a kind change only
   * across off days, and the deficit fill no longer switches it.
   */
  private static Map<UUID, String> assignBlocks(
      List<Unit> units, Map<UUID, List<Employee>> staff) {
    Map<UUID, String> blocks = new HashMap<>();
    for (Unit unit : units) {
      List<Employee> candidates = new ArrayList<>(staff.getOrDefault(unit.id(), List.of()));
      candidates.removeIf(employee -> effectiveLength(employee) != 8 || employee.fte() < 1.0);
      // Only 12-hour officers work nights (person, 2026-11-21): an 8-hour officer is
      // assigned to DAY or EVENING and never has an N8 shift. An 8 h NIGHT preference stays
      // stored and is shown unmet with that plain reason.
      // Fixed 8 h crews keep their block; the flexible remainder fills the day need.
      int fixedDay = 0;
      for (Employee employee : candidates) {
        String crew = crewOf(employee);
        if ("D8".equals(crew)) {
          blocks.put(employee.id(), "DAY");
          fixedDay++;
        } else if ("E8".equals(crew)) {
          blocks.put(employee.id(), "EVENING");
        }
      }
      List<Employee> rest = new ArrayList<>();
      candidates.stream().filter(employee -> !blocks.containsKey(employee.id())).forEach(rest::add);
      int dayNeed = Math.max(
          0, (int) Math.ceil(unit.required().getOrDefault("DAY", 0) * 7.0 / 5.0) - fixedDay);
      int dayCount = 0;
      // Preference first: DAY then EVENING; seniority breaks the tie.
      rest.sort(
          (a, b) -> {
            int rankA = PreferenceTimes.rank(a.pref().timesOfDay());
            int rankB = PreferenceTimes.rank(b.pref().timesOfDay());
            return rankA != rankB ? Integer.compare(rankA, rankB) : a.seniority().compareTo(b.seniority());
          });
      for (Employee employee : rest) {
        if (dayCount < dayNeed) {
          blocks.put(employee.id(), "DAY");
          dayCount++;
        } else {
          blocks.put(employee.id(), "EVENING");
        }
      }
    }
    return blocks;
  }

  private static List<Employee> orderedCandidates(
      List<Employee> employees,
      Unit unit,
      String block,
      LocalDate date,
      Set<UUID> assignedToday,
      String pattern8h,
      Map<UUID, String> blockOf,
      Map<UUID, Set<LocalDate>> leave) {
    List<Employee> candidates = new ArrayList<>();
    for (Employee employee : employees) {
      if (employee.fte() < 1.0
          || assignedToday.contains(employee.id())
          || onLeave(employee.id(), date, leave)
          || !works(employee, date, pattern8h)) {
        continue;
      }
      String crew = crewOf(employee);
      if (crew != null) {
        if (!crewCovers(crew, block)) {
          continue;
        }
      } else if (effectiveLength(employee) == 8
          && !block.equals(blockOf.getOrDefault(employee.id(), "DAY"))) {
        continue;
      }
      candidates.add(employee);
    }
    Comparator<Employee> order;
    if ("NIGHT".equals(block)) {
      order =
          (a, b) -> {
            boolean volunteerA = PreferenceTimes.nightVolunteer(a.pref().timesOfDay());
            boolean volunteerB = PreferenceTimes.nightVolunteer(b.pref().timesOfDay());
            if (volunteerA != volunteerB) {
              return volunteerA ? -1 : 1;
            }
            // Volunteers: most senior first. Everyone else: newest first (amendment 4).
            return volunteerA
                ? a.seniority().compareTo(b.seniority())
                : b.seniority().compareTo(a.seniority());
          };
    } else {
      order =
          (a, b) -> {
            boolean matchA = block.equals(preferenceBlock(a.pref()));
            boolean matchB = block.equals(preferenceBlock(b.pref()));
            if (matchA != matchB) {
              return matchA ? -1 : 1;
            }
            return a.seniority().compareTo(b.seniority());
          };
    }
    candidates.sort(order);
    return candidates;
  }

  static boolean works(Employee employee, LocalDate date, String pattern8h) {
    long day = ChronoUnit.DAYS.between(FROM, date);
    int phase = employee.phase();
    int length = effectiveLength(employee);
    if (length == 16) {
      return Math.floorMod(day + phase, 3) == 0;
    }
    if (length == 12) {
      return Math.floorMod(day + phase, 8) < 4;
    }
    String pattern = patternOf(employee, pattern8h);
    if ("7_ON_3_OFF".equals(pattern)) {
      return Math.floorMod(day + phase, 10) < 7;
    }
    int period = (int) (day / 14);
    int dayInPeriod = (int) (day % 14);
    if ("ROTATING_5_2".equals(pattern)) {
      int pair = Math.floorMod(phase - period, 7);
      if (pair == 6) {
        // The wrap takes a 3-day break (Mon-Wed) plus Mon-Tue in the second week, so the
        // Sun-Mon state is never used: 9 work days, 72 h in this period, and no U-12/U-14 at
        // the changeover. Hours are balanced over the quarter, not per period.
        return dayInPeriod != 0 && dayInPeriod != 1 && dayInPeriod != 2
            && dayInPeriod != 7 && dayInPeriod != 8;
      }
      int weekDay = date.getDayOfWeek().getValue() - 1;
      return weekDay != pair && weekDay != (pair + 1) % 7;
    }
    int pairStart = Math.floorMod(phase, 7);
    int weekDay = date.getDayOfWeek().getValue() - 1;
    return weekDay != pairStart && weekDay != (pairStart + 1) % 7;
  }

  /** The 8 h pattern in force: a one-release override wins, then the officer's own setting. */
  static String patternOf(Employee employee, String pattern8h) {
    int length = effectiveLength(employee);
    if (length == 12 || length == 16) {
      return "4_ON_4_OFF";
    }
    if (pattern8h != null) {
      return pattern8h;
    }
    String pattern = employee.pattern();
    return pattern == null
            || !("ROTATING_5_2".equals(pattern)
                || "5_ON_2_OFF".equals(pattern)
                || "7_ON_3_OFF".equals(pattern))
        ? "ROTATING_5_2"
        : pattern;
  }

  /** Every officer's pattern in the words the planner screens use (never a raw code). */
  static String patternWords(String pattern) {
    return switch (pattern) {
      case "5_ON_2_OFF" -> "Fixed 5 on, 2 off";
      case "7_ON_3_OFF" -> "7 on, 3 off";
      case "4_ON_4_OFF" -> "4 on, 4 off";
      default -> "Rotating 5 on, 2 off (weekends rotate)";
    };
  }

  private static int effectiveLength(Employee employee) {
    return employee.effectiveLength();
  }

  /** The crew code from rotation_pattern, normalised to D12/N12/D8/E8, or null. */
  private static String crewOf(Employee employee) {
    String code = employee.crew();
    if (code == null) {
      return null;
    }
    if (code.startsWith("N12") || code.startsWith("CASUAL_12")) {
      return "N12";
    }
    if (code.startsWith("D12")) {
      return "D12";
    }
    if (code.startsWith("D8")) {
      return "D8";
    }
    if (code.startsWith("E8")) {
      return "E8";
    }
    return null;
  }

  private static boolean crewCovers(String crew, String block) {
    return switch (crew) {
      case "N12" -> "NIGHT".equals(block) || "EVENING".equals(block);
      case "D12" -> "DAY".equals(block) || "EVENING".equals(block);
      case "D8" -> "DAY".equals(block);
      case "E8" -> "EVENING".equals(block);
      default -> true;
    };
  }

  private static Template templateFor(
      Employee employee, Unit unit, String block, Map<String, Template> templates) {
    int length = effectiveLength(employee);
    String crew = crewOf(employee);
    if (crew != null) {
      return crewCovers(crew, block) ? templates.get(crew) : null;
    }
    if (length == 8 && "NIGHT".equals(block)) {
      return null;
    }
    if (length == 12) {
      return templates.get("NIGHT".equals(block) || PreferenceTimes.nightVolunteer(employee.pref().timesOfDay())
          ? "A12"
          : "P12");
    }
    return templates.get(
        switch (block) {
          case "NIGHT" -> "N8";
          case "EVENING" -> "E8";
          default -> "D8";
        });
  }

  private static boolean covers(Template template, String block) {
    return switch (template.code()) {
      case "N8" -> "NIGHT".equals(block);
      case "D8" -> "DAY".equals(block);
      case "E8" -> "EVENING".equals(block);
      case "D12" -> "DAY".equals(block) || "EVENING".equals(block);
      case "N12" -> "NIGHT".equals(block) || "EVENING".equals(block);
      case "A12" -> "NIGHT".equals(block) || "DAY".equals(block);
      case "P12" -> "DAY".equals(block) || "EVENING".equals(block);
      case "L16" -> "DAY".equals(block) || "EVENING".equals(block);
      default -> false;
    };
  }

  private static void addHours(int[] hours, int startHour, int minutes) {
    for (int offset = 0; offset < minutes / 60; offset++) {
      hours[Math.floorMod(startHour + offset, 24)]++;
    }
  }

  private static int deficit(int[] hours, String block, int required) {
    int minimum = minimumCoverage(hours, block);
    return Math.max(0, required - minimum);
  }

  private static int minimumCoverage(int[] hours, String block) {
    int from = switch (block) {
      case "NIGHT" -> 23;
      case "DAY" -> 7;
      default -> 15;
    };
    int count = 8;
    int minimum = Integer.MAX_VALUE;
    for (int index = 0; index < count; index++) {
      minimum = Math.min(minimum, hours[(from + index) % 24]);
    }
    return minimum;
  }

  private static String preferenceBlock(Pref pref) {
    return PreferenceTimes.preferredBlock(pref.timesOfDay());
  }

  /**
   * Casual/part-time pool: after full-timers are placed, officers with FTE < 1 fill the leftover
   * coverage, nights first, newest-first, each proposal verified by the engine, never above
   * FTE x 80 hours in a pay period, fixed iteration count. Unfilled gaps stay gaps.
   */
  private static void casualPool(
      List<Unit> units,
      Map<UUID, List<Employee>> staff,
      Map<UUID, String> blockOf,
      List<Assignment> assignments,
      Map<UUID, List<Assignment>> byEmployee,
      Map<UUID, List<ShiftFact>> facts,
      List<Warning> warnings,
      Map<String, Template> templates,
      Verifier verifier,
      List<Employee> employees,
      Map<UUID, Set<LocalDate>> leave,
      Availability availability) {
    Set<String> warningKeys = new LinkedHashSet<>();
    Map<UUID, Double> target = new HashMap<>();
    employees.stream().filter(e -> e.fte() < 1.0).forEach(e -> target.put(e.id(), e.fte() * 80.0));
    Map<UUID, Double[]> hours = new HashMap<>();
    employees.stream().filter(e -> e.fte() < 1.0)
        .forEach(e -> hours.put(e.id(), new Double[7]));
    for (Assignment assignment : assignments) {
      Double[] perPeriod = hours.get(assignment.employeeId());
      if (perPeriod == null) {
        continue;
      }
      int period = (int) (ChronoUnit.DAYS.between(FROM, assignment.date()) / 14);
      if (period >= 0 && period < 7) {
        perPeriod[period] =
            (perPeriod[period] == null ? 0 : perPeriod[period])
                + Duration.between(assignment.start(), assignment.end()).toMinutes() / 60.0;
      }
    }
    Map<UUID, List<Employee>> casuals = new HashMap<>();
    employees.stream()
        .filter(e -> e.fte() < 1.0)
        .forEach(e -> casuals.computeIfAbsent(e.unitId(), k -> new ArrayList<>()).add(e));
    casuals.values().forEach(list -> list.sort(Comparator.comparing(Employee::seniority).reversed()));
    Map<String, int[]> coverage = new HashMap<>();
    Map<String, Set<UUID>> assigned = new HashMap<>();
    for (Assignment assignment : assignments) {
      String key = assignment.unitId() + "|" + assignment.date();
      addHours(coverage.computeIfAbsent(key, k -> new int[24]),
          assignment.start().atZone(REGINA).getHour(),
          (int) Duration.between(assignment.start(), assignment.end()).toMinutes());
      assigned.computeIfAbsent(key, k -> new LinkedHashSet<>()).add(assignment.employeeId());
    }
    int iterations = 0;
    for (Unit unit : units) {
      for (LocalDate date = FROM; !date.isAfter(TO); date = date.plusDays(1)) {
        if (!availability.active(unit.id(), date)) {
          continue;
        }
        String key = unit.id() + "|" + date;
        int[] hoursInDay = coverage.computeIfAbsent(key, k -> new int[24]);
        Set<UUID> already = assigned.computeIfAbsent(key, k -> new LinkedHashSet<>());
        for (String block : BLOCKS) {
          int required = unit.required().getOrDefault(block, 0);
          while (minimumCoverage(hoursInDay, block) < required && iterations++ < 5000) {
            Employee chosen = null;
            Template chosenTemplate = null;
            Check chosenCheck = null;
            for (Employee candidate : casuals.getOrDefault(unit.id(), List.of())) {
              if (already.contains(candidate.id())
                  || onLeave(candidate.id(), date, leave)) {
                continue;
              }
              Template template = templateFor(candidate, unit, block, templates);
              if (template == null || !covers(template, block)) {
                continue;
              }
              int period = (int) (ChronoUnit.DAYS.between(FROM, date) / 14);
              double planned = hours.get(candidate.id())[period] == null
                  ? 0 : hours.get(candidate.id())[period];
              double shiftHours = template.minutes() / 60.0;
              if (planned + shiftHours > target.get(candidate.id()) + 0.001) {
                continue;
              }
              Instant start = date.atTime(template.start()).atZone(REGINA).toInstant();
              Check check = verifier.check(candidate, unit, template, start,
                  facts.getOrDefault(candidate.id(), List.of()));
              if (!check.blocked()) {
                chosen = candidate;
                chosenTemplate = template;
                chosenCheck = check;
                break;
              }
            }
            if (chosen == null) {
              break;
            }
            Instant start = date.atTime(chosenTemplate.start()).atZone(REGINA).toInstant();
            Instant end = start.plus(Duration.ofMinutes(chosenTemplate.minutes()));
            int period = (int) (ChronoUnit.DAYS.between(FROM, date) / 14);
            hours.get(chosen.id())[period] =
                (hours.get(chosen.id())[period] == null ? 0 : hours.get(chosen.id())[period])
                    + chosenTemplate.minutes() / 60.0;
            addHours(hoursInDay, chosenTemplate.start().getHour(), chosenTemplate.minutes());
            already.add(chosen.id());
            Assignment assignment = new Assignment(chosen.id(), chosen.name(), unit.id(),
                unit.code(), chosenTemplate.id(), chosenTemplate.code(), date, start, end,
                ShiftKind.ROSTERED, chosenCheck == null ? List.of() : chosenCheck.warnings());
            assignments.add(assignment);
            byEmployee.computeIfAbsent(chosen.id(), k -> new ArrayList<>()).add(assignment);
            facts.computeIfAbsent(chosen.id(), k -> new ArrayList<>()).add(
                new ShiftFact("plan:" + date + ":" + chosenTemplate.code(), chosen.employeeNo(),
                    unit.code(), chosenTemplate.code(), start, end, ShiftKind.ROSTERED, 0, true,
                    true));
            for (RuleWarning warning : assignment.warnings()) {
              addWarning(warnings, warningKeys, chosen.id().toString(), warning,
                  unit.code(), chosen.name(), date, chosenTemplate.code());
            }
          }
        }
      }
    }
  }

  /**
   * Cross-unit gap fill (v1.2 option): after the home-unit fills and closed-unit relief, each
   * remaining gap (the same absolute-time measure as the board) is offered to officers homed in
   * another unit. Eligible: not working that day, not on leave, a 12 h officer only where the unit
   * allows 12 h, a template that covers the block, the block's qualification held when it has one,
   * and room under FTE x 80 h in the pay period (so a full-time officer only fills a short
   * period, never into overtime). Order: the lowest share of target planned in the period first,
   * then newest first (the pool's order), then employee number. Every proposal goes through the same
   * verifier; a Block skips that officer. Returns the card the scorecard shows.
   */
  private static Map<String, Object> crossUnitFill(
      List<Unit> units,
      List<Assignment> assignments,
      Map<UUID, List<Assignment>> byEmployee,
      Map<UUID, List<ShiftFact>> facts,
      List<Warning> warnings,
      Map<String, Template> templates,
      Verifier verifier,
      List<Employee> employees,
      Map<UUID, Set<LocalDate>> leave,
      Availability availability,
      Qualifications qualifications) {
    Set<String> warningKeys = new LinkedHashSet<>();
    Map<UUID, double[]> hours = new HashMap<>();
    employees.forEach(e -> hours.put(e.id(), new double[PERIODS]));
    Set<String> working = new LinkedHashSet<>();
    Map<UUID, List<CoverageCalculator.Interval>> intervals = new HashMap<>();
    for (Assignment assignment : assignments) {
      working.add(assignment.employeeId() + "|" + assignment.date());
      intervals
          .computeIfAbsent(assignment.unitId(), k -> new ArrayList<>())
          .add(new CoverageCalculator.Interval(assignment.start(), assignment.end()));
      double[] perPeriod = hours.get(assignment.employeeId());
      int period = (int) (ChronoUnit.DAYS.between(FROM, assignment.date()) / 14);
      if (perPeriod != null && period >= 0 && period < PERIODS) {
        perPeriod[period] += Duration.between(assignment.start(), assignment.end()).toMinutes() / 60.0;
      }
    }
    Map<UUID, Unit> unitsById = new HashMap<>();
    units.forEach(unit -> unitsById.put(unit.id(), unit));
    CoverageCalculator calculator = new CoverageCalculator();
    List<Gap> before = recomputeGaps(units, assignments, availability);
    int shifts = 0;
    Set<UUID> officers = new LinkedHashSet<>();
    Map<String, Integer> fromUnits = new java.util.TreeMap<>();
    Map<String, Integer> stillShort = new java.util.TreeMap<>();
    Map<String, Integer> stillShortBy = new java.util.TreeMap<>();
    for (Gap gap : before) {
      Unit unit = unitsById.get(gap.unitId());
      LocalDate date = gap.date();
      int period = (int) (ChronoUnit.DAYS.between(FROM, date) / 14);
      int guard = 0;
      // Each placement covers at least one hour of the gap, and a block needs at most its minimum
      // (6 on the demo data) more officers, so 20 attempts is a safe ceiling, not a cap in practice.
      while (guard++ < 20 && short_(calculator, unit, date, gap.block(), intervals)) {
        // The filters in order; the first one nobody passes is the reason the gap stays short.
        int free = 0;
        int qualifiedForGap = 0;
        int fits = 0;
        int qualifiedForShift = 0;
        int withRoom = 0;
        List<Employee> candidates = new ArrayList<>();
        for (Employee candidate : employees) {
          if (candidate.unitId().equals(unit.id())
              || candidate.fte() <= 0
              || working.contains(candidate.id() + "|" + date)
              || onLeave(candidate.id(), date, leave)
              || (effectiveLength(candidate) == 12 && !unit.allows12h())) {
            continue;
          }
          free++;
          if (qualifications.allows(candidate, unit.id(), gap.block())) {
            qualifiedForGap++;
            candidates.add(candidate);
          }
        }
        candidates.sort(crossUnitOrder(hours, period));
        Employee chosen = null;
        Template chosenTemplate = null;
        Check chosenCheck = null;
        for (Employee candidate : candidates) {
          Template template = templateFor(candidate, unit, gap.block(), templates);
          if (template == null || !covers(template, gap.block())) {
            continue;
          }
          fits++;
          // A 12 h shift also covers part of a neighbouring block: the officer must hold that
          // block's qualification too, not only the gap's.
          boolean qualifiedEverywhere = true;
          for (String block : BLOCKS) {
            if (covers(template, block) && !qualifications.allows(candidate, unit.id(), block)) {
              qualifiedEverywhere = false;
            }
          }
          if (!qualifiedEverywhere) {
            continue;
          }
          qualifiedForShift++;
          if (hours.get(candidate.id())[period] + template.minutes() / 60.0
              > candidate.fte() * 80.0 + 0.001) {
            continue;
          }
          withRoom++;
          Instant start = date.atTime(template.start()).atZone(REGINA).toInstant();
          Check check =
              verifier.check(
                  candidate, unit, template, start, facts.getOrDefault(candidate.id(), List.of()));
          if (!check.blocked()) {
            chosen = candidate;
            chosenTemplate = template;
            chosenCheck = check;
            break;
          }
        }
        if (chosen == null) {
          String reason =
              free == 0
                  ? "NO_OFFICER_FREE"
                  : qualifiedForGap == 0
                      ? "NOT_QUALIFIED"
                      : fits == 0
                          ? "NO_SHIFT_FITS"
                          : qualifiedForShift == 0
                              ? "NOT_QUALIFIED"
                              : withRoom == 0 ? "NO_HOURS_LEFT" : "RULE_BLOCK";
          stillShort.merge(reason, 1, Integer::sum);
          stillShortBy.merge(unit.code() + " " + gap.block(), 1, Integer::sum);
          break;
        }
        Instant start = date.atTime(chosenTemplate.start()).atZone(REGINA).toInstant();
        Instant end = start.plus(Duration.ofMinutes(chosenTemplate.minutes()));
        Assignment assignment =
            new Assignment(chosen.id(), chosen.name(), unit.id(), unit.code(), chosenTemplate.id(),
                chosenTemplate.code(), date, start, end, ShiftKind.ROSTERED, chosenCheck.warnings());
        assignments.add(assignment);
        byEmployee.computeIfAbsent(chosen.id(), k -> new ArrayList<>()).add(assignment);
        facts
            .computeIfAbsent(chosen.id(), k -> new ArrayList<>())
            .add(
                new ShiftFact(
                    "plan:" + date + ":" + chosenTemplate.code(), chosen.employeeNo(), unit.code(),
                    chosenTemplate.code(), start, end, ShiftKind.ROSTERED, 0, true, true));
        intervals
            .computeIfAbsent(unit.id(), k -> new ArrayList<>())
            .add(new CoverageCalculator.Interval(start, end));
        working.add(chosen.id() + "|" + date);
        hours.get(chosen.id())[period] += chosenTemplate.minutes() / 60.0;
        shifts++;
        officers.add(chosen.id());
        fromUnits.merge(chosen.unitCode(), 1, Integer::sum);
        for (RuleWarning warning : chosenCheck.warnings()) {
          addWarning(warnings, warningKeys, chosen.id().toString(), warning, unit.code(),
              chosen.name(), date, chosenTemplate.code());
        }
      }
    }
    int after = recomputeGaps(units, assignments, availability).size();
    int covered = before.size() - after;
    Map<String, Object> card = new LinkedHashMap<>();
    card.put("gapsBefore", before.size());
    card.put("gapsCovered", covered);
    card.put("shifts", shifts);
    card.put("officers", officers.size());
    card.put("fromUnits", fromUnits);
    // Gaps the pass tried and could not cover, by the first filter nobody passed.
    card.put("stillShortReasons", stillShort);
    card.put("stillShortByUnitBlock", stillShortBy);
    card.put(
        "line",
        covered
            + (covered == 1 ? " gap" : " gaps")
            + " covered from other units ("
            + shifts
            + (shifts == 1 ? " shift" : " shifts")
            + " by "
            + officers.size()
            + (officers.size() == 1 ? " officer" : " officers")
            + "); "
            + after
            + " still short.");
    return card;
  }

  /**
   * The cross-unit order: the lowest share of FTE x 80 h already planned in the pay period first,
   * then the newest officer (the casual pool's order), then employee number so it is total.
   */
  static Comparator<Employee> crossUnitOrder(Map<UUID, double[]> hours, int period) {
    return Comparator.comparingDouble(
            (Employee e) -> hours.get(e.id())[period] / (e.fte() * 80.0))
        .thenComparing(Employee::seniority, Comparator.reverseOrder())
        .thenComparing(Employee::employeeNo);
  }

  private static boolean short_(
      CoverageCalculator calculator,
      Unit unit,
      LocalDate date,
      String block,
      Map<UUID, List<CoverageCalculator.Interval>> intervals) {
    for (CoverageCalculator.BlockCoverage coverage :
        calculator.forDay(date, unit.required(), intervals.getOrDefault(unit.id(), List.of()))) {
      if (coverage.block().equals(block)) {
        return !coverage.covered();
      }
    }
    return false;
  }

  /**
   * Part-time fill "up to FTE" (PR-N option): runs after every gap fill, so it can only add
   * cover, never take a shift from a gap. Day by day, each part-time officer (below 1.0 FTE) who
   * still has room under FTE x 80 h in the pay period, and is not ahead of an even pace through
   * the period, is offered one shift in their home unit, in the block whose cover is thinnest
   * against the minimum. Every proposal goes through the same verifier; a Block skips it. Officers
   * with the most room go first, then newest first, then employee number: deterministic.
   */
  private static void topUpPartTime(
      List<Unit> units,
      List<Assignment> assignments,
      Map<UUID, List<Assignment>> byEmployee,
      Map<UUID, List<ShiftFact>> facts,
      List<Warning> warnings,
      Map<String, Template> templates,
      Verifier verifier,
      List<Employee> employees,
      Map<UUID, Set<LocalDate>> leave,
      Availability availability) {
    List<Employee> partTime = employees.stream().filter(e -> e.fte() < 1.0).toList();
    if (partTime.isEmpty()) {
      return;
    }
    Map<UUID, Unit> unitsById = new HashMap<>();
    units.forEach(unit -> unitsById.put(unit.id(), unit));
    Set<String> warningKeys = new LinkedHashSet<>();
    Map<UUID, double[]> hours = new HashMap<>();
    partTime.forEach(e -> hours.put(e.id(), new double[PERIODS]));
    Map<String, int[]> coverage = new HashMap<>();
    Set<String> working = new LinkedHashSet<>();
    for (Assignment assignment : assignments) {
      int minutes = (int) Duration.between(assignment.start(), assignment.end()).toMinutes();
      addHours(
          coverage.computeIfAbsent(assignment.unitId() + "|" + assignment.date(), k -> new int[24]),
          assignment.start().atZone(REGINA).getHour(),
          minutes);
      working.add(assignment.employeeId() + "|" + assignment.date());
      double[] perPeriod = hours.get(assignment.employeeId());
      int period = (int) (ChronoUnit.DAYS.between(FROM, assignment.date()) / 14);
      if (perPeriod != null && period >= 0 && period < PERIODS) {
        perPeriod[period] += minutes / 60.0;
      }
    }
    for (LocalDate date = FROM; !date.isAfter(TO); date = date.plusDays(1)) {
      int period = (int) (ChronoUnit.DAYS.between(FROM, date) / 14);
      int dayInPeriod = (int) (ChronoUnit.DAYS.between(FROM, date) % 14);
      List<Employee> order = new ArrayList<>(partTime);
      order.sort(
          Comparator.comparingDouble(
                  (Employee e) -> hours.get(e.id())[period] - e.fte() * 80.0)
              .thenComparing(Employee::seniority, Comparator.reverseOrder())
              .thenComparing(Employee::employeeNo));
      for (Employee candidate : order) {
        Unit unit = unitsById.get(candidate.unitId());
        if (unit == null
            || !availability.active(unit.id(), date)
            || working.contains(candidate.id() + "|" + date)
            || onLeave(candidate.id(), date, leave)) {
          continue;
        }
        double target = candidate.fte() * 80.0;
        double planned = hours.get(candidate.id())[period];
        if (planned > target * (dayInPeriod + 1) / 14.0) {
          continue; // ahead of an even pace: leave the day for later, so shifts spread out
        }
        int[] hoursInDay = coverage.computeIfAbsent(unit.id() + "|" + date, k -> new int[24]);
        List<String> blocks = new ArrayList<>();
        for (String block : BLOCKS) {
          if (unit.required().getOrDefault(block, 0) > 0) {
            blocks.add(block);
          }
        }
        blocks.sort(
            Comparator.comparingInt(
                block -> minimumCoverage(hoursInDay, block) - unit.required().get(block)));
        for (String block : blocks) {
          Template template = templateFor(candidate, unit, block, templates);
          if (template == null || !covers(template, block)) {
            continue;
          }
          double shiftHours = template.minutes() / 60.0;
          if (planned + shiftHours > target + 0.001) {
            continue;
          }
          Instant start = date.atTime(template.start()).atZone(REGINA).toInstant();
          Check check =
              verifier.check(
                  candidate, unit, template, start, facts.getOrDefault(candidate.id(), List.of()));
          if (check.blocked()) {
            continue;
          }
          Instant end = start.plus(Duration.ofMinutes(template.minutes()));
          addHours(hoursInDay, template.start().getHour(), template.minutes());
          working.add(candidate.id() + "|" + date);
          hours.get(candidate.id())[period] += shiftHours;
          Assignment assignment =
              new Assignment(
                  candidate.id(), candidate.name(), unit.id(), unit.code(), template.id(),
                  template.code(), date, start, end, ShiftKind.ROSTERED, check.warnings());
          assignments.add(assignment);
          byEmployee.computeIfAbsent(candidate.id(), k -> new ArrayList<>()).add(assignment);
          facts
              .computeIfAbsent(candidate.id(), k -> new ArrayList<>())
              .add(
                  new ShiftFact(
                      "plan:" + date + ":" + template.code(), candidate.employeeNo(), unit.code(),
                      template.code(), start, end, ShiftKind.ROSTERED, 0, true, true));
          for (RuleWarning warning : check.warnings()) {
            addWarning(warnings, warningKeys, candidate.id().toString(), warning, unit.code(),
                candidate.name(), date, template.code());
          }
          break;
        }
      }
    }
  }

  /**
   * Closed-unit relief (P4-RELIEF-NOTE, ADR-027): after each unit's own staff and its own casual
   * pool, an officer whose home unit is closed that day may fill another unit's remaining gap.
   * Only full-time officers are offered (casuals are a fill pool with no guaranteed hours); the
   * order is home unit code, then seniority, then employee number. A 12 h officer only enters a
   * unit that allows 12 h; an 8 h officer may fill any 8 h shift. Every proposal still goes through
   * the same verifier. With no closures the pool is empty, so the 100/120 plans are unchanged.
   */
  private static void reliefPool(
      List<Unit> units,
      Map<UUID, List<Employee>> staff,
      List<Assignment> assignments,
      Map<UUID, List<Assignment>> byEmployee,
      Map<UUID, List<ShiftFact>> facts,
      List<Warning> warnings,
      Map<String, Template> templates,
      Verifier verifier,
      List<Employee> employees,
      Map<UUID, Set<LocalDate>> leave,
      Availability availability,
      String pattern8h) {
    Set<String> warningKeys = new LinkedHashSet<>();
    Map<String, int[]> coverage = new HashMap<>();
    Map<LocalDate, Set<UUID>> assignedByDate = new HashMap<>();
    for (Assignment assignment : assignments) {
      String key = assignment.unitId() + "|" + assignment.date();
      addHours(
          coverage.computeIfAbsent(key, ignored -> new int[24]),
          assignment.start().atZone(REGINA).getHour(),
          (int) Duration.between(assignment.start(), assignment.end()).toMinutes());
      assignedByDate
          .computeIfAbsent(assignment.date(), ignored -> new LinkedHashSet<>())
          .add(assignment.employeeId());
    }
    List<Employee> pool =
        employees.stream()
            .filter(employee -> employee.fte() >= 1.0)
            .sorted(
                Comparator.comparing(Employee::unitCode)
                    .thenComparing(Employee::seniority)
                    .thenComparing(Employee::employeeNo))
            .toList();
    int iterations = 0;
    for (Unit unit : units) {
      for (LocalDate date = FROM; !date.isAfter(TO); date = date.plusDays(1)) {
        if (!availability.active(unit.id(), date)) {
          continue;
        }
        String key = unit.id() + "|" + date;
        int[] hoursInDay = coverage.computeIfAbsent(key, ignored -> new int[24]);
        Set<UUID> assignedToday =
            assignedByDate.computeIfAbsent(date, ignored -> new LinkedHashSet<>());
        for (String block : BLOCKS) {
          int required = unit.required().getOrDefault(block, 0);
          while (minimumCoverage(hoursInDay, block) < required && iterations++ < 5000) {
            Employee chosen = null;
            Template chosenTemplate = null;
            Check chosenCheck = null;
            for (Employee candidate : pool) {
              if (candidate.unitId().equals(unit.id())
                  || availability.active(candidate.unitId(), date)
                  || assignedToday.contains(candidate.id())
                  || onLeave(candidate.id(), date, leave)) {
                continue;
              }
              if (effectiveLength(candidate) == 12 && !unit.allows12h()) {
                continue;
              }
              Template template = templateFor(candidate, unit, block, templates);
              if (template == null || !covers(template, block)) {
                continue;
              }
              Instant start = date.atTime(template.start()).atZone(REGINA).toInstant();
              Check check =
                  verifier.check(
                      candidate,
                      unit,
                      template,
                      start,
                      facts.getOrDefault(candidate.id(), List.of()));
              if (!check.blocked()) {
                chosen = candidate;
                chosenTemplate = template;
                chosenCheck = check;
                break;
              }
            }
            if (chosen == null) {
              break;
            }
            Instant start = date.atTime(chosenTemplate.start()).atZone(REGINA).toInstant();
            Instant end = start.plus(Duration.ofMinutes(chosenTemplate.minutes()));
            addHours(hoursInDay, chosenTemplate.start().getHour(), chosenTemplate.minutes());
            assignedToday.add(chosen.id());
            Assignment assignment =
                new Assignment(
                    chosen.id(),
                    chosen.name(),
                    unit.id(),
                    unit.code(),
                    chosenTemplate.id(),
                    chosenTemplate.code(),
                    date,
                    start,
                    end,
                    ShiftKind.ROSTERED,
                    chosenCheck == null ? List.of() : chosenCheck.warnings());
            assignments.add(assignment);
            byEmployee.computeIfAbsent(chosen.id(), ignored -> new ArrayList<>()).add(assignment);
            facts
                .computeIfAbsent(chosen.id(), ignored -> new ArrayList<>())
                .add(
                    new ShiftFact(
                        "plan:" + date + ":" + chosenTemplate.code(),
                        chosen.employeeNo(),
                        unit.code(),
                        chosenTemplate.code(),
                        start,
                        end,
                        ShiftKind.ROSTERED,
                        0,
                        true,
                        true));
            for (RuleWarning warning : assignment.warnings()) {
              addWarning(
                  warnings,
                  warningKeys,
                  chosen.id().toString(),
                  warning,
                  unit.code(),
                  chosen.name(),
                  date,
                  chosenTemplate.code());
            }
          }
        }
      }
    }
  }

  private static Map<String, Object> fteBandsCard(
      List<Employee> employees, Map<UUID, List<Assignment>> byEmployee) {
    List<Map<String, Object>> bands = new ArrayList<>();
    for (String band : List.of("FULL_TIME", "0.7_TO_0.9", "UNDER_0.7")) {
      List<Employee> members = employees.stream().filter(e -> bandOf(e.fte()).equals(band)).toList();
      if (members.isEmpty()) {
        continue;
      }
      List<Double> planned = new ArrayList<>();
      List<Double> targets = new ArrayList<>();
      for (Employee employee : members) {
        planned.add(byEmployee.getOrDefault(employee.id(), List.of()).stream()
            .mapToDouble(s -> Duration.between(s.start(), s.end()).toMinutes() / 60.0).sum());
        targets.add(employee.fte() * 80.0 * 7);
      }
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("band", band);
      row.put("officers", members.size());
      row.put("targetHours", round1(targets.stream().mapToDouble(Double::doubleValue).average().orElse(0)));
      row.put("plannedMin", round1(planned.stream().mapToDouble(Double::doubleValue).min().orElse(0)));
      row.put("plannedAvg", round1(planned.stream().mapToDouble(Double::doubleValue).average().orElse(0)));
      row.put("plannedMax", round1(planned.stream().mapToDouble(Double::doubleValue).max().orElse(0)));
      bands.add(row);
    }
    return Map.of(
        "bands", bands,
        "note", "Part-time and casual officers are not guaranteed hours; they fill what is left.");
  }

  private static String bandOf(double fte) {
    if (fte >= 1.0) {
      return "FULL_TIME";
    }
    return fte >= 0.7 ? "0.7_TO_0.9" : "UNDER_0.7";
  }

  /** One item per officer per rule: the changeover warning is one event, not one per later shift. */
  private static void addWarning(
      List<Warning> warnings,
      Set<String> keys,
      String employeeId,
      RuleWarning rule,
      String unitCode,
      String employeeName,
      LocalDate date,
      String shift) {
    if (keys.add(employeeId + "|" + rule.ruleCode())) {
      warnings.add(
          new Warning(
              rule.ruleCode(),
              ruleName(rule.ruleCode()),
              rule.message(),
              unitCode,
              employeeName,
              date,
              shift));
    }
  }

  private static List<Employee> rephase(
      List<Employee> employees, Map<UUID, String> blockOf, String pattern8h) {
    Map<String, Integer> counters = new HashMap<>();
    List<Employee> result = new ArrayList<>();
    for (Employee employee : employees) {
      if (employee.fte() < 1.0) {
        // The casual pool is placed after the full-time plan; it must not shift the phases that
        // decide the full-timers' days, or adding casuals would change the plan they fill into.
        result.add(employee);
        continue;
      }
      int length = employee.effectiveLength();
      String crew = crewOf(employee);
      String key =
          length == 12
              ? employee.unitId() + "|" + (crew == null ? "12" : crew)
              : employee.unitId()
                  + "|"
                  + blockOf.getOrDefault(employee.id(), "DAY")
                  + "|"
                  + patternOf(employee, pattern8h);
      int index = counters.merge(key, 1, Integer::sum) - 1;
      // 12 h crews are paired: two officers per post take phases j and j+4 of the 8-day cycle,
      // so exactly the post count is on duty every day. Sequential phases would put a 2-officer
      // crew all on for four days and all off for four. 8 h phases stay sequential.
      int phase = length == 12 ? Math.floorMod(index / 2 + (index % 2) * 4, 8) : index % 7;
      result.add(
          new Employee(
              employee.id(),
              employee.employeeNo(),
              employee.name(),
              employee.unitId(),
              employee.unitCode(),
              employee.seniority(),
              employee.fte(),
              employee.pref(),
              employee.effectiveLength(),
              phase,
              employee.crew(),
              employee.pattern()));
    }
    return result;
  }

  /**
   * Gaps are absolute-time coverage (ADR-013/017), the same measure the planning board shows: the
   * NIGHT block on date D runs 23:00 D to 07:00 D+1, so a 23:00 shift counts in the hours after
   * midnight. Using the board's calculator keeps the plan's gap count and the board's identical.
   */
  private static List<Gap> recomputeGaps(
      List<Unit> units, List<Assignment> assignments, Availability availability) {
    Map<UUID, List<CoverageCalculator.Interval>> intervalsByUnit = new HashMap<>();
    for (Assignment assignment : assignments) {
      intervalsByUnit
          .computeIfAbsent(assignment.unitId(), key -> new ArrayList<>())
          .add(new CoverageCalculator.Interval(assignment.start(), assignment.end()));
    }
    CoverageCalculator calculator = new CoverageCalculator();
    List<Gap> gaps = new ArrayList<>();
    for (Unit unit : units) {
      List<CoverageCalculator.Interval> intervals =
          intervalsByUnit.getOrDefault(unit.id(), List.of());
      for (LocalDate date = FROM; !date.isAfter(TO); date = date.plusDays(1)) {
        if (!availability.active(unit.id(), date)) {
          continue;
        }
        for (CoverageCalculator.BlockCoverage block :
            calculator.forDay(date, unit.required(), intervals)) {
          if (!block.covered()) {
            gaps.add(
                new Gap(
                    unit.id(),
                    unit.code(),
                    date,
                    block.block(),
                    block.required(),
                    block.coverage().lowestHourly(),
                    "No eligible officer left without a Block rule; a supervisor fills this"));
          }
        }
      }
    }
    return gaps;
  }

  private static Map<String, Object> scorecard(
      List<Employee> employees,
      List<Unit> units,
      List<Assignment> assignments,
      Map<UUID, List<Assignment>> byEmployee,
      List<Gap> gaps,
      List<Warning> warnings,
      String pattern8h,
      long startedNanos,
      Map<UUID, List<ShiftFact>> facts,
      Map<String, Template> templates,
      Verifier verifier,
      Map<UUID, String> blockOf,
      Map<UUID, Set<LocalDate>> leave,
      Availability availability) {
    Map<String, Object> scorecard = new LinkedHashMap<>();
    long activeUnitDays = 0;
    for (LocalDate date = FROM; !date.isAfter(TO); date = date.plusDays(1)) {
      for (Unit unit : units) {
        if (availability.active(unit.id(), date)) {
          activeUnitDays++;
        }
      }
    }
    long totalBlockDays = activeUnitDays * 3;
    scorecard.put(
        "coverage",
        Map.of(
            "shortBlockDays", gaps.size(),
            "totalBlockDays", totalBlockDays));
    scorecard.put("warnings", warningsCard(warnings));
    scorecard.put("preferences", preferencesCard(employees, byEmployee, templates));
    scorecard.put(
        "preferencesNote",
        "The planner rosters 8- and 12-hour shifts only; a 16 h preference is shown unmet. Only"
            + " 12-hour officers work nights, so an 8 h night preference is shown unmet. Part-time"
            + " and casual officers are not guaranteed hours.");
    scorecard.put(
        "nightPolicy",
        "Only 12-hour officers work nights; 8-hour officers work day or evening shifts.");
    scorecard.put(
        "nights",
        nightsCard(
            employees,
            units,
            assignments,
            byEmployee,
            facts,
            templates,
            verifier,
            pattern8h,
            blockOf));
    scorecard.put("overtime", overtimeCard(employees, byEmployee));
    scorecard.put("weekends", weekendsCard(employees, byEmployee));
    scorecard.put("fteBands", fteBandsCard(employees, byEmployee));
    scorecard.put("quarterHours", quarterHoursCard(employees, byEmployee));
    scorecard.put(
        "patterns",
        Map.of(
            "officers",
            employees.stream()
                .map(
                    employee -> {
                      String pattern = patternOf(employee, pattern8h);
                      Map<String, Object> row = new LinkedHashMap<>();
                      row.put("employeeNo", employee.employeeNo());
                      row.put("name", employee.name());
                      row.put("unitCode", employee.unitCode());
                      row.put("pattern", pattern);
                      row.put("words", patternWords(pattern));
                      return row;
                    })
                .toList(),
            "note",
            "Every officer has a pattern. The planner changes an 8-hour officer's pattern on"
                + " Preferences; a 12-hour officer keeps the crew's 4 on, 4 off cycle."));
    boolean anyRotating =
        employees.stream()
            .anyMatch(
                employee ->
                    effectiveLength(employee) == 8
                        && "ROTATING_5_2".equals(patternOf(employee, pattern8h)));
    if (anyRotating) {
      scorecard.put(
          "warningNote",
          "At the weekend-rotation changeover an officer has one ordinary rest-day warning"
              + " (fewer than 2 days off in 7) and one weekly-hours warning (over 48 h in 7 days),"
              + " and the changeover pay period is 72 hours; where the pattern would otherwise create"
              + " a seventh consecutive work day, a second 72-hour period keeps every shift free of a"
              + " Block rule. Hours are balanced over the quarter, not per period.");
    }
    scorecard.put("absences", absencesCard(employees, leave, assignments));
    scorecard.put(
        "generatedMs", (System.nanoTime() - startedNanos) / 1_000_000);
    scorecard.put("pattern8h", pattern8h);
    return scorecard;
  }

  private static boolean onLeave(
      UUID employeeId, LocalDate date, Map<UUID, Set<LocalDate>> leave) {
    return leave.getOrDefault(employeeId, Set.of()).contains(date);
  }

  /** How many planned absences the plan respected, and how many absence-days relief covered. */
  private static Map<String, Object> absencesCard(
      List<Employee> employees,
      Map<UUID, Set<LocalDate>> leave,
      List<Assignment> assignments) {
    Map<UUID, Employee> byId = new HashMap<>();
    employees.forEach(employee -> byId.put(employee.id(), employee));
    int officers = 0;
    int days = 0;
    int covered = 0;
    for (Map.Entry<UUID, Set<LocalDate>> entry : leave.entrySet()) {
      if (entry.getValue().isEmpty()) {
        continue;
      }
      officers++;
      Employee absent = byId.get(entry.getKey());
      for (LocalDate date : entry.getValue()) {
        days++;
        boolean relief =
            assignments.stream()
                .anyMatch(
                    assignment -> {
                      if (!assignment.unitId().equals(absent.unitId())
                          || !assignment.date().equals(date)
                          || assignment.employeeId().equals(absent.id())) {
                        return false;
                      }
                      Employee other = byId.get(assignment.employeeId());
                      return other != null
                          && (other.fte() < 1.0
                              || (other.crew() != null && other.crew().contains("RELIEF")));
                    });
        if (relief) {
          covered++;
        }
      }
    }
    String line =
        days == 0
            ? "No planned absences were entered for this quarter."
            : officers
                + (officers == 1 ? " officer on leave was" : " officers on leave were")
                + " skipped: relief officers covered "
                + covered
                + " of the "
                + days
                + " shifts.";
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("officers", officers);
    result.put("days", days);
    result.put("coveredByRelief", covered);
    result.put("uncovered", days - covered);
    result.put("line", line);
    return result;
  }

  private static Map<String, Object> warningsCard(List<Warning> warnings) {
    Map<String, Integer> counts = new LinkedHashMap<>();
    for (Warning warning : warnings) {
      counts.merge(warning.ruleName(), 1, Integer::sum);
    }
    List<Map<String, Object>> byRule = new ArrayList<>();
    counts.forEach((name, count) -> byRule.add(Map.of("ruleName", name, "count", count)));
    return Map.of("total", warnings.size(), "byRule", byRule);
  }

  private static Map<String, Object> preferencesCard(
      List<Employee> employees,
      Map<UUID, List<Assignment>> byEmployee,
      Map<String, Template> templates) {
    int lengthAsked = 0;
    int lengthMet = 0;
    int timeAsked = 0;
    int timeMet = 0;
    int daysAsked = 0;
    int daysMet = 0;
    for (Employee employee : employees) {
      List<Assignment> shifts = byEmployee.getOrDefault(employee.id(), List.of());
      if (shifts.isEmpty()) {
        // A shift-less officer cannot have met a preference; the headline counts only rostered
        // officers (release 4, #14).
        continue;
      }
      Pref pref = employee.pref();
      if (pref.shiftLength() != null) {
        lengthAsked++;
        if (!shifts.isEmpty()
            && shifts.stream()
                .allMatch(
                    shift -> {
                      Template template = templates.get(shift.templateCode());
                      return template != null
                          && ShiftKinds.lengthHours(template.minutes()) == pref.shiftLength();
                    })) {
          lengthMet++;
        }
      }
      if (PreferenceTimes.asked(pref.timesOfDay())) {
        timeAsked++;
        if (!shifts.isEmpty()
            && shifts.stream()
                .allMatch(
                    shift -> {
                      Template template = templates.get(shift.templateCode());
                      return template != null
                          && PreferenceTimes.matches(
                              pref.timesOfDay(), ShiftKinds.timeOfDay(template.start()));
                    })) {
          timeMet++;
        }
      }
      if (pref.daysOff() != null && !pref.daysOff().isEmpty()) {
        daysAsked++;
        boolean kept =
            shifts.stream()
                .noneMatch(
                    shift ->
                        pref.daysOff().contains(
                            shift.date().getDayOfWeek().name().substring(0, 3)));
        if (kept) {
          daysMet++;
        }
      }
    }
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("asked", lengthAsked + timeAsked + daysAsked);
    result.put("met", lengthMet + timeMet + daysMet);
    result.put(
        "byKind",
        List.of(
            kind("SHIFT_LENGTH", lengthAsked, lengthMet),
            kind("TIME_OF_DAY", timeAsked, timeMet),
            kind("DAYS_OFF", daysAsked, daysMet)));
    return result;
  }

  private static Map<String, Object> kind(String kind, int asked, int met) {
    return Map.of("kind", kind, "asked", asked, "met", met);
  }

  private static Map<String, Object> nightsCard(
      List<Employee> employees,
      List<Unit> units,
      List<Assignment> assignments,
      Map<UUID, List<Assignment>> byEmployee,
      Map<UUID, List<ShiftFact>> facts,
      Map<String, Template> templates,
      Verifier verifier,
      String pattern8h,
      Map<UUID, String> blockOf) {
    List<Employee> sorted = new ArrayList<>(employees);
    sorted.sort(Comparator.comparing(Employee::seniority));
    int third = Math.max(1, sorted.size() / 3);
    List<Map<String, Object>> bands = new ArrayList<>();
    long totalNights =
        assignments.stream().filter(shift -> ShiftKinds.isNight(templates.get(shift.templateCode()))).count();
    for (int band = 0; band < 3; band++) {
      int from = band * third;
      int to = band == 2 ? sorted.size() : Math.min(sorted.size(), (band + 1) * third);
      List<Employee> members = sorted.subList(Math.min(from, sorted.size()), to);
      long nights =
          members.stream()
              .flatMap(member -> byEmployee.getOrDefault(member.id(), List.of()).stream())
              .filter(shift -> ShiftKinds.isNight(templates.get(shift.templateCode())))
              .count();
      int avoidAsked = 0;
      int avoidGiven = 0;
      long againstWish = 0;
      for (Employee member : members) {
        boolean avoidsNights = PreferenceTimes.avoidsNights(member.pref().timesOfDay());
        if (!avoidsNights) {
          continue;
        }
        avoidAsked++;
        List<Assignment> shifts = byEmployee.getOrDefault(member.id(), List.of());
        long given = shifts.stream().filter(shift -> ShiftKinds.isNight(templates.get(shift.templateCode()))).count();
        if (given > 0) {
          avoidGiven++;
          againstWish += given;
        }
      }
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("label", band == 0 ? "Most senior third" : band == 1 ? "Middle third" : "Newest third");
      row.put("officers", members.size());
      row.put("nightShare", totalNights == 0 ? 0.0 : round1(nights * 100.0 / totalNights));
      row.put("avoidNightsAsked", avoidAsked);
      row.put("avoidNightsGivenNights", avoidGiven);
      row.put("nightShiftsAgainstWish", againstWish);
      bands.add(row);
    }
    boolean held = true;
    String check = "Newest first held in all units.";
    for (Unit unit : units) {
      List<Employee> members = new ArrayList<>();
      employees.stream().filter(e -> e.unitId().equals(unit.id())).forEach(members::add);
      for (LocalDate date = FROM; !date.isAfter(TO) && held; date = date.plusDays(1)) {
        Set<UUID> working = new LinkedHashSet<>();
        for (Assignment assignment : assignments) {
          if (assignment.unitId().equals(unit.id()) && assignment.date().equals(date)) {
            working.add(assignment.employeeId());
          }
        }
        for (Assignment assignment : assignments) {
          if (!assignment.unitId().equals(unit.id())
              || !assignment.date().equals(date)
              || !"N8".equals(assignment.templateCode())) {
            continue;
          }
          Employee officer = members.stream().filter(e -> e.id().equals(assignment.employeeId())).findFirst().orElse(null);
          if (officer == null || PreferenceTimes.nightVolunteer(officer.pref().timesOfDay())) {
            continue;
          }
          LocalDate checkDate = date;
          Template nightTemplate = templates.get("N8");
          Instant nightStart = date.atTime(nightTemplate.start()).atZone(REGINA).toInstant();
          Employee newer =
              members.stream()
                  .filter(other -> !other.id().equals(officer.id()))
                  .filter(other -> other.seniority().isAfter(officer.seniority()))
                  .filter(other -> !working.contains(other.id()))
                  .filter(other -> works(other, checkDate, pattern8h))
                  .filter(other -> "NIGHT".equals(blockOf.getOrDefault(other.id(), "DAY")))
                  .filter(other -> !PreferenceTimes.nightVolunteer(other.pref().timesOfDay()))
                  // The generator chooses a night GROUP newest-first, not a person per day; a
                  // newer officer who also works nights is not being passed over.
                  .filter(other -> byEmployee.getOrDefault(other.id(), List.of()).stream()
                      .noneMatch(shift -> ShiftKinds.isNight(templates.get(shift.templateCode()))))
                  .filter(other -> effectiveLength(other) == 8)
                  .filter(
                      other ->
                          !verifier
                              .check(
                                  other,
                                  unit,
                                  nightTemplate,
                                  nightStart,
                                  facts.getOrDefault(other.id(), List.of()))
                              .blocked())
                  .findFirst()
                  .orElse(null);
          if (newer != null) {
            held = false;
            check =
                "Not held in "
                    + unit.name()
                    + ": "
                    + officer.name()
                    + " has a night not asked for while "
                    + newer.name()
                    + " could have taken it.";
          }
        }
      }
    }
    long n12Shifts =
        assignments.stream().filter(shift -> "N12".equals(shift.templateCode())).count();
    long n12Officers =
        employees.stream()
            .filter(
                employee ->
                    byEmployee.getOrDefault(employee.id(), List.of()).stream()
                        .anyMatch(shift -> "N12".equals(shift.templateCode())))
            .count();
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("bands", bands);
    result.put("newestFirstHeld", held);
    result.put("check", check);
    result.put("n12Officers", n12Officers);
    result.put("n12NightShifts", n12Shifts);
    if (n12Shifts > 0) {
      result.put(
          "crewNote",
          "D12 and N12 are fixed separate crews; the 120 dataset seeds the newest officers into the"
              + " night crew, so nights are not re-picked day by day.");
    }
    return result;
  }

  private static Map<String, Object> overtimeCard(
      List<Employee> employees, Map<UUID, List<Assignment>> byEmployee) {
    int officersOver = 0;
    double hoursOver = 0;
    for (Employee employee : employees) {
      Map<LocalDate, Double> perPeriod = new LinkedHashMap<>();
      for (Assignment shift : byEmployee.getOrDefault(employee.id(), List.of())) {
        int period = (int) (ChronoUnit.DAYS.between(FROM, shift.date()) / 14);
        perPeriod.merge(
            FROM.plusDays((long) period * 14),
            Duration.between(shift.start(), shift.end()).toMinutes() / 60.0,
            Double::sum);
      }
      boolean over = false;
      for (double hours : perPeriod.values()) {
        if (hours > 80) {
          over = true;
          hoursOver += hours - 80;
        }
      }
      if (over) {
        officersOver++;
      }
    }
    return Map.of(
        "officersOver", officersOver, "hoursOver", round1(hoursOver), "thresholdHours", 80);
  }

  /** U-13 report only: hours per officer averaged over the quarter, not a payroll input (P-01). */
  private static Map<String, Object> quarterHoursCard(
      List<Employee> employees, Map<UUID, List<Assignment>> byEmployee) {
    List<Double> totals = new ArrayList<>();
    for (Employee employee : employees) {
      totals.add(
          byEmployee.getOrDefault(employee.id(), List.of()).stream()
              .mapToDouble(
                  shift -> Duration.between(shift.start(), shift.end()).toMinutes() / 60.0)
              .sum());
    }
    double min = totals.stream().mapToDouble(Double::doubleValue).min().orElse(0);
    double max = totals.stream().mapToDouble(Double::doubleValue).max().orElse(0);
    double avg = totals.stream().mapToDouble(Double::doubleValue).average().orElse(0);
    return Map.of("min", round1(min), "avg", round1(avg), "max", round1(max));
  }

  private static Map<String, Object> weekendsCard(
      List<Employee> employees, Map<UUID, List<Assignment>> byEmployee) {
    List<Integer> counts = new ArrayList<>();
    for (Employee employee : employees) {
      int worked = 0;
      for (Assignment shift : byEmployee.getOrDefault(employee.id(), List.of())) {
        DayOfWeek day = shift.date().getDayOfWeek();
        if (day == DayOfWeek.SATURDAY || day == DayOfWeek.SUNDAY) {
          worked++;
        }
      }
      counts.add(worked);
    }
    int min = counts.stream().mapToInt(Integer::intValue).min().orElse(0);
    int max = counts.stream().mapToInt(Integer::intValue).max().orElse(0);
    double average = counts.stream().mapToInt(Integer::intValue).average().orElse(0);
    return Map.of("min", min, "avg", round1(average), "max", max);
  }

  private static double round1(double value) {
    return Math.round(value * 10.0) / 10.0;
  }

  private static String ruleName(String code) {
    return switch (code) {
      case "U-01" -> "Fewer than 8 hours between shifts";
      case "U-02" -> "Fewer than 12 hours between shifts";
      case "U-03" -> "Less than 12 hours after a 16-hour shift";
      case "U-04" -> "Less than 10 hours after a long extension";
      case "U-05" -> "More than 16 hours in 24";
      case "U-08" -> "More than 7 consecutive days";
      case "U-09" -> "More than 4 consecutive 12-hour shifts";
      case "U-10" -> "More than 4 overnight shifts";
      case "U-11" -> "Too many 16-hour shifts";
      case "U-12" -> "Fewer than 2 days off in 7";
      case "U-14" -> "Week over 48 hours";
      case "U-15" -> "Pay-period overtime";
      case "U-16" -> "8-hour officer on a night shift";
      default -> code;
    };
  }
}
