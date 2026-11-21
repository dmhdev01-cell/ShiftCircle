package ca.shiftcircle.api.demo;

import ca.shiftcircle.infrastructure.demo.DemoChecksum;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * The "120" planner-demo dataset: the 100 full-time crews from DATASET120-SPEC plus a 20-officer
 * casual relief pool (option B). It runs only after the reset's Flyway clean+migrate, so the schema
 * is empty and deterministic. The 100 dataset is untouched; this provider sets ADM/ESC 12 h
 * agreements and seeds its own crews, history, qualifications and preferences.
 */
@Component
@Profile("demo")
@ConditionalOnProperty(name = "sc.demo.generate", havingValue = "true", matchIfMissing = true)
public class Demo120DatasetProvider implements DemoDatasetProvider {

  public static final String DATASET = "120";
  /** Option B. The person's A=50 or C=0 is a one-line change; total = 100 + CASUAL_COUNT. */
  public static final int CASUAL_COUNT = 20;

  private static final java.time.ZoneId REGINA = java.time.ZoneId.of("America/Regina");
  private static final LocalDate ANCHOR = LocalDate.of(2027, 1, 4);
  private static final LocalDate HISTORY_FROM = ANCHOR.minusDays(35);
  private static final LocalDate HISTORY_TO = ANCHOR.minusDays(1);

  private final JdbcTemplate jdbc;

