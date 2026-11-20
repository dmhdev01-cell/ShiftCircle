package ca.shiftcircle.api.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * Stateless security: every API route needs a valid token except the demo sign-in and the health and
 * version endpoints. Role and unit-scope checks live on the use cases, not here (docs/09 §3).
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

  /**
   * The API authenticates JWTs only. This bean keeps Spring Boot's default in-memory user out of the
   * context, which is what otherwise prints "Using generated security password" at startup. It
   * throws for every username, so basic auth with the default 'user' gets 401, not a second way in.
   */
  @Bean
  public UserDetailsService passwordAuthenticationIsDisabled() {
    return username -> {
      throw new UsernameNotFoundException("Password authentication is not enabled");
    };
  }

  @Bean
  public SecurityFilterChain filterChain(HttpSecurity http, JwtService jwtService)
      throws Exception {    http.csrf(csrf -> csrf.disable())
        .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            requests ->
                requests
                    .requestMatchers(
                        "/api/v1/auth/mock-login",
                        "/api/v1/auth/demo-users",
                        "/api/v1/version",
                        "/actuator/health",
                        "/actuator/health/**",
                        // Spring's error dispatch must be reachable or a 400 becomes a 401.
                        "/error")
                    .permitAll()
                    .anyRequest()
                    .authenticated())
        .exceptionHandling(
            handling ->
                handling.authenticationEntryPoint(
                    (request, response, exception) -> {
                      response.setStatus(401);
                      response.setContentType("application/problem+json");
                      response.getWriter().write("{\"title\":\"Not signed in\",\"status\":401}");
                    }))
        .addFilterBefore(
            new JwtAuthenticationFilter(jwtService), UsernamePasswordAuthenticationFilter.class);
    return http.build();
  }
}
