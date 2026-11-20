package ca.shiftcircle.rules.build;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** Time helpers: the business timezone and the short evidence format used in rule messages. */
public final class BusinessTime {

  public static final ZoneId REGINA = ZoneId.of("America/Regina");
  public static final ZoneId UTC = ZoneId.of("UTC");

  private static final DateTimeFormatter EVIDENCE =
      DateTimeFormatter.ofPattern("EEE d MMM HH:mm", Locale.CANADA);

  private BusinessTime() {}

  public static Instant at(String dateIso, String time) {
    return LocalDateTime.of(java.time.LocalDate.parse(dateIso), LocalTime.parse(time))
        .atZone(REGINA)
        .toInstant();
  }

  public static String evidence(Instant instant) {
    return EVIDENCE.format(instant.atZone(REGINA));
  }

  public static String evidenceRange(Instant start, Instant end) {
    return evidence(start) + "–" + evidence(end);
  }
}
