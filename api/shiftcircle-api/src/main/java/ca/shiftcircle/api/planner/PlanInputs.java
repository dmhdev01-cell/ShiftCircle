package ca.shiftcircle.api.planner;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/**
 * What the quarter generator works from (PR-M "Plan inputs"). Built from the very lists
 * {@link PlannerService} hands to {@link PlanGenerator} (loadUnits, loadEmployees, the planned
 * leave and the unit availability), so the screen cannot drift from the generator: there is no
 * second query for officers. Counts only, never a name or an employee number.
 *
 * <p>The payload keeps an {@code options} object for the generate options (seed, 8 h pattern);
 * new tailoring options are added there, not as new top-level keys.
 */
final class PlanInputs {

  private static final List<String> BLOCKS = List.of("NIGHT", "DAY", "EVENING");

  private PlanInputs() {}

  /** One planned-leave day as the generator sees it: an officer is unavailable on a date. */
  record LeaveDay(UUID employeeId, LocalDate date, String type) {}

  static Map<String, Object> build(
      LocalDate from,
      LocalDate to,
      int periods,
      List<PlanGenerator.Unit> units,
      List<PlanGenerator.Employee> employees,
      List<LeaveDay> leaveDays,
      PlanGenerator.Availability availability,
      int ruleSetVersion,
      Integer neededFte,
      Map<String, Object> options) {
    Map<String, Object> inputs = new LinkedHashMap<>();
    inputs.put("window", Map.of("from", from.toString(), "to", to.toString(), "periods", periods));
    inputs.put("options", options);

    int fullTime = 0;
    int partTime = 0;
    double fte = 0;
    LocalDate earliest = null;
    LocalDate latest = null;
    for (PlanGenerator.Employee employee : employees) {
      if (employee.fte() >= 1.0) {
        fullTime++;
      } else {
        partTime++;
      }
      fte += employee.fte();
      earliest =
          earliest == null || employee.seniority().isBefore(earliest) ? employee.seniority() : earliest;
      latest = latest == null || employee.seniority().isAfter(latest) ? employee.seniority() : latest;
    }
    Map<String, Object> officers = new LinkedHashMap<>();
    officers.put("total", employees.size());
    officers.put("fullTime", fullTime);
    officers.put("partTime", partTime);
    officers.put("fte", round1(fte));
    officers.put("neededFte", neededFte);
    officers.put(
        "units",
        (int) employees.stream().map(PlanGenerator.Employee::unitId).distinct().count());
    inputs.put("officers", officers);

    // Unit x employment x pattern, in unit code order, then the groups in a fixed order.
    List<Map<String, Object>> unitRows = new ArrayList<>();
    for (PlanGenerator.Unit unit : units) {
      List<PlanGenerator.Employee> members =
          employees.stream().filter(employee -> employee.unitId().equals(unit.id())).toList();
      Map<String, Map<String, Object>> groups = new TreeMap<>();
      for (PlanGenerator.Employee employee : members) {
        String employment = employee.fte() >= 1.0 ? "FULL_TIME" : "PART_TIME";
        String pattern = patternKey(employee);
        String key = (employment.equals("FULL_TIME") ? "0" : "1") + patternOrder(pattern) + pattern;
        Map<String, Object> group =
            groups.computeIfAbsent(
                key,
                ignored -> {
                  Map<String, Object> row = new LinkedHashMap<>();
                  row.put("employment", employment);
                  row.put("hours", employee.effectiveLength());
                  row.put("pattern", pattern);
                  row.put("patternWords", patternWords(pattern));
                  row.put("officers", 0);
                  row.put("fte", 0.0);
                  return row;
                });
        group.put("officers", (int) group.get("officers") + 1);
        group.put("fte", round1((double) group.get("fte") + employee.fte()));
      }
      Map<String, Integer> minimums = new LinkedHashMap<>();
      for (String block : BLOCKS) {
        minimums.put(block, unit.required().getOrDefault(block, 0));
      }
      int closedDays = 0;
      for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
        if (!availability.active(unit.id(), date)) {
          closedDays++;
        }
      }
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("code", unit.code());
      row.put("name", unit.name());
      row.put("allows12h", unit.allows12h());
      row.put("officers", members.size());
      row.put("fullTime", (int) members.stream().filter(e -> e.fte() >= 1.0).count());
      row.put("partTime", (int) members.stream().filter(e -> e.fte() < 1.0).count());
      row.put("fte", round1(members.stream().mapToDouble(PlanGenerator.Employee::fte).sum()));
      row.put("minimums", minimums);
      row.put("closedDays", closedDays);
      row.put("groups", new ArrayList<>(groups.values()));
      unitRows.add(row);
    }
    inputs.put("units", unitRows);

    Map<UUID, PlanGenerator.Employee> byId = new LinkedHashMap<>();
    employees.forEach(employee -> byId.put(employee.id(), employee));
    Map<String, Integer> leaveByType = new LinkedHashMap<>();
    for (String type : List.of("VACATION", "SICK", "OTHER")) {
      leaveByType.put(type, 0);
    }
    java.util.Set<UUID> onLeave = new java.util.HashSet<>();
    int leaveTotal = 0;
    for (LeaveDay day : leaveDays) {
      if (!byId.containsKey(day.employeeId())) {
        continue;
      }
      leaveTotal++;
      onLeave.add(day.employeeId());
      leaveByType.merge(day.type(), 1, Integer::sum);
    }
    Map<String, Object> leave = new LinkedHashMap<>();
    leave.put("days", leaveTotal);
    leave.put("officers", onLeave.size());
    leave.put("byType", leaveByType);
    inputs.put("leave", leave);

