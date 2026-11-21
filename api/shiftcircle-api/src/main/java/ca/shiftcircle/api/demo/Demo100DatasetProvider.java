package ca.shiftcircle.api.demo;

import ca.shiftcircle.infrastructure.demo.DemoChecksum;
import ca.shiftcircle.infrastructure.demo.DemoDataGenerator;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** The 100-officer dataset: the deterministic DemoDataGenerator and its existing checksum. */
@Component
@Profile("demo")
@ConditionalOnProperty(name = "sc.demo.generate", havingValue = "true", matchIfMissing = true)
public class Demo100DatasetProvider implements DemoDatasetProvider {

  private final DemoDataGenerator generator;
  private final JdbcTemplate jdbc;

  public Demo100DatasetProvider(DemoDataGenerator generator, JdbcTemplate jdbc) {
    this.generator = generator;
    this.jdbc = jdbc;
  }

  @Override
  public String dataset() {
    return "100";
  }

  @Override
  public String seed() {
    return "20261001";
  }

  @Override
  public void seedData() {
    generator.generateIfEmpty();
  }

  @Override
  public String checksum() {
    return DemoChecksum.of(jdbc);
  }
}
