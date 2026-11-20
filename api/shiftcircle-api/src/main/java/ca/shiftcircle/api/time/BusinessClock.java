package ca.shiftcircle.api.time;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The clock the business rules use for "has this shift ended?".
 *
 * <p>On the demo profile "today" is frozen at {@code sc.demo.today} (the same date the schedule,
 * the overtime board and the reports use). Using the real clock there made shifts that ended after
 * the frozen demo day look ended, so the open pay period could not be locked (dev-qa finding).
 * With no demo date configured the real clock is used.
 */
@Component
public class BusinessClock {

  public static final ZoneId REGINA = ZoneId.of("America/Regina");

  private final Instant demoNow;

  public BusinessClock(@Value("${sc.demo.today:}") String demoToday) {
    this.demoNow =
        demoToday == null || demoToday.isBlank()
            ? null
            : LocalDate.parse(demoToday).atTime(LocalTime.NOON).atZone(REGINA).toInstant();
  }

  public Instant now() {
    return demoNow != null ? demoNow : Instant.now();
  }

  public LocalDate today() {
    return now().atZone(REGINA).toLocalDate();
  }
}
