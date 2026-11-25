package ca.shiftcircle.rules;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ca.shiftcircle.rules.build.PostEligibilityFactBuilder;
import ca.shiftcircle.rules.build.ShiftFact;
import ca.shiftcircle.rules.facts.PostEligibilityFact;
import ca.shiftcircle.rules.facts.RuleOutcome;
import ca.shiftcircle.rules.facts.RuleResult;
import ca.shiftcircle.rules.model.OverridePolicy;
import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.model.RuleSet;
import ca.shiftcircle.rules.model.RuleTableCode;
import ca.shiftcircle.rules.rows.RuleRowsV1;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.kie.api.KieBase;

/**
 * Release v1.3 S2, owner item 17: who can work a post (R-01, R-02), as the owner approved it. A
 * supervisor post needs a supervisor (an officer is blocked with no override, an acting officer is
 * a warning); a supervisor on an officer post is a warning; nobody else is affected.
 */
class PostEligibilityRulesTest {

  private static PostEligibilityFact fact(String position, String unitKind, String... held) {
    ShiftFact shift = RuleTestSupport.shift("E-001", "D12", "2027-01-04", "07:00", 720);
    return new PostEligibilityFactBuilder().build(shift, position, Set.of(held), unitKind);
  }

  private static List<RuleResult> posts(KieBase base, PostEligibilityFact fact) {
    return new RuleEvaluator().evaluate(base, RuleRowsV1.VERSION, fact).stream()
        .filter(result -> result.ruleTable().equals("POSTS"))
        .toList();
  }

  private static List<RuleResult> posts(PostEligibilityFact fact) {
    return posts(RuleTestSupport.v1RuleBase(), fact);
  }

  @Test
  void theShippedRowsAreTheOwnersAnswers() {
    RuleRow r01 = RuleRowsV1.r01();
    assertThat(r01.table()).isEqualTo(RuleTableCode.POSTS);
    assertThat(r01.severity()).isEqualTo(RuleOutcome.BLOCK);
    assertThat(r01.overridePolicy()).isEqualTo(OverridePolicy.NONE);
    assertThat(r01.params())
        .containsEntry("postKind", "SUPERVISION")
        .containsEntry("allowedPositions", List.of("CS"))
        .containsEntry("actingQualification", "ACTING_SUP");
    RuleRow r02 = RuleRowsV1.r02();
    assertThat(r02.severity()).isEqualTo(RuleOutcome.WARN);
    assertThat(r02.overridePolicy()).isEqualTo(OverridePolicy.ACKNOWLEDGE);
    assertThat(r02.params()).containsEntry("postKind", "LINE");
  }

  @Test
  void anOfficerOnASupervisorPostIsBlockedWithNoOverride() {
    List<RuleResult> results = posts(fact("CO", "SUPERVISION"));
    assertThat(results).singleElement().satisfies(result -> {
      assertThat(result.ruleId()).isEqualTo("R-01");
      assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK);
      assertThat(result.overridePolicy()).isEqualTo(OverridePolicy.NONE);
      assertThat(result.evidence()).contains("an officer").contains("a supervisor post");
    });
  }

  @Test
  void anActingOfficerOnASupervisorPostIsAWarningToAcknowledge() {
    List<RuleResult> results = posts(fact("CO", "SUPERVISION", "ACTING_SUP", "FIRST_AID"));
    assertThat(results).singleElement().satisfies(result -> {
      assertThat(result.ruleId()).isEqualTo("R-01");
      assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN);
      assertThat(result.overridePolicy()).isEqualTo(OverridePolicy.ACKNOWLEDGE);
      assertThat(result.evidence()).contains("Acting supervisor");
    });
  }

  @Test
  void aSupervisorOnAnOfficerPostIsAWarningToAcknowledge() {
    List<RuleResult> results = posts(fact("CS", "LIVING"));
    assertThat(results).singleElement().satisfies(result -> {
      assertThat(result.ruleId()).isEqualTo("R-02");
      assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN);
      assertThat(result.overridePolicy()).isEqualTo(OverridePolicy.ACKNOWLEDGE);
    });
    // Every kind that is not SUPERVISION is an officer post.
    assertThat(posts(fact("CS", "CONTROL"))).extracting(RuleResult::ruleId).containsExactly("R-02");
  }

  @Test
  void aSupervisorOnASupervisorPostAndAnOfficerOnAnOfficerPostPass() {
    assertThat(posts(fact("CS", "SUPERVISION"))).isEmpty();
    assertThat(posts(fact("CO", "LIVING"))).isEmpty();
    assertThat(posts(fact("CO", "ESCORT", "ACTING_SUP"))).isEmpty();
  }

  @Test
  void theActingQualificationNeverSoftensTheOfficerPostWarning() {
    // R-02 has no acting column; a supervisor who holds ACTING_SUP is still warned.
    assertThat(posts(fact("CS", "LIVING", "ACTING_SUP")))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.WARN));
  }

  @Test
  void aDisabledRowDoesNotFireAndAnEditedRowFollowsItsValues() {
    List<RuleRow> rows = new ArrayList<>();
    for (RuleRow row : RuleRowsV1.ruleSet().rows()) {
      if (row.code().equals("R-01")) {
        rows.add(new RuleRow(row.code(), row.table(), false, row.params(), row.severity(),
            row.overridePolicy(), row.message(), row.source(), row.placeholder(), row.sortOrder()));
      } else if (row.code().equals("R-02")) {
        // An admin turns the officer-post warning into a block.
        rows.add(new RuleRow(row.code(), row.table(), true, row.params(), RuleOutcome.BLOCK,
            OverridePolicy.EMERGENCY, row.message(), row.source(), row.placeholder(),
            row.sortOrder()));
      } else {
        rows.add(row);
      }
    }
    KieBase edited = new RuleSetCompiler().compile(new RuleSet("edited", rows));
    assertThat(posts(edited, fact("CO", "SUPERVISION"))).isEmpty();
    assertThat(posts(edited, fact("CS", "LIVING")))
        .singleElement()
        .satisfies(result -> assertThat(result.outcome()).isEqualTo(RuleOutcome.BLOCK));
  }

  @Test
  void aHostilePositionCannotReachTheDrl() {
    RuleRow hostile =
        new RuleRow("R-01", RuleTableCode.POSTS, true,
            Map.of("postKind", "SUPERVISION", "allowedPositions", List.of("CS\") || true || (\"")),
            RuleOutcome.BLOCK, OverridePolicy.NONE, "x", "test", true, 210);
    assertThatThrownBy(() -> new RuleSetCompiler().compile(new RuleSet("hostile", List.of(hostile))))
        .isInstanceOf(RuleCompilationException.class);
  }
}
