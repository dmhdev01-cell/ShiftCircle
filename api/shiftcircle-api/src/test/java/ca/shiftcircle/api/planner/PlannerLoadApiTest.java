package ca.shiftcircle.api.planner;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.api.PostgresTestSupport;
import ca.shiftcircle.domain.Position;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * What the generator reads about an officer and a unit (release v1.3, S1): the position, the
 * seniority inside the rank and the unit's kind.
 *
 * <p>The demo data is off, so this is a database with the seeded units and the officers this test
 * inserts. A rank the api does not know must not stop the planner: the rank table is the source of
 * truth and can hold a rank a later release adds.
 */
@SpringBootTest(properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class PlannerLoadApiTest {

  private static final UUID UNIT_A = UUID.fromString("11111111-1111-1111-1111-000000000001");

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    PostgresTestSupport.register(registry);
  }

  @Autowired private JdbcTemplate jdbc;
  @Autowired private PlannerService planner;

  @Test
  void thePlannerReadsThePositionThePromotionDateAndTheUnitKind() {
    insertEmployee("E-SUP", "CS", LocalDate.of(2004, 1, 1), LocalDate.of(2018, 3, 1));
    insertEmployee("E-OFF", "CO", LocalDate.of(2016, 5, 2), null);

    List<PlanGenerator.Unit> units = planner.loadUnits();
    List<PlanGenerator.Employee> employees = planner.loadEmployees(units);

    PlanGenerator.Employee supervisor = byNo(employees, "E-SUP");
    assertThat(supervisor.position()).isEqualTo(Position.CS);
    assertThat(supervisor.seniority()).isEqualTo(LocalDate.of(2004, 1, 1));
    // Seniority inside the rank: the promotion date when there is one.
    assertThat(supervisor.rankSeniority()).isEqualTo(LocalDate.of(2018, 3, 1));

    PlanGenerator.Employee officer = byNo(employees, "E-OFF");
    assertThat(officer.position()).isEqualTo(Position.CO);
    // No promotion date: the seniority inside the rank is the service date.
    assertThat(officer.rankSeniority()).isEqualTo(officer.seniority());

    PlanGenerator.Unit unitA =
        units.stream().filter(unit -> unit.code().equals("A")).findFirst().orElseThrow();
    assertThat(unitA.kind()).isEqualTo("LIVING");
    assertThat(unitA.isSupervision()).isFalse();
  }

  @Test
  void aRankTheApiDoesNotKnowDoesNotStopThePlanner() {
    jdbc.update(
        "INSERT INTO position (code, name, rank_order, is_supervisory)"
            + " VALUES ('LT', 'Lieutenant', 3, true)");
    insertEmployee("E-LT", "LT", LocalDate.of(2019, 1, 1), null);

    List<PlanGenerator.Unit> units = planner.loadUnits();
    List<PlanGenerator.Employee> employees = planner.loadEmployees(units);

    // The officer is loaded, and the rank this build does not know is the lowest non-supervisory
    // one: the planner treats them as an officer, never as a supervisor it cannot reason about.
    PlanGenerator.Employee lieutenant = byNo(employees, "E-LT");
    assertThat(lieutenant.position()).isEqualTo(Position.CO);
    assertThat(lieutenant.position().isSupervisory()).isFalse();
  }

  private void insertEmployee(
      String employeeNo, String classification, LocalDate seniority, LocalDate positionSince) {
    jdbc.update(
        "INSERT INTO employee (employee_no, first_name, last_name, classification, home_unit_id,"
            + " seniority_date, position_since) VALUES (?, 'Test', ?, ?, ?, ?, ?)",
        employeeNo + "-" + UUID.randomUUID(),
        employeeNo,
        classification,
        UNIT_A,
        java.sql.Date.valueOf(seniority),
        positionSince == null ? null : java.sql.Date.valueOf(positionSince));
  }

  private static PlanGenerator.Employee byNo(List<PlanGenerator.Employee> employees, String no) {
    return employees.stream()
        .filter(employee -> employee.employeeNo().startsWith(no + "-"))
        .findFirst()
        .orElseThrow(() -> new AssertionError("no officer " + no + " was loaded"));
  }
}
