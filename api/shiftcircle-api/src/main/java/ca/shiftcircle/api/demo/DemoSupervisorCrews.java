package ca.shiftcircle.api.demo;

import ca.shiftcircle.infrastructure.demo.DemoNames;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The supervisors of Datasets 120 and 150 (release v1.3, S4; docs/10-testing.md §6.4). They are seeded after every officer row, with their own
 * numbers ({@code 120-S001…}, which sort after the officers'), their own ids and, on 150, their own
 * Random, so the officers' rows, names and phases are byte-identical to the pre-supervisor dataset.
 *
 * <p>Per post: two D12 and two N12 4-on/4-off crew supervisors and one relief (N12 relief on
 * SUP-L, D12 relief on SUP-O), so each post has one supervisor on every block of every day. Dataset
 * 150 adds a D8 5-on/2-off day supervisor on SUP-L and a 0.6 FTE part-time supervisor on SUP-O,
 * 20% leave for the full-time supervisors and a planted vacation week for M. Ellis in February.
 *
 * <p>M. Ellis is the first SUP-L day supervisor and J. Chen the first SUP-O day supervisor; their
 * sign-ins are linked to the records, so My schedule shows their shifts.
 */
final class DemoSupervisorCrews {

  static final ZoneId REGINA = ZoneId.of("America/Regina");
  static final LocalDate ANCHOR = LocalDate.of(2027, 1, 4);
  private static final LocalDate HISTORY_FROM = ANCHOR.minusDays(35);
  private static final LocalDate HISTORY_TO = ANCHOR.minusDays(1);

  /** The supervisors' own leave stream: the officers' seed XOR the plan's "0x5u9" salt. */
  static final long LEAVE_SEED = 150_2026L ^ 0x509L;

  /** M. Ellis's planted vacation week on Dataset 150 (Mon 8 – Sun 14 Feb 2027). */
  static final LocalDate ELLIS_VACATION_FROM = LocalDate.of(2027, 2, 8);

  record Crew(String post, String crew, int length, String time, int count, double fte) {}

  record Supervisor(
      UUID id, String no, String post, String crew, int length, double fte, int crewIndex) {}

  private final JdbcTemplate jdbc;
  private final String dataset;

  DemoSupervisorCrews(JdbcTemplate jdbc, String dataset) {
    this.jdbc = jdbc;
    this.dataset = dataset;
  }

  static List<Crew> crews(boolean with150Extras) {
    List<Crew> crews = new ArrayList<>();
    crews.add(new Crew("SUP-L", "D12_DAY_4ON4OFF", 12, "DAY", 2, 1.0));
    crews.add(new Crew("SUP-L", "N12_NIGHT_4ON4OFF", 12, "NIGHT", 2, 1.0));
    crews.add(new Crew("SUP-L", "N12_NIGHT_RELIEF", 12, "NIGHT", 1, 1.0));
    crews.add(new Crew("SUP-O", "D12_DAY_4ON4OFF", 12, "DAY", 2, 1.0));
    crews.add(new Crew("SUP-O", "N12_NIGHT_4ON4OFF", 12, "NIGHT", 2, 1.0));
    crews.add(new Crew("SUP-O", "D12_DAY_RELIEF", 12, "DAY", 1, 1.0));
    if (with150Extras) {
      crews.add(new Crew("SUP-L", "D8_DAY_5ON2OFF", 8, "DAY", 1, 1.0));
      crews.add(new Crew("SUP-O", "CASUAL_12", 12, "NIGHT", 1, 0.6));
    }
    return crews;
  }

  /**
   * Seeds the supervisors, their preferences, their 35 days of history and (on 150) their leave,
   * links the two demo sign-ins and checks the result. Returns the supervisors in number order.
   */
  List<Supervisor> seed(
      boolean with150Extras,
      Map<String, UUID> units,
      Map<String, UUID> patterns,
      Map<String, UUID> templates,
      Map<String, LocalTime> starts) {
    if (!units.containsKey("SUP-L") || !units.containsKey("SUP-O")) {
      // A schema without the posts (before V19) has no supervisors to seed.
      return List.of();
    }
    Set<String> usedNames =
        new HashSet<>(
            jdbc.queryForList("SELECT first_name || ' ' || last_name FROM employee", String.class));
    List<Supervisor> supervisors = new ArrayList<>();
    Map<String, Integer> crewCounts = new LinkedHashMap<>();
    int number = 0;
    for (Crew crew : crews(with150Extras)) {
      for (int index = 0; index < crew.count(); index++) {
        number++;
        int crewIndex = crewCounts.merge(crew.post() + "|" + crew.crew(), 1, Integer::sum) - 1;
        supervisors.add(insert(number, crew, crewIndex, units, patterns, usedNames));
      }
    }
    seedHistory(supervisors, units, templates, starts);
    if (with150Extras) {
      seedLeave(supervisors);
    }
    link("m.ellis", firstDaySupervisor(supervisors, "SUP-L"));
    link("j.chen", firstDaySupervisor(supervisors, "SUP-O"));
    check(with150Extras ? 12 : 10);
    return supervisors;
  }

  private Supervisor insert(
      int number,
      Crew crew,
      int crewIndex,
      Map<String, UUID> units,
      Map<String, UUID> patterns,
      Set<String> usedNames) {
    UUID id = UUID.nameUUIDFromBytes((dataset + ":supervisor:" + number).getBytes());
    String no = String.format("120-S%03d", number);
    String first;
    String last;
    if (number == 1) {
      first = "Morgan";
      last = "Ellis";
    } else if (number == 6) {
      first = "Jamie";
      last = "Chen";
    } else {
      // A fixed walk through the name lists that never lands on an officer's name or on a second
      // Ellis or Chen; deterministic because the officers' names are.
      int step = 0;
      do {
        first = DemoNames.FIRST_NAMES.get((7 * number + 3 + step) % DemoNames.FIRST_NAMES.size());
        last = DemoNames.LAST_NAMES.get((11 * number + 5 + step) % DemoNames.LAST_NAMES.size());
        step++;
      } while (usedNames.contains(first + " " + last) || "Chen".equals(last));
    }
    usedNames.add(first + " " + last);
    // Service 2004-2016 and promotion 2018-2025: distinct and always after the service date.
    LocalDate seniority = LocalDate.of(2004, 1, 1).plusDays((number - 1) * 400L);
    LocalDate positionSince = LocalDate.of(2018, 1, 1).plusDays((number - 1) * 250L);
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, classification,"
            + " position_since, home_unit_id, rotation_pattern_id, fte, seniority_date, active,"
            + " is_synthetic, shift_pattern)"
            + " VALUES (?, ?, ?, ?, 'CS', ?, ?, ?, ?, ?, true, true, 'ROTATING_5_2')",
        id,
        no,
        first,
        last,
        positionSince,
        units.get(crew.post()),
        patterns.get(crew.crew()),
        crew.fte(),
        seniority);
    jdbc.update(
        connection -> {
          var statement =
              connection.prepareStatement(
                  "INSERT INTO officer_preference (employee_id, shift_length, times_of_day, days_off)"
                      + " VALUES (?, ?, ?, '{}')");
          statement.setObject(1, id);
          statement.setInt(2, crew.length());
          statement.setArray(3, connection.createArrayOf("text", new String[] {crew.time()}));
          return statement;
        });
    return new Supervisor(id, no, crew.post(), crew.crew(), crew.length(), crew.fte(), crewIndex);
  }

  /** The same 35 days of crew history as the officers, so the planner reads the same phases. */
  private void seedHistory(
      List<Supervisor> supervisors,
      Map<String, UUID> units,
      Map<String, UUID> templates,
      Map<String, LocalTime> starts) {
    for (Supervisor supervisor : supervisors) {
      if (supervisor.fte() < 1.0) {
        continue;
      }
      boolean twelve = supervisor.length() == 12;
      int index = supervisor.crewIndex();
      int phase = twelve ? Math.floorMod(index / 2 + (index % 2) * 4, 8) : index % 7;
      String template =
          supervisor.crew().startsWith("N12") ? "N12" : supervisor.crew().startsWith("D12") ? "D12" : "D8";
      for (LocalDate date = HISTORY_FROM; !date.isAfter(HISTORY_TO); date = date.plusDays(1)) {
        long day = ChronoUnit.DAYS.between(ANCHOR, date);
        boolean on =
            twelve ? Math.floorMod(day + phase, 8) < 4 : Math.floorMod(day + phase, 7) < 5;
        if (!on) {
          continue;
        }
        java.time.Instant startAt = date.atTime(starts.get(template)).atZone(REGINA).toInstant();
        java.time.Instant endAt = startAt.plusSeconds(supervisor.length() * 3600L);
        jdbc.update(
            "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
                + " end_at, work_date, kind, source, status)"
                + " VALUES (?, ?, ?, ?, ?, ?, ?, 'ROSTERED', 'ROTATION', 'PLANNED')",
            UUID.nameUUIDFromBytes(
                (dataset + ":history:" + supervisor.no() + ":" + date).getBytes()),
            supervisor.id(),
            units.get(supervisor.post()),
            templates.get(template),
            java.sql.Timestamp.from(startAt),
            java.sql.Timestamp.from(endAt),
            java.sql.Date.valueOf(date));
      }
    }
  }

  /**
   * Dataset 150: the full-time supervisors get the officers' 20% leave placement, drawn from their
   * own Random so the officers' leave stays byte-identical, and M. Ellis has a planted vacation
   * week in February so the relief story shows. The part-time supervisor has none (fill pool).
   */
  private void seedLeave(List<Supervisor> supervisors) {
    Random random = new Random(LEAVE_SEED);
    LocalDate from = ANCHOR;
    LocalDate to = LocalDate.of(2027, 4, 11);
    int days = (int) ChronoUnit.DAYS.between(from, to) + 1;
    int target = (int) Math.round(0.20 * days);
    int[] spans = {1, 2, 3, 7, 10, 14};
    for (Supervisor supervisor : supervisors) {
      if (supervisor.fte() < 1.0) {
        continue;
      }
      Set<Integer> taken = new HashSet<>();
      if (supervisor.no().equals("120-S001")) {
        int start = (int) ChronoUnit.DAYS.between(from, ELLIS_VACATION_FROM);
        for (int offset = 0; offset < 7; offset++) {
          taken.add(start + offset);
          absence(supervisor, from.plusDays(start + offset), "VACATION");
        }
      }
      while (taken.size() < target) {
        int remaining = target - taken.size();
        int span = Math.min(spans[random.nextInt(spans.length)], remaining);
        int start = random.nextInt(days - span + 1);
        boolean free = true;
        for (int offset = 0; offset < span; offset++) {
          if (taken.contains(start + offset)) {
            free = false;
            break;
          }
        }
        if (!free) {
          continue;
        }
        for (int offset = 0; offset < span; offset++) {
          taken.add(start + offset);
          absence(supervisor, from.plusDays(start + offset), span >= 5 ? "VACATION" : "SICK");
        }
      }
    }
  }

  private void absence(Supervisor supervisor, LocalDate date, String type) {
    jdbc.update(
        "INSERT INTO absence (employee_id, type, start_at, end_at) VALUES (?, ?, ?, ?)",
        supervisor.id(),
        type,
        java.sql.Timestamp.from(date.atStartOfDay(REGINA).toInstant()),
        java.sql.Timestamp.from(date.plusDays(1).atStartOfDay(REGINA).toInstant()));
  }

  /** The post's first D12 day-crew supervisor: M. Ellis on SUP-L, J. Chen on SUP-O. */
  private static Supervisor firstDaySupervisor(List<Supervisor> supervisors, String post) {
    return supervisors.stream()
        .filter(s -> post.equals(s.post()) && "D12_DAY_4ON4OFF".equals(s.crew()) && s.crewIndex() == 0)
        .findFirst()
        .orElseThrow(() -> new IllegalStateException(post + " has no day-crew supervisor"));
  }

  private void link(String username, Supervisor supervisor) {
    jdbc.update(
        "UPDATE app_user SET employee_id = ? WHERE username = ?", supervisor.id(), username);
  }

  /**
   * The supervisor self-check: the expected head count, nobody on the wrong kind of post, every
   * post block-hour of the history covered, and both demo sign-ins linked.
   */
  private void check(int expected) {
    Integer supervisors =
        jdbc.queryForObject(
            "SELECT count(*) FROM employee WHERE classification = 'CS'", Integer.class);
    if (supervisors == null || supervisors != expected) {
      throw new IllegalStateException(
          dataset + " dataset: expected " + expected + " supervisors, got " + supervisors);
    }
    Integer crossed =
        jdbc.queryForObject(
            "SELECT count(*) FROM shift_assignment s JOIN employee e ON e.id = s.employee_id"
                + " JOIN unit u ON u.id = s.unit_id"
                + " WHERE (u.kind = 'SUPERVISION') <> (e.classification = 'CS')",
            Integer.class);
    if (crossed != null && crossed > 0) {
      throw new IllegalStateException(
          dataset + " dataset: " + crossed + " shifts on the wrong kind of post");
    }
    // Every hour of the history on both posts has a supervisor (D12 07-19 plus N12 19-07).
    Integer uncovered =
        jdbc.queryForObject(
            "SELECT count(*) FROM unit u CROSS JOIN generate_series(?::timestamptz,"
                + " ?::timestamptz - interval '1 hour', interval '1 hour') AS h(at)"
                + " WHERE u.kind = 'SUPERVISION' AND NOT EXISTS (SELECT 1 FROM shift_assignment s"
                + "   WHERE s.unit_id = u.id AND s.start_at <= h.at AND s.end_at > h.at)",
            Integer.class,
            java.sql.Timestamp.from(HISTORY_FROM.atTime(7, 0).atZone(REGINA).toInstant()),
            java.sql.Timestamp.from(HISTORY_TO.atTime(7, 0).atZone(REGINA).toInstant()));
    if (uncovered != null && uncovered > 0) {
      throw new IllegalStateException(
          dataset + " dataset: " + uncovered + " supervisor post hours uncovered in the history");
    }
    Integer linked =
        jdbc.queryForObject(
            "SELECT count(*) FROM app_user a JOIN employee e ON e.id = a.employee_id"
                + " WHERE a.username IN ('m.ellis', 'j.chen') AND e.classification = 'CS'",
            Integer.class);
    if (linked == null || linked != 2) {
      throw new IllegalStateException(dataset + " dataset: the demo supervisors are not linked");
    }
  }
}
