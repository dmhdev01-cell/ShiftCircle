package ca.shiftcircle.rules;

import ca.shiftcircle.rules.model.RuleRow;
import ca.shiftcircle.rules.model.RuleSet;
import ca.shiftcircle.rules.model.RuleTableCode;
import ca.shiftcircle.rules.model.TemplateColumns;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.drools.template.ObjectDataCompiler;
import org.kie.api.KieBase;
import org.kie.api.builder.Message.Level;
import org.kie.api.builder.Results;
import org.kie.api.io.ResourceType;
import org.kie.internal.utils.KieHelper;

/**
 * Compiles a rule set (templates plus rows) into a {@link KieBase}.
 *
 * <p>This is the path the publish pipeline uses: templates are developer-owned, rows are data. A
 * compilation error surfaces as {@link RuleCompilationException} so the admin screen can translate
 * it into "row 3, column Minimum rest: must be a number".
 */
public final class RuleSetCompiler {

  /** Generates the DRL source for a template and its rows, without compiling it. */
  public String generateDrl(InputStream template, Collection<Map<String, Object>> rows) {
    return new ObjectDataCompiler().compile(rows, template);
  }

  /** Compiles every fireable row of the rule set, grouped by decision table. */
  public KieBase compile(RuleSet ruleSet) {
    Map<RuleTableCode, List<Map<String, Object>>> rowsByTable = new EnumMap<>(RuleTableCode.class);
    for (RuleRow row : ruleSet.rows()) {
      if (TemplateColumns.fireable(row)) {
        rowsByTable
            .computeIfAbsent(row.table(), table -> new ArrayList<>())
            .add(TemplateColumns.of(row));
      }
    }

    KieHelper helper = new KieHelper();
    rowsByTable.forEach(
        (table, rows) -> {
          String drl;
          try (InputStream template = open(table.templateResource())) {
            drl = generateDrl(template, rows);
          } catch (java.io.IOException e) {
            throw new RuleCompilationException("Rule template could not be read: " + table.code());
          }
          helper.addContent(drl, ResourceType.DRL);
        });

    Results results = helper.verify();
    if (results.hasMessages(Level.ERROR)) {
      throw new RuleCompilationException(
          "Rule set " + ruleSet.version() + " did not compile: " + results.getMessages());
    }

    KieBase kieBase = helper.build();
    if (kieBase == null) {
      throw new RuleCompilationException("Rule base could not be built for " + ruleSet.version());
    }
    return kieBase;
  }

  private InputStream open(String resource) {
    InputStream stream = RuleSetCompiler.class.getResourceAsStream(resource);
    if (stream == null) {
      throw new RuleCompilationException("Rule template not found on classpath: " + resource);
    }
    return stream;
  }
}
