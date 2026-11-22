package ca.shiftcircle.api.demo;

import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;

/**
 * One heavy demo operation at a time: a reset and a planner draft generation/commit must not run
 * concurrently (the reset recreates the schema under them). Callers that cannot acquire it answer
 * 409 rather than queueing silently.
 *
 * <p>A permit, not a {@link java.util.concurrent.locks.ReentrantLock}: the reset acquires on the
 * request thread and releases on its virtual worker thread. A reentrant lock belongs to the thread
 * that acquired it, so that release would silently do nothing and the lock would stay held.
 *
 * <p>Every acquire returns an owner token; only that token releases. A late or duplicate release
 * from an operation that already finished therefore cannot free a permit another operation acquired
 * in the meantime (review-r3 N-1).
 */
@Component
public class DemoOperationLock {

  private final Semaphore permit = new Semaphore(1);
  private final AtomicLong nextToken = new AtomicLong();
  private final AtomicLong owner = new AtomicLong();

  public boolean tryAcquire() {
    if (!permit.tryAcquire()) {
      return false;
    }
    owner.set(nextToken.incrementAndGet());
    return true;
  }

  /** The token of the current holder; 0 when the lock is free. */
  public long token() {
    return owner.get();
  }

  public void release(long token) {
    if (token != 0 && owner.compareAndSet(token, 0)) {
      permit.release();
    }
  }

  public boolean busy() {
    return owner.get() != 0;
  }
}