  public Demo120DatasetProvider(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public String dataset() {
    return DATASET;
  }

  @Override
  public String seed() {
    return "20261001";
  }

  @Override
  public void seedData() {
    Integer existing =
        jdbc.queryForObject("SELECT count(*) FROM employee", Integer.class);
    if (existing != null && existing > 0) {
      return;
    }
    jdbc.update("UPDATE unit SET allows_12h = true WHERE code IN ('ADM','ESC')");

    Map<String, UUID> units = new LinkedHashMap<>();
    jdbc.query(
        "SELECT code, id FROM unit",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs -> units.put(rs.getString("code"), rs.getObject("id", UUID.class)));
    Map<String, UUID> patterns = insertPatterns();
    Map<String, UUID> templates = new LinkedHashMap<>();
    Map<String, LocalTime> starts = new LinkedHashMap<>();
    jdbc.query(
        "SELECT code, id, start_time FROM shift_template",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs -> {
              templates.put(rs.getString("code"), rs.getObject("id", UUID.class));
              starts.put(rs.getString("code"), rs.getTime("start_time").toLocalTime());
            });
    Map<String, UUID> qualifications = new LinkedHashMap<>();
    jdbc.query(
        "SELECT code, id FROM qualification",
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs -> qualifications.put(rs.getString("code"), rs.getObject("id", UUID.class)));

    List<Crew> crews = new ArrayList<>();
    crews.add(new Crew("A", "N12_NIGHT_4ON4OFF", 12, "NIGHT", 8));
    crews.add(new Crew("A", "D12_DAY_4ON4OFF", 12, "DAY", 10));
    crews.add(new Crew("A", "E8_EVENING_5ON2OFF", 8, "EVENING", 1));
    crews.add(new Crew("B", "N12_NIGHT_4ON4OFF", 12, "NIGHT", 8));
    crews.add(new Crew("B", "D12_DAY_4ON4OFF", 12, "DAY", 10));
    crews.add(new Crew("B", "E8_EVENING_5ON2OFF", 8, "EVENING", 1));
    crews.add(new Crew("C", "N12_NIGHT_4ON4OFF", 12, "NIGHT", 8));
    crews.add(new Crew("C", "D12_DAY_4ON4OFF", 12, "DAY", 10));
    crews.add(new Crew("ADM", "N12_NIGHT_4ON4OFF", 12, "NIGHT", 4));
    crews.add(new Crew("ADM", "D12_DAY_4ON4OFF", 12, "DAY", 6));
    crews.add(new Crew("ADM", "E8_EVENING_5ON2OFF", 8, "EVENING", 1));
    crews.add(new Crew("CTL", "N12_NIGHT_4ON4OFF", 12, "NIGHT", 6));
    crews.add(new Crew("CTL", "D12_DAY_4ON4OFF", 12, "DAY", 6));
    crews.add(new Crew("ESC", "N12_NIGHT_4ON4OFF", 12, "NIGHT", 4));
    crews.add(new Crew("ESC", "D12_DAY_4ON4OFF", 12, "DAY", 12));
    // Facility relief: 3 N12 and 2 D12, counted inside the 100.
    crews.add(new Crew("A", "N12_NIGHT_RELIEF", 12, "NIGHT", 1));
    crews.add(new Crew("B", "N12_NIGHT_RELIEF", 12, "NIGHT", 1));
    crews.add(new Crew("ESC", "N12_NIGHT_RELIEF", 12, "NIGHT", 1));
    crews.add(new Crew("A", "D12_DAY_RELIEF", 12, "DAY", 1));
    crews.add(new Crew("ESC", "D12_DAY_RELIEF", 12, "DAY", 1));

    List<Person> fullTime = new ArrayList<>();
    Map<String, Integer> crewCounts = new LinkedHashMap<>();
    int sequence = 0;
    for (Crew crew : crews) {
      for (int index = 0; index < crew.count(); index++) {
        sequence++;
        int crewIndex = crewCounts.merge(crew.unit() + "|" + crew.crew(), 1, Integer::sum) - 1;
        Person person =
            insertPerson(
                sequence,
                crew,
                units,
                patterns,
                qualifications,
                1.0,
                crewIndex);
        fullTime.add(person);
      }
    }
    int casual12 = CASUAL_COUNT * 2 / 5;
    int casual8 = CASUAL_COUNT - casual12;
    List<Person> casuals = new ArrayList<>();
    String[] unitCodes = {"A", "B", "C", "ADM", "CTL", "ESC"};
    for (int index = 0; index < CASUAL_COUNT; index++) {
      String unit = unitCodes[index % unitCodes.length];
      boolean twelve = index < casual12;
      Crew crew =
          new Crew(
              unit,
              twelve ? "CASUAL_12" : "CASUAL_8",
              twelve ? 12 : 8,
              twelve ? "NIGHT" : "DAY",
              0);
      sequence++;
      Person person =
          insertPerson(
              sequence,
              crew,
              units,
              patterns,
              qualifications,
              0.4 + (index % 5) * 0.1,
              index);
      casuals.add(person);
    }

    // Three 16 h preferences and 10% deliberate mismatches; the crew still drives placement.
    for (int index = 0; index < fullTime.size(); index += 10) {
      Person person = fullTime.get(index);
      jdbc.update(
          "UPDATE officer_preference SET time_of_day = ? WHERE employee_id = ?",
          "N12_NIGHT_4ON4OFF".equals(person.crew()) ? "DAY" : "NIGHT",
          person.id());
    }
    for (int index : new int[] {0, 8, 19}) {
      jdbc.update(
          "UPDATE officer_preference SET shift_length = 16 WHERE employee_id = ?",
          fullTime.get(index).id());
    }

    seedHistory(fullTime, units, templates, starts);
    seedPeriods(units);
    selfCheck(fullTime, casuals, units);
  }

  @Override
  public String checksum() {
    return DemoChecksum.of(jdbc);
  }

  private Map<String, UUID> insertPatterns() {
    Map<String, UUID> patterns = new LinkedHashMap<>();
    pattern(patterns, "D12_DAY_4ON4OFF", 8, "D12", 4, 4);
    pattern(patterns, "N12_NIGHT_4ON4OFF", 8, "N12", 4, 4);
    pattern(patterns, "D8_DAY_5ON2OFF", 7, "D8", 5, 2);
    pattern(patterns, "E8_EVENING_5ON2OFF", 7, "E8", 5, 2);
    pattern(patterns, "N12_NIGHT_RELIEF", 8, "N12", 4, 4);
    pattern(patterns, "D12_DAY_RELIEF", 8, "D12", 4, 4);
    pattern(patterns, "CASUAL_12", 1, "N12", 0, 0);
    pattern(patterns, "CASUAL_8", 1, "D8", 0, 0);
    return patterns;
  }

  private void pattern(
      Map<String, UUID> patterns, String code, int cycle, String template, int on, int off) {
    UUID id = UUID.nameUUIDFromBytes(("120:pattern:" + code).getBytes());
    String json =
        "{\"template\":\"" + template + "\",\"on\":" + on + ",\"off\":" + off
            + ",\"anchor\":\"2027-01-04\"}";
    jdbc.update(
        "INSERT INTO rotation_pattern (id, code, name, cycle_days, pattern, anchor_date)"
            + " VALUES (?, ?, ?, ?, ?::jsonb, DATE '2027-01-04')",
        id, code, code, cycle, json);
    patterns.put(code, id);
  }

  private Person insertPerson(
      int sequence,
      Crew crew,
      Map<String, UUID> units,
      Map<String, UUID> patterns,
      Map<String, UUID> qualifications,
      double fte,
      int crewIndex) {
    UUID id = UUID.nameUUIDFromBytes(("120:employee:" + sequence).getBytes());
    String no = String.format("120-%04d", sequence);
    LocalDate seniority;
    if (crew.crew().startsWith("N12")) {
      seniority = LocalDate.of(2022, 1, 1).plusDays(crewIndex * 37L);
    } else if (crew.crew().startsWith("D12")) {
      seniority = LocalDate.of(2012, 1, 1).plusDays(crewIndex * 23L);
    } else if (crew.crew().startsWith("E8")) {
      seniority = LocalDate.of(2008, 1, 1).plusDays(crewIndex * 17L);
    } else {
      seniority = LocalDate.of(2016, 1, 1).plusDays(crewIndex * 29L);
    }
    jdbc.update(
        "INSERT INTO employee (id, employee_no, first_name, last_name, classification,"
            + " home_unit_id, rotation_pattern_id, fte, seniority_date, active, is_synthetic)"
            + " VALUES (?, ?, ?, ?, 'CO', ?, ?, ?, ?, true, true)",
        id,
        no,
        "First" + sequence,
        "Last" + sequence,
        units.get(crew.unit()),
        patterns.get(crew.crew()),
        fte,
        seniority);
    jdbc.update(
        "INSERT INTO officer_preference (employee_id, shift_length, time_of_day, days_off)"
            + " VALUES (?, ?, ?, '{}')",
        id,
        crew.length(),
        crew.time());
    String qualification = qualificationFor(crew, crewIndex, sequence);
    if (qualification != null) {
      jdbc.update(
          "INSERT INTO employee_qualification (employee_id, qualification_id, valid_from)"
              + " SELECT ?, ?, DATE '2026-01-01'",
          id,
          qualifications.get(qualification));
    }
    return new Person(id, no, crew.unit(), crew.crew(), crew.length(), crew.time(), crewIndex);
  }

  private String qualificationFor(Crew crew, int crewIndex, int sequence) {
    if ("CTL".equals(crew.unit())) {
      return "CONTROL";
    }
    if ("ESC".equals(crew.unit())) {
      return "ESCORT";
    }
    if (!List.of("A", "B", "C").contains(crew.unit())) {
      return null;
    }
    if (crew.crew().startsWith("N12") || crew.crew().startsWith("D12")) {
      return crewIndex < 2 ? "FIRST_AID" : null;
    }
    if (crew.crew().startsWith("E8")) {
      return "FIRST_AID";
    }
    return sequence % 4 == 0 ? "FIRST_AID" : null;
  }

  private void seedHistory(
      List<Person> fullTime,
      Map<String, UUID> units,
      Map<String, UUID> templates,
      Map<String, LocalTime> starts) {
    Map<String, Integer> crewIndexes = new LinkedHashMap<>();
    for (Person person : fullTime) {
      String key = person.unit() + "|" + person.crew();
      int index = crewIndexes.merge(key, 1, Integer::sum) - 1;
      int phase;
      if (person.crew().startsWith("N12") || person.crew().startsWith("D12")) {
        phase = Math.floorMod(index / 2 + (index % 2) * 4, 8);
      } else {
        phase = index % 7;
      }
      for (LocalDate date = HISTORY_FROM; !date.isAfter(HISTORY_TO); date = date.plusDays(1)) {
        long day = ChronoUnit.DAYS.between(ANCHOR, date);
        boolean on =
            person.crew().startsWith("N12") || person.crew().startsWith("D12")
                ? Math.floorMod(day + phase, 8) < 4
                : Math.floorMod(day + phase, 7) < 5;
        if (!on) {
          continue;
        }
        String template = templateFor(person);
        LocalTime start = starts.get(template);
        java.time.Instant startAt = date.atTime(start).atZone(REGINA).toInstant();
        java.time.Instant endAt =
            startAt.plusSeconds(template.startsWith("D12") || template.startsWith("N12") ? 12 * 3600L : 8 * 3600L);
        jdbc.update(
            "INSERT INTO shift_assignment (id, employee_id, unit_id, shift_template_id, start_at,"
                + " end_at, work_date, kind, source, status)"
                + " VALUES (?, ?, ?, ?, ?, ?, ?, 'ROSTERED', 'ROTATION', 'PLANNED')",
            UUID.nameUUIDFromBytes(("120:history:" + person.no() + ":" + date).getBytes()),
            person.id(),
            units.get(person.unit()),
            templates.get(template),
            java.sql.Timestamp.from(startAt),
            java.sql.Timestamp.from(endAt),
            java.sql.Date.valueOf(date));
      }
    }
  }

  private static String templateFor(Person person) {
    if (person.crew().startsWith("N12") || "CASUAL_12".equals(person.crew())) {
      return "N12";
    }
    if (person.crew().startsWith("D12")) {
      return "D12";
    }
    if (person.crew().startsWith("E8")) {
      return "E8";
    }
    return "D8";
  }

  private void seedPeriods(Map<String, UUID> units) {
    // Match the 100 seed's layout: the last seeded period is 21 Dec - 3 Jan, so the planner's
    // first 2027 period (4-17 Jan) starts cleanly and cannot overlap a seeded one.
    LocalDate[] starts = {
      LocalDate.of(2026, 11, 23), LocalDate.of(2026, 12, 7), LocalDate.of(2026, 12, 21)
    };
    for (LocalDate start : starts) {
      LocalDate end = start.plusDays(13);
      UUID pay = UUID.nameUUIDFromBytes(("120:pay:" + start).getBytes());
      jdbc.update(
          "INSERT INTO pay_period (id, start_date, end_date, status)"
              + " VALUES (?, ?, ?, 'OPEN')",
          pay, start, end);
      for (Map.Entry<String, UUID> unit : units.entrySet()) {
        jdbc.update(
            "INSERT INTO schedule_period (id, unit_id, start_date, end_date, status)"
                + " VALUES (?, ?, ?, ?, 'DRAFT')",
            UUID.nameUUIDFromBytes(("120:period:" + unit.getKey() + ":" + start).getBytes()),
            unit.getValue(),
            start,
            end);
      }
    }
  }

  private void selfCheck(
      List<Person> fullTime, List<Person> casuals, Map<String, UUID> units) {
    if (fullTime.size() != 100) {
      throw new IllegalStateException("120 dataset: expected 100 full-time, got " + fullTime.size());
    }
    if (casuals.size() != CASUAL_COUNT) {
      throw new IllegalStateException(
          "120 dataset: expected " + CASUAL_COUNT + " casuals, got " + casuals.size());
    }
    long n12 = fullTime.stream().filter(p -> p.crew().equals("N12_NIGHT_4ON4OFF")).count();
    long d12 = fullTime.stream().filter(p -> p.crew().equals("D12_DAY_4ON4OFF")).count();
    long e8 = fullTime.stream().filter(p -> p.crew().equals("E8_EVENING_5ON2OFF")).count();
    long reliefN12 = fullTime.stream().filter(p -> p.crew().equals("N12_NIGHT_RELIEF")).count();
    long reliefD12 = fullTime.stream().filter(p -> p.crew().equals("D12_DAY_RELIEF")).count();
    if (n12 != 38 || d12 != 54 || e8 != 3 || reliefN12 != 3 || reliefD12 != 2) {
      throw new IllegalStateException(
          "120 dataset crews N12=" + n12 + " D12=" + d12 + " E8=" + e8
              + " reliefN12=" + reliefN12 + " reliefD12=" + reliefD12);
    }
    Integer flags =
        jdbc.queryForObject(
            "SELECT count(*) FROM unit WHERE code IN ('ADM','ESC') AND allows_12h",
            Integer.class);
    if (flags == null || flags != 2) {
      throw new IllegalStateException("120 dataset: ADM/ESC 12 h agreements missing");
    }
    Integer l16 =
        jdbc.queryForObject(
            "SELECT count(*) FROM shift_assignment a JOIN shift_template t"
                + " ON t.id = a.shift_template_id WHERE t.code IN ('L16','N8')",
            Integer.class);
    if (l16 != null && l16 > 0) {
      throw new IllegalStateException("120 dataset: L16/N8 history is not allowed");
    }
    Integer ctl =
        jdbc.queryForObject(
            "SELECT count(*) FROM employee e JOIN unit u ON u.id = e.home_unit_id"
                + " WHERE u.code = 'CTL' AND NOT EXISTS (SELECT 1 FROM employee_qualification q"
                + " JOIN qualification z ON z.id = q.qualification_id"
                + " WHERE q.employee_id = e.id AND z.code = 'CONTROL')",
            Integer.class);
    Integer esc =
        jdbc.queryForObject(
            "SELECT count(*) FROM employee e JOIN unit u ON u.id = e.home_unit_id"
                + " WHERE u.code = 'ESC' AND NOT EXISTS (SELECT 1 FROM employee_qualification q"
                + " JOIN qualification z ON z.id = q.qualification_id"
                + " WHERE q.employee_id = e.id AND z.code = 'ESCORT')",
            Integer.class);
    if ((ctl != null && ctl > 0) || (esc != null && esc > 0)) {
      throw new IllegalStateException("120 dataset: CTL/ESC qualifications incomplete");
    }
  }

  private record Crew(String unit, String crew, int length, String time, int count) {}

  private record Person(
      UUID id, String no, String unit, String crew, int length, String time, int crewIndex) {}
}
