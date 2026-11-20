package ca.shiftcircle.infrastructure.demo;

import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Whether the async demo dataset has finished generating.
 *
 * <p>The generator is an {@code ApplicationRunner}, so Tomcat can answer requests before the roster
 * exists. Readiness has to say DOWN until this flips, or the first person after {@code docker
 * compose up} gets an empty board.
 */
@Component
@Profile("demo")
@ConditionalOnProperty(name = "sc.demo.generate", havingValue = "true", matchIfMissing = true)
public class DemoDataReadiness {

  private final AtomicBoolean ready = new AtomicBoolean(false);

  public boolean isReady() {
    return ready.get();
  }

  public void markReady() {
    ready.set(true);
  }
}