    Map<String, Integer> lengths = new TreeMap<>();
    Map<String, Integer> times = new LinkedHashMap<>();
    for (String time : List.of("DAY", "EVENING", "NIGHT")) {
      times.put(time, 0);
    }
    int withAny = 0;
    int withDaysOff = 0;
    int withLength = 0;
    int withTimes = 0;
    for (PlanGenerator.Employee employee : employees) {
      PlanGenerator.Pref pref = employee.pref();
      boolean hasLength = pref.shiftLength() != null;
      boolean hasTimes = pref.timesOfDay() != null && !pref.timesOfDay().isEmpty();
      boolean hasDaysOff = pref.daysOff() != null && !pref.daysOff().isEmpty();
      if (hasLength) {
        withLength++;
        lengths.merge(String.valueOf(pref.shiftLength()), 1, Integer::sum);
      }
      if (hasTimes) {
        withTimes++;
        pref.timesOfDay().forEach(time -> times.merge(time, 1, Integer::sum));
      }
      if (hasDaysOff) {
        withDaysOff++;
      }
      if (hasLength || hasTimes || hasDaysOff) {
        withAny++;
      }
    }
    Map<String, Object> preferences = new LinkedHashMap<>();
    preferences.put("officers", withAny);
    preferences.put("shiftLengthOfficers", withLength);
    preferences.put("shiftLength", lengths);
    preferences.put("timesOfDayOfficers", withTimes);
    preferences.put("timesOfDay", times);
    preferences.put("daysOffOfficers", withDaysOff);
    inputs.put("preferences", preferences);

    Map<String, Object> seniority = new LinkedHashMap<>();
    seniority.put("earliest", earliest == null ? null : earliest.toString());
    seniority.put("latest", latest == null ? null : latest.toString());
    inputs.put("seniority", seniority);

    Map<String, Object> rules = new LinkedHashMap<>();
    rules.put("ruleSetVersion", ruleSetVersion);
    rules.put("historyDays", 35);
    rules.put("fillOrder", fillOrder(ruleSetVersion));
    inputs.put("rules", rules);
    return inputs;
  }

  /**
   * The generator's real order (PlanGenerator.generate, casualPool, reliefPool), in plain words.
   * Keep in step with the code: a change to the order changes this list and docs/user-guide.
   */
  static List<String> fillOrder(int ruleSetVersion) {
    return List.of(
        "Day by day and unit by unit, in the order night, day, evening, full-time officers whose"
            + " rotation has them on that day fill the unit's minimum. Only 12 h officers work"
            + " nights: those who asked for nights first (most senior first), then the newest."
            + " Day and evening go first to officers whose preferred time matches, then by"
            + " seniority. An 8 h officer keeps one block, day or evening, all quarter.",
        "Every other full-time officer whose rotation has them on that day is then rostered too,"
            + " even above the minimum, so a full-time officer works their full rotation.",
        "Part-time and casual officers (under 1.0 FTE) then fill what is still short, in their"
            + " home unit only, newest first, up to their FTE × 80 h in each pay period.",
        "Where a unit is closed on a day, its full-time officers may fill another unit's"
            + " remaining shortage (by home unit, then seniority).",
        "Every proposed shift is checked by the rules engine (rule set v"
            + ruleSetVersion
            + ") against the officer's last 35 days of shifts: a Block skips that officer, a"
            + " warning is kept and counted. Planned leave days are never rostered. Anything"
            + " still short is a gap for a supervisor.");
  }

  /** The rotation group an officer is planned in, from the same fields the generator reads. */
  static String patternKey(PlanGenerator.Employee employee) {
    String crew = employee.crew();
    if (crew != null && crew.startsWith("CASUAL_")) {
      return employee.effectiveLength() == 12 ? "CASUAL_12" : "CASUAL_8";
    }
    if (crew != null) {
      for (String code : List.of("N12", "D12", "D8", "E8")) {
        if (crew.startsWith(code)) {
          return code;
        }
      }
    }
    if (employee.effectiveLength() == 12) {
      return "12H";
    }
    return PlanGenerator.patternOf(employee, null);
  }

  private static String patternOrder(String pattern) {
    return switch (pattern) {
      case "D12" -> "0";
      case "N12" -> "1";
      case "12H" -> "2";
      case "D8" -> "3";
      case "E8" -> "4";
      case "ROTATING_5_2" -> "5";
      case "5_ON_2_OFF" -> "6";
      case "7_ON_3_OFF" -> "7";
      case "CASUAL_12" -> "8";
      default -> "9";
    };
  }

  static String patternWords(String pattern) {
    return switch (pattern) {
      case "D12" -> "12 h day crew, 4 on, 4 off";
      case "N12" -> "12 h night crew, 4 on, 4 off";
      case "12H" -> "12 h, 4 on, 4 off";
      case "D8" -> "8 h day crew";
      case "E8" -> "8 h evening crew";
      case "CASUAL_12" -> "12 h relief pool, no fixed rotation";
      case "CASUAL_8" -> "8 h relief pool, no fixed rotation";
      default -> {
        String words = PlanGenerator.patternWords(pattern);
        yield "8 h, " + Character.toLowerCase(words.charAt(0)) + words.substring(1);
      }
    };
  }

  private static double round1(double value) {
    return Math.round(value * 10.0) / 10.0;
  }
}
