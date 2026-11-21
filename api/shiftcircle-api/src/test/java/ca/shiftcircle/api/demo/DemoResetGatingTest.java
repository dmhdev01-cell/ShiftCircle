package ca.shiftcircle.api.demo;

import static org.assertj.core.api.Assertions.assertThat;

import ca.shiftcircle.infrastructure.demo.DemoDataGenerator;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The demo reset beans depend on the demo data generator. They must follow the same
 * sc.demo.generate condition, or a demo-profile context with generation switched off cannot load
 * (the reset service's constructor asks for a bean that is not there).
 */
@SpringBootTest(properties = "sc.demo.generate=false")
@ActiveProfiles("demo")
class DemoResetGatingTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    ca.shiftcircle.api.PostgresTestSupport.register(registry);
  }

  @Autowired private ApplicationContext context;

  @Test
  void resetBeansFollowTheDemoGeneratorCondition() {
    assertThat(context.getBeanNamesForType(DemoDataGenerator.class)).isEmpty();
    assertThat(context.getBeanNamesForType(DemoResetService.class)).isEmpty();
    assertThat(context.getBeanNamesForType(DemoResetController.class)).isEmpty();
    assertThat(context.getBeanNamesForType(DemoResetInterceptor.class)).isEmpty();
  }
}
