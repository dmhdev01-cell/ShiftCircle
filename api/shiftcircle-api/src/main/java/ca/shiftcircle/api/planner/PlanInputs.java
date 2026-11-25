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
 * new tailoring options are added there, not as new top-level keys, and {@link #fillOrder} takes
 * the same object so an option that changes the order also changes the words.
 */
final class PlanInputs {

  private static final List<String> BLOCKS = List.of("NIGHT", "DAY", "EVENING");

  private PlanInputs() {}

  /** One planned-leave day as the generator sees it: an officer is unavailable on a date. */
  record LeaveDay(UUID employeeId, LocalDate date, String type) {}

  /**
   * The staffing floor for the quarter: the stretch between unit closures that needs the most
   * officers, the earliest such stretch on a tie ({@code periods} stretches in all; one when no
   * unit closes, so it is then the whole quarter).
   */
  record Needed(int fte, LocalDate from, LocalDate to, int periods) {}

  /** Picks {@link Needed} from the Staffing card's untruncated periods; null when there are none. */
  static Needed needed(List<ca.shiftcircle.api.units.UnitsViews.StaffingPeriod> periods) {
    ca.shiftcircle.api.units.UnitsViews.StaffingPeriod neediest = null;
    for (ca.shiftcircle.api.units.UnitsViews.StaffingPeriod period : periods) {
      int more = neediest == null ? 1 : period.totals().needed() - neediest.totals().needed();
      if (more > 0 || (more == 0 && period.from().isBefore(neediest.from()))) {
        neediest = period;
      }
    }
    return neediest == null
        ? null
        : new Needed(neediest.totals().needed(), neediest.from(), neediest.to(), periods.size());
  }

  static Map<String, Object> build(
      LocalDate from,
      LocalDate to,
      int periods,
      List<PlanGenerator.Unit> units,
      List<PlanGenerator.Employee> employees,
      List<LeaveDay> leaveDays,
      PlanGenerator.Availability availability,
      int ruleSetVersion,
      Needed needed,
      Map<String, Object> options) {
    String pattern8h = options.get("pattern8h") instanceof String forced ? forced : null;
    Map<String, Object> inputs = new LinkedHashMap<>();
    Map<String, Object> window = new LinkedHashMap<>();
    window.put("from", from.toString());
    window.put("to", to.toString());
    window.put("periods", periods);
    inputs.put("window", window);
    inputs.put("options", options);

    int fullTime = 0;
    int partTime = 0;
    double fte = 0;
    double partTimeFte = 0;
    LocalDate earliest = null;
    LocalDate latest = null;
    for (PlanGenerator.Employee employee : employees) {
      if (employee.fte() >= 1.0) {
        fullTime++;
      } else {
        partTime++;
        partTimeFte += employee.fte();
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
    // PR-N: so a full-time-only draft can say how many officers and FTE it actually plans with.
    officers.put("partTimeFte", round1(partTimeFte));
    officers.put("neededFte", needed == null ? null : needed.fte());
    officers.put("neededFrom", needed == null ? null : needed.from().toString());
    officers.put("neededTo", needed == null ? null : needed.to().toString());
    officers.put("neededPeriods", needed == null ? 0 : needed.periods());
    // Every unit the generator plans, the same rows as the table below (a unit with no officers
    // is still planned: its minimums become gaps).
    officers.put("units", units.size());
    // Release v1.3: the position dimension. The totals above count everyone the generator plans;
    // byPosition splits them by rank, and the units by kind (a supervisor post is a unit of kind
    // SUPERVISION). The two ranks are always listed, so the shape does not depend on the data.
    List<Map<String, Object>> byPosition = new ArrayList<>();
    for (ca.shiftcircle.domain.Position position : ca.shiftcircle.domain.Position.values()) {
      List<PlanGenerator.Employee> members =
          employees.stream().filter(employee -> employee.position() == position).toList();
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("position", position.code());
      row.put("supervisory", position.isSupervisory());
      row.put("total", members.size());
      row.put("fullTime", (int) members.stream().filter(e -> e.fte() >= 1.0).count());
      row.put("partTime", (int) members.stream().filter(e -> e.fte() < 1.0).count());
      row.put("fte", round1(members.stream().mapToDouble(PlanGenerator.Employee::fte).sum()));
      byPosition.add(row);
    }
    officers.put("byPosition", byPosition);
    int supervisors = (int) employees.stream().filter(PlanGenerator.Employee::isSupervisor).count();
    int posts = (int) units.stream().filter(PlanGenerator.Unit::isSupervision).count();
    officers.put("lineUnits", units.size() - posts);
    officers.put("posts", posts);
    officers.put(
        "headline", headline(employees.size() - supervisors, supervisors, units.size() - posts, posts));
    inputs.put("officers", officers);

    // Unit x employment x pattern, in unit code order, then the groups in a fixed order.
    List<Map<String, Object>> unitRows = new ArrayList<>();
    for (PlanGenerator.Unit unit : units) {
      List<PlanGenerator.Employee> members =
          employees.stream().filter(employee -> employee.unitId().equals(unit.id())).toList();
      Map<String, Map<String, Object>> groups = new TreeMap<>();
      for (PlanGenerator.Employee employee : members) {
        String employment = employee.fte() >= 1.0 ? "FULL_TIME" : "PART_TIME";
        String pattern = patternKey(employee, pattern8h);
        // A supervisor's group sorts after the officers' (only a mis-homed supervisor shares a
        // unit with officers; the planner places neither across ranks).
        String key =
            (employee.isSupervisor() ? "S" : "")
                + (employment.equals("FULL_TIME") ? "0" : "1")
                + patternOrder(pattern)
                + pattern;
        Map<String, Object> group =
            groups.computeIfAbsent(
                key,
                ignored -> {
                  Map<String, Object> row = new LinkedHashMap<>();
                  row.put("position", employee.position().code());
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
      row.put("kind", unit.kind());
      row.put("supervision", unit.isSupervision());
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
    rules.put("historyDays", PlanGenerator.HISTORY_DAYS);
    rules.put("fillOrder", fillOrder(ruleSetVersion, options));
    inputs.put("rules", rules);
    return inputs;
  }

  /**
   * The generator's real order (PlanGenerator.generate, casualPool, reliefPool), in plain words,
   * for the options the draft was generated with. This is the one place the order is worded. The
   * Generate options (PR-N) add or replace their steps here, keyed on their values: staffTypes
   * without PART_TIME replaces the part-time step, crossUnitFill ON adds the cross-unit step after
   * closed-unit relief, partTimeFill UP_TO_FTE adds the top-up step after that. Keep in step with
   * the code and docs/user-guide/planner.md.
   */
  static List<String> fillOrder(int ruleSetVersion, Map<String, Object> options) {
    List<String> steps = new ArrayList<>();
    steps.add(
        "Day by day and unit by unit, in the order night, day, evening, full-time officers whose"
            + " rotation has them on that day fill the unit's minimum. Only 12 h officers work"
            + " nights: those who asked for nights first (most senior first), then the newest."
            + " Day and evening go first to officers whose preferred time matches, then by"
            + " seniority. An 8 h officer keeps one block, day or evening, all quarter.");
    steps.add(
        "Every other full-time officer whose rotation has them on that day is then rostered too,"
            + " even above the minimum, so a full-time officer works their full rotation.");
    boolean partTime =
        !(options.get("staffTypes") instanceof List<?> types) || types.contains("PART_TIME");
    if (partTime) {
      steps.add(
          "Part-time and casual officers (under 1.0 FTE) then fill what is still short, in their"
              + " home unit only, newest first, up to their FTE × 80 h in each pay period.");
    } else {
      steps.add(
          "Part-time and casual officers (under 1.0 FTE) are left out of this draft (Staff to"
              + " include: full-time officers only): they are counted here but get no shifts.");
    }
    steps.add(
        "Where a unit is closed on a day, its full-time officers may fill another unit's"
            + " remaining shortage (by home unit, then seniority).");
    if ("ON".equals(options.get("crossUnitFill"))) {
      steps.add(
          "Each gap still open is then offered to officers homed in another unit who hold the"
              + " block's qualification (first aid, Control or Escort, where the unit asks for"
              + " one) and have hours left under FTE × 80 h in the pay period, the lowest share"
              + " of their target first, then the newest; a Block skips that officer, and the"
              + " roster marks them \"From\" their unit.");
    }
    if (partTime && "UP_TO_FTE".equals(options.get("partTimeFill"))) {
      steps.add(
          "Each part-time officer is then given shifts above the minimum in their home unit"
              + " where cover is thinnest, up to FTE × 80 h in each pay period, spread evenly"
              + " through the period.");
    }
    steps.add(
        "Every proposed shift is checked by the rules engine (rule set v"
            + ruleSetVersion
            + ") against the officer's last "
            + PlanGenerator.HISTORY_DAYS
            + " days of shifts: a Block skips that officer, a warning is kept and counted."
            + " Planned leave days are never rostered. Anything still short is a gap for a"
            + " supervisor.");
    return List.copyOf(steps);
  }

  /**
   * "150 officers in 6 units", or with supervisors "150 officers + 12 supervisors in 6 units + 2
   * supervisor posts" (release v1.3).
   */
  static String headline(int officers, int supervisors, int lineUnits, int posts) {
    StringBuilder line = new StringBuilder();
    line.append(officers).append(officers == 1 ? " officer" : " officers");
    if (supervisors > 0) {
      line.append(" + ").append(supervisors).append(supervisors == 1 ? " supervisor" : " supervisors");
    }
    line.append(" in ").append(lineUnits).append(lineUnits == 1 ? " unit" : " units");
    if (posts > 0) {
      line.append(" + ").append(posts).append(posts == 1 ? " supervisor post" : " supervisor posts");
    }
    return line.toString();
  }

  /** The rotation group an officer is planned in, from the same fields the generator reads. */
  static String patternKey(PlanGenerator.Employee employee, String pattern8h) {
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
    // The draft's forced 8 h pattern (the one-release override) wins, exactly as in works().
    return PlanGenerator.patternOf(employee, pattern8h);
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
