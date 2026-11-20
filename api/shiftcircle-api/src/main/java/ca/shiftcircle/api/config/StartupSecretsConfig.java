package ca.shiftcircle.api.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/** Runs the secret checks while the context starts, before the web server accepts traffic. */
@Configuration(proxyBeanMethods = false)
public class StartupSecretsConfig {

  public StartupSecretsConfig(Environment environment) {
    StartupSecrets.verify(environment);
  }
}
