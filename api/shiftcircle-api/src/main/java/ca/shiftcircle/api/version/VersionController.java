package ca.shiftcircle.api.version;

import java.util.Arrays;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.info.BuildProperties;
import org.springframework.core.env.Environment;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Reports what is running, including the rule-set version and the git commit (docs/08 §8). */
@RestController
@RequestMapping("/api/v1")
public class VersionController {

  private final ObjectProvider<BuildProperties> buildProperties;
  private final Environment environment;
  private final String ruleSetVersion;
  private final String asOf;

  public VersionController(
      ObjectProvider<BuildProperties> buildProperties,
      Environment environment,
      @Value("${sc.rules.version:v1}") String ruleSetVersion,
      @Value("${sc.demo.today:2026-11-19}") String asOf) {
    this.buildProperties = buildProperties;
    this.environment = environment;
    this.ruleSetVersion = ruleSetVersion;
    this.asOf = asOf;
  }

  @GetMapping("/version")
  public VersionResponse version() {
    BuildProperties build = buildProperties.getIfAvailable();
    String[] activeProfiles = environment.getActiveProfiles();

    return new VersionResponse(
        environment.getProperty("spring.application.name", "shiftcircle-api"),
        build == null ? "dev" : build.getVersion(),
        build == null || build.getTime() == null ? "unknown" : build.getTime().toString(),
        environment.getProperty("sc.build.git-commit", "unknown"),
        ruleSetVersion,
        activeProfiles.length == 0 ? "default" : String.join(",", Arrays.asList(activeProfiles)),
        asOf);
  }
}
