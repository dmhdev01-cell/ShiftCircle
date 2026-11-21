package ca.shiftcircle.api.demo;

import java.util.concurrent.locks.ReentrantLock;
import org.springframework.stereotype.Component;

/**
 * One heavy demo operation at a time: a reset and a planner draft generation/commit must not run
 * concurrently (the reset recreates the schema under them). Callers that cannot acquire it answer
 * 409 rather than queueing silently.
 */
@Component
public class DemoOperationLock {

  private final ReentrantLock lock = new ReentrantLock();

  public boolean tryAcquire() {
    return lock.tryLock();
  }

  public void release() {
    if (lock.isHeldByCurrentThread()) {
      lock.unlock();
    }
  }

  public boolean busy() {
    return lock.isLocked();
  }
}
