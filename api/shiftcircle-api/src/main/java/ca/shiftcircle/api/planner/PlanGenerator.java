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
    List<Gap> gaps = new ArrayList<>();

    Map<UUID, List<Employee>> staff = new HashMap<>();
    employees.forEach(employee -> staff.computeIfAbsent(employee.unitId(), k -> new ArrayList<>()).add(employee));
    staff.values().forEach(list -> list.sort(Comparator.comparing(Employee::seniority)));
    Map<UUID, Set<UUID>> nightStaff = nightStaff(units, staff);

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
            Set<UUID> nights = nightStaff.getOrDefault(unit.id(), Set.of());
            for (Employee candidate : orderedCandidates(staff.getOrDefault(unit.id(), List.of()), unit, block, date, assignedToday, pattern8h, nights)) {
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
              warnings.add(
                  new Warning(
                      result.ruleCode(),
                      ruleName(result.ruleCode()),
                      result.message(),
                      unit.code(),
                      chosen.name(),
                      date,
                      template.code()));
            }
          }
        }
        // Everyone whose pattern says they work today is planned, even where the unit is already
        // covered: the default 5/2 officer then works exactly 80 h per period instead of losing
        // shifts to a surplus. A Block rule still skips the day (and the scorecard shows it).
        for (Employee employee : staff.getOrDefault(unit.id(), List.of())) {
          if (assignedToday.contains(employee.id()) || !works(employee, date, pattern8h)) {
            continue;
          }
          String preferredBlock =
              nightStaff.getOrDefault(unit.id(), Set.of()).contains(employee.id())
                  ? "NIGHT"
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
            warnings.add(
                new Warning(
                    warning.ruleCode(),
                    ruleName(warning.ruleCode()),
                    warning.message(),
                    unit.code(),
                    employee.name(),
                    date,
                    template.code()));
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

    Map<String, Object> scorecard =
        scorecard(
            employees, units, assignments, byEmployee, gaps, warnings, pattern8h, started, facts,
            templates, verifier);
    return new Result(assignments, gaps, warnings, scorecard);
  }

  /**
   * The night group per unit: volunteers first (most senior first), then the newest officers until
   * the unit's night requirement, scaled for a 5/2 week, is covered. The group keeps nights all
   * quarter, so a night shift never destroys the next day's pattern and the 80 h property holds.
   */
  private static Map<UUID, Set<UUID>> nightStaff(
      List<Unit> units, Map<UUID, List<Employee>> staff) {
    Map<UUID, Set<UUID>> designated = new HashMap<>();
    for (Unit unit : units) {
      int required = unit.required().getOrDefault("NIGHT", 0);
      if (required <= 0) {
        continue;
      }
      int need = (int) Math.ceil(required * 7.0 / 5.0);
      List<Employee> candidates = new ArrayList<>(staff.getOrDefault(unit.id(), List.of()));
      candidates.removeIf(employee -> effectiveLength(employee) != 8);
      candidates.sort(
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
      Set<UUID> chosen = new LinkedHashSet<>();
      for (Employee employee : candidates) {
        if (chosen.size() >= need) {
          break;
        }
        chosen.add(employee.id());
      }
      designated.put(unit.id(), chosen);
    }
    return designated;
  }

  private static List<Employee> orderedCandidates(
      List<Employee> employees,
      Unit unit,
      String block,
      LocalDate date,
      Set<UUID> assignedToday,
      String pattern8h,
      Set<UUID> nightStaff) {
    List<Employee> candidates = new ArrayList<>();
    for (Employee employee : employees) {
      if (assignedToday.contains(employee.id()) || !works(employee, date, pattern8h)) {
        continue;
      }
      boolean night = nightStaff.contains(employee.id());
      if ("NIGHT".equals(block) != night) {
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
    int pairStart =
        "ROTATING_5_2".equals(pattern8h)
            ? Math.floorMod(phase - period, 7)
            : Math.floorMod(phase, 7);
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
      Verifier verifier) {
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
        "nights",
        nightsCard(
            employees,
            units,
            assignments,
            byEmployee,
            facts,
            templates,
            verifier,
            pattern8h));
    scorecard.put("overtime", overtimeCard(employees, byEmployee));
    scorecard.put("weekends", weekendsCard(employees, byEmployee));
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
      String pattern8h) {
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
                  .filter(other -> !"NIGHT".equals(other.pref().timeOfDay()))
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
