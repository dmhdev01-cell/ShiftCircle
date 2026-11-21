package ca.shiftcircle.api.demo;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * While a reset is rebuilding the schema, every other request answers 409 instead of racing the
 * DROP/CREATE. The reset endpoints themselves stay reachable so the About screen can poll.
 */
@Component
@Profile("demo")
public class DemoResetInterceptor implements HandlerInterceptor, WebMvcConfigurer {

  private final DemoResetService reset;

  public DemoResetInterceptor(DemoResetService reset) {
    this.reset = reset;
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(this).order(-100);
  }

  @Override
  public boolean preHandle(
      HttpServletRequest request, HttpServletResponse response, Object handler)
      throws java.io.IOException {
    String path = request.getRequestURI();
    if (reset.running()
        && !path.startsWith("/api/v1/demo/reset")
        && !path.equals("/api/v1/version")) {
      response.setStatus(409);
      response.setContentType("application/problem+json");
      response.getWriter().write(
          "{\"type\":\"https://shiftcircle.local/problems/409\",\"title\":\"Demo reset running\","
              + "\"status\":409,\"detail\":\"The demo is reloading its seeded data. Try again in a moment.\"}");
      return false;
    }
    return true;
  }
}
