package ca.shiftcircle.api.proposals;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import org.springframework.stereotype.Component;

/**
 * A small per-officer, per-minute limit on the proposal calls that cost something: previews (up
 * to ten rule evaluations each) and the send / withdraw cycle that would otherwise grow the
 * proposal and audit tables without bound, because a withdraw frees the waiting-item cap.
 *
 * <p>In memory and per instance, which is the prototype's single API container. It uses the real
 * clock, not the frozen demo clock, so it still works on the demo day.
 */
@Component
public class ProposalRateLimiter {

  public enum Action {
    PREVIEW(60),
    SEND(10),
    WITHDRAW(10);

    private final int perMinute;

    Action(int perMinute) {
      this.perMinute = perMinute;
    }

    public int perMinute() {
      return perMinute;
    }
  }

  private static final long WINDOW_MILLIS = 60_000L;

  private final Map<String, Deque<Long>> calls = new ConcurrentHashMap<>();
  private LongSupplier nowMillis = System::currentTimeMillis;

  /** Counts one call, or answers 429 when the officer has used this minute's allowance. */
  public void require(UUID employeeId, Action action) {
    long now = nowMillis.getAsLong();
    Deque<Long> window = calls.computeIfAbsent(employeeId + ":" + action, key -> new ArrayDeque<>());
    synchronized (window) {
      while (!window.isEmpty() && now - window.peekFirst() >= WINDOW_MILLIS) {
        window.pollFirst();
      }
      if (window.size() >= action.perMinute()) {
        long retry = Math.max(1, (WINDOW_MILLIS - (now - window.peekFirst()) + 999) / 1000);
        throw new ProposalProblemException(
            429,
            "rate-limited",
            "Too many requests",
            "You can do this " + action.perMinute() + " times a minute. Try again in " + retry
                + " seconds.",
            Map.of("retryAfterSeconds", retry));
      }
      window.addLast(now);
    }
  }

  /** For tests: forget every count. */
  void reset() {
    calls.clear();
  }
}
