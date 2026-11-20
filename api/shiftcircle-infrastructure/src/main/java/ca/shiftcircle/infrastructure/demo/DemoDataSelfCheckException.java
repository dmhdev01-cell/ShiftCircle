package ca.shiftcircle.infrastructure.demo;

import java.util.List;

/** Thrown when the generated dataset fails its own self-check. Lists every violation, not the first. */
public class DemoDataSelfCheckException extends RuntimeException {

  private final List<String> violations;

  public DemoDataSelfCheckException(List<String> violations) {
    super("Demo dataset failed its self-check: " + String.join("; ", violations));
    this.violations = List.copyOf(violations);
  }

  public List<String> violations() {
    return violations;
  }
}
