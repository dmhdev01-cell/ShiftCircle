package ca.shiftcircle.api.version;

import ca.shiftcircle.api.demo.DemoResetService;
import ca.shiftcircle.api.rules.RuleCheckService;
import java.util.List;
import java.util.Arrays;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.info.BuildProperties;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Reports what is running, including the live rule-set version and git commit (docs/08 §8). */
@RestController
@RequestMapping("/api/v1")
public class VersionController {

  private final ObjectProvider<BuildProperties> buildProperties;
  private final Environment environment;
  private final RuleCheckService ruleChecks;
  private final ObjectProvider<DemoResetService> reset;
  private final String asOf;

  public VersionController(
      ObjectProvider<BuildProperties> buildProperties,
      Environment environment,
      RuleCheckService ruleChecks,
      ObjectProvider<DemoResetService> reset,
      @Value("${sc.demo.today:2026-11-19}") String asOf) {
    this.buildProperties = buildProperties;
    this.environment = environment;
    this.ruleChecks = ruleChecks;
    this.reset = reset;
    this.asOf = asOf;
  }

  @GetMapping("/version")
  public VersionResponse version() {
    BuildProperties build = buildProperties.getIfAvailable();
    String[] activeProfiles = environment.getActiveProfiles();
    DemoResetService demo = reset.getIfAvailable();

    return new VersionResponse(
        environment.getProperty("spring.application.name", "shiftcircle-api"),
        build == null ? "dev" : build.getVersion(),
        build == null || build.getTime() == null ? "unknown" : build.getTime().toString(),
        environment.getProperty("sc.build.git-commit", "unknown"),
        // The published row is the record; a publish swaps the rule base and this number together.
        "v" + ruleChecks.publishedVersion(),
        activeProfiles.length == 0 ? "default" : String.join(",", Arrays.asList(activeProfiles)),
        asOf,
        environment.acceptsProfiles(Profiles.of("demo")),
        demo == null ? List.of() : demo.availableDatasets(),
        demo == null ? null : demo.activeDataset());
  }
}
