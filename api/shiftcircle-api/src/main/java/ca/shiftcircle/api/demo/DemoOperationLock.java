package ca.shiftcircle.api.demo;

import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.stereotype.Component;

/**
 * One heavy demo operation at a time: a reset and a planner draft generation/commit must not run
 * concurrently (the reset recreates the schema under them). Callers that cannot acquire it answer
 * 409 rather than queueing silently.
 *
 * <p>A permit, not a {@link java.util.concurrent.locks.ReentrantLock}: the reset acquires on the
 * request thread and releases on its virtual worker thread. A reentrant lock belongs to the thread
 * that acquired it, so that release would silently do nothing and the lock would stay held. The
 * atomic flag stops a double release from adding a second permit.
 */
@Component
public class DemoOperationLock {

  private final Semaphore permit = new Semaphore(1);
  private final AtomicBoolean held = new AtomicBoolean(false);

  public boolean tryAcquire() {
    if (!permit.tryAcquire()) {
      return false;
    }
    held.set(true);
    return true;
  }

  public void release() {
    if (held.compareAndSet(true, false)) {
      permit.release();
    }
  }

  public boolean busy() {
    return held.get();
  }
}
