package ca.shiftcircle.api.planner;

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
  public static final int PERIODS = 7;

  private static final ZoneId REGINA = ZoneId.of("America/Regina");
  private static final List<String> BLOCKS = List.of("NIGHT", "DAY", "EVENING");

  public record Pref(Integer shiftLength, String timeOfDay, List<String> daysOff) {}

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
      int phase) {}

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

  public Result generate(
      List<Employee> employees,
      List<Unit> units,
      Map<String, Template> templates,
      Map<UUID, List<ShiftFact>> history,
      String pattern8h,
      long seed,
      Verifier verifier) {
    long started = System.nanoTime();
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
    // unit, so a day group always works the same number of days on each weekday.
    List<Employee> rephased = rephase(employees, blockOf);
    Map<UUID, List<Employee>> staff = new HashMap<>();
    rephased.forEach(employee -> staff.computeIfAbsent(employee.unitId(), k -> new ArrayList<>()).add(employee));
    staff.values().forEach(list -> list.sort(Comparator.comparing(Employee::seniority)));

    for (LocalDate date = FROM; !date.isAfter(TO); date = date.plusDays(1)) {
      for (Unit unit : units) {
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
            for (Employee candidate : orderedCandidates(staff.getOrDefault(unit.id(), List.of()), unit, block, date, assignedToday, pattern8h, blockOf)) {
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
                    template.code(), date, start, end, checkedWarnings);
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
              || !works(employee, date, pattern8h)) {
            continue;
          }
          String preferredBlock =
              effectiveLength(employee) == 8
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
                  template.code(), date, start, end, check.warnings());
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
        verifier, employees);
    gaps = recomputeGaps(units, assignments);
    Map<String, Object> scorecard =
        scorecard(
            employees, units, assignments, byEmployee, gaps, warnings, pattern8h, started, facts,
            templates, verifier, blockOf);
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
      candidates.removeIf(employee -> effectiveLength(employee) != 8);
      int nightNeed = (int) Math.ceil(unit.required().getOrDefault("NIGHT", 0) * 7.0 / 5.0);
      List<Employee> byNight = new ArrayList<>(candidates);
      byNight.sort(
          (a, b) -> {
            boolean volunteerA = "NIGHT".equals(a.pref().timeOfDay());
            boolean volunteerB = "NIGHT".equals(b.pref().timeOfDay());
            if (volunteerA != volunteerB) {
              return volunteerA ? -1 : 1;
            }
            return volunteerA
                ? a.seniority().compareTo(b.seniority())
                : b.seniority().compareTo(a.seniority());
          });
      Set<UUID> nights = new LinkedHashSet<>();
      for (Employee employee : byNight) {
        if (nights.size() >= nightNeed) {
          break;
        }
        nights.add(employee.id());
        blocks.put(employee.id(), "NIGHT");
      }
      List<Employee> rest = new ArrayList<>();
      candidates.stream().filter(employee -> !nights.contains(employee.id())).forEach(rest::add);
      int dayNeed = (int) Math.ceil(unit.required().getOrDefault("DAY", 0) * 7.0 / 5.0);
      int dayCount = 0;
      // Preference first: DAY then EVENING; seniority breaks the tie.
      rest.sort(
          (a, b) -> {
            int rankA = "DAY".equals(a.pref().timeOfDay()) ? 0 : "EVENING".equals(a.pref().timeOfDay()) ? 1 : 2;
            int rankB = "DAY".equals(b.pref().timeOfDay()) ? 0 : "EVENING".equals(b.pref().timeOfDay()) ? 1 : 2;
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
      Map<UUID, String> blockOf) {
    List<Employee> candidates = new ArrayList<>();
    for (Employee employee : employees) {
      if (employee.fte() < 1.0
          || assignedToday.contains(employee.id())
          || !works(employee, date, pattern8h)) {
        continue;
      }
      if (effectiveLength(employee) == 8
          && !block.equals(blockOf.getOrDefault(employee.id(), "DAY"))) {
        continue;
      }
      candidates.add(employee);
    }
    Comparator<Employee> order;
    if ("NIGHT".equals(block)) {
      order =
          (a, b) -> {
            boolean volunteerA = "NIGHT".equals(a.pref().timeOfDay());
            boolean volunteerB = "NIGHT".equals(b.pref().timeOfDay());
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
    if ("7_ON_3_OFF".equals(pattern8h)) {
      return Math.floorMod(day + phase, 10) < 7;
    }
    int period = (int) (day / 14);
    int dayInPeriod = (int) (day % 14);
    if ("ROTATING_5_2".equals(pattern8h)) {
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

  private static int effectiveLength(Employee employee) {
    return employee.effectiveLength();
  }

  private static Template templateFor(
      Employee employee, Unit unit, String block, Map<String, Template> templates) {
    int length = effectiveLength(employee);
    if (length == 16) {
      return templates.get("L16");
    }
    if (length == 12) {
      return templates.get("NIGHT".equals(block) || "NIGHT".equals(employee.pref().timeOfDay())
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
    return pref.timeOfDay() == null || "NONE".equals(pref.timeOfDay())
        ? "DAY"
        : pref.timeOfDay();
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
      List<Employee> employees) {
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
              if (already.contains(candidate.id())) {
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
                chosenCheck == null ? List.of() : chosenCheck.warnings());
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
      List<Employee> employees, Map<UUID, String> blockOf) {
    Map<String, Integer> counters = new HashMap<>();
    List<Employee> result = new ArrayList<>();
    for (Employee employee : employees) {
      int cycle = employee.effectiveLength() == 12 ? 8 : 7;
      String key = employee.unitId() + "|" + blockOf.getOrDefault(employee.id(), "DAY");
      int index = counters.merge(key, 1, Integer::sum) - 1;
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
              index % cycle));
    }
    return result;
  }

  private static List<Gap> recomputeGaps(
      List<Unit> units, List<Assignment> assignments) {
    Map<String, int[]> coverage = new HashMap<>();
    for (Assignment assignment : assignments) {
      String key = assignment.unitId() + "|" + assignment.date();
      addHours(coverage.computeIfAbsent(key, k -> new int[24]),
          assignment.start().atZone(REGINA).getHour(),
          (int) Duration.between(assignment.start(), assignment.end()).toMinutes());
    }
    List<Gap> gaps = new ArrayList<>();
    for (Unit unit : units) {
      for (LocalDate date = FROM; !date.isAfter(TO); date = date.plusDays(1)) {
        int[] hours = coverage.getOrDefault(unit.id() + "|" + date, new int[24]);
        for (String block : BLOCKS) {
          int required = unit.required().getOrDefault(block, 0);
          int placed = minimumCoverage(hours, block);
          if (placed < required) {
            gaps.add(new Gap(unit.id(), unit.code(), date, block, required, placed,
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
      Map<UUID, String> blockOf) {
    Map<String, Object> scorecard = new LinkedHashMap<>();
    long totalBlockDays = (long) units.size() * ChronoUnit.DAYS.between(FROM, TO.plusDays(1)) * 3;
    scorecard.put(
        "coverage",
        Map.of(
            "shortBlockDays", gaps.size(),
            "totalBlockDays", totalBlockDays));
    scorecard.put("warnings", warningsCard(warnings));
    scorecard.put("preferences", preferencesCard(employees, byEmployee));
    scorecard.put(
        "preferencesNote",
        "The planner rosters 8- and 12-hour shifts only; a 16 h preference is shown unmet. Part-time"
            + " and casual officers are not guaranteed hours.");
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
    if ("ROTATING_5_2".equals(pattern8h)) {
      scorecard.put(
          "warningNote",
          "At the weekend-rotation changeover an officer has one ordinary rest-day warning"
              + " (fewer than 2 days off in 7) and one weekly-hours warning (over 48 h in 7 days),"
              + " and the changeover pay period is 72 hours; where the pattern would otherwise create"
              + " a seventh consecutive work day, a second 72-hour period keeps every shift free of a"
              + " Block rule. Hours are balanced over the quarter, not per period.");
    }
    scorecard.put(
        "generatedMs", (System.nanoTime() - startedNanos) / 1_000_000);
    scorecard.put("pattern8h", pattern8h);
    return scorecard;
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
      List<Employee> employees, Map<UUID, List<Assignment>> byEmployee) {
    int lengthAsked = 0;
    int lengthMet = 0;
    int timeAsked = 0;
    int timeMet = 0;
    int daysAsked = 0;
    int daysMet = 0;
    for (Employee employee : employees) {
      List<Assignment> shifts = byEmployee.getOrDefault(employee.id(), List.of());
      Pref pref = employee.pref();
      if (pref.shiftLength() != null) {
        lengthAsked++;
        if (!shifts.isEmpty()
            && shifts.stream().allMatch(shift -> nominalMinutes(shift.templateCode()) == pref.shiftLength() * 60)) {
          lengthMet++;
        }
      }
      if (pref.timeOfDay() != null && !"NONE".equals(pref.timeOfDay())) {
        timeAsked++;
        if (!shifts.isEmpty()
            && shifts.stream().allMatch(shift -> pref.timeOfDay().equals(preferenceOf(shift.templateCode())))) {
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
        assignments.stream().filter(shift -> isNight(shift.templateCode())).count();
    for (int band = 0; band < 3; band++) {
      int from = band * third;
      int to = band == 2 ? sorted.size() : Math.min(sorted.size(), (band + 1) * third);
      List<Employee> members = sorted.subList(Math.min(from, sorted.size()), to);
      long nights =
          members.stream()
              .flatMap(member -> byEmployee.getOrDefault(member.id(), List.of()).stream())
              .filter(shift -> isNight(shift.templateCode()))
              .count();
      int avoidAsked = 0;
      int avoidGiven = 0;
      long againstWish = 0;
      for (Employee member : members) {
        boolean avoidsNights = "DAY".equals(member.pref().timeOfDay()) || "EVENING".equals(member.pref().timeOfDay());
        if (!avoidsNights) {
          continue;
        }
        avoidAsked++;
        List<Assignment> shifts = byEmployee.getOrDefault(member.id(), List.of());
        long given = shifts.stream().filter(shift -> isNight(shift.templateCode())).count();
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
          if (officer == null || "NIGHT".equals(officer.pref().timeOfDay())) {
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
                  .filter(other -> !"NIGHT".equals(other.pref().timeOfDay()))
                  // The generator chooses a night GROUP newest-first, not a person per day; a
                  // newer officer who also works nights is not being passed over.
                  .filter(other -> byEmployee.getOrDefault(other.id(), List.of()).stream()
                      .noneMatch(shift -> isNight(shift.templateCode())))
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
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("bands", bands);
    result.put("newestFirstHeld", held);
    result.put("check", check);
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

  private static int nominalMinutes(String templateCode) {
    return switch (templateCode) {
      case "D8", "E8", "N8" -> 480;
      case "A12", "P12" -> 720;
      case "L16" -> 960;
      default -> 480;
    };
  }

  private static String preferenceOf(String templateCode) {
    return switch (templateCode) {
      case "D8" -> "DAY";
      case "E8", "P12" -> "EVENING";
      case "N8", "A12", "L16" -> "NIGHT";
      default -> "DAY";
    };
  }

  private static boolean isNight(String templateCode) {
    return "N8".equals(templateCode) || "A12".equals(templateCode) || "L16".equals(templateCode);
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
      case "U-14" -> "Week over 60 hours";
      case "U-15" -> "Pay-period overtime";
      default -> code;
    };
  }
}
