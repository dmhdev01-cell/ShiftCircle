package ca.shiftcircle.rules;

import java.io.InputStream;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.drools.template.ObjectDataCompiler;
import org.kie.api.builder.Message.Level;
import org.kie.api.builder.Results;
import org.kie.api.io.ResourceType;
import org.kie.api.KieBase;
import org.kie.internal.utils.KieHelper;

/**
 * Compiles a Drools rule template plus its data rows into a {@link KieBase}.
 *
 * <p>This is the path the rules publish pipeline uses: templates are developer-owned, rows are
 * data. Compilation errors are surfaced as {@link RuleCompilationException} so the admin screen can
 * translate them into "row 3, column Minimum rest: must be a number".
 */
public final class RuleSetCompiler {

  /** Generates the DRL source for a template and its rows, without compiling it. */
  public String generateDrl(InputStream template, Collection<Map<String, Object>> rows) {
    return new ObjectDataCompiler().compile(rows, template);
  }

  /** Generates and compiles the DRL, returning a ready-to-use rule base. */
  public KieBase compile(InputStream template, Collection<Map<String, Object>> rows) {
    String drl = generateDrl(template, rows);
    KieHelper helper = new KieHelper();
    helper.addContent(drl, ResourceType.DRL);

    Results results = helper.verify();
    if (results.hasMessages(Level.ERROR)) {
      throw new RuleCompilationException("Rule template and rows did not compile: " + results.getMessages());
    }

    KieBase kieBase = helper.build();
    if (kieBase == null) {
      throw new RuleCompilationException("Rule base could not be built: " + drl);
    }
    return kieBase;
  }

  /** Same as {@link #compile(InputStream, Collection)} but reads the template from the classpath. */
  public KieBase compileFromClasspath(String templatePath, Collection<Map<String, Object>> rows) {
    try (InputStream template = RuleSetCompiler.class.getResourceAsStream(templatePath)) {
      if (template == null) {
        throw new RuleCompilationException("Rule template not found on classpath: " + templatePath);
      }
      return compile(template, rows);
    } catch (java.io.IOException e) {
      throw new RuleCompilationException("Rule template could not be read: " + templatePath);
    }
  }

  /** Convenience: compile from classpath with no rows (used by tests and dry runs). */
  public KieBase compileFromClasspath(String templatePath, Map<String, Object> row) {
    return compileFromClasspath(templatePath, List.of(row));
  }
}
