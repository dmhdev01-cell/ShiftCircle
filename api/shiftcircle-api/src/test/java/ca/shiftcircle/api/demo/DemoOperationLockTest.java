package ca.shiftcircle.api.demo;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** The reset acquires on the request thread and releases on its worker thread; tokens are owners. */
class DemoOperationLockTest {

  @Test
  void aPermitAcquiredOnOneThreadCanBeReleasedOnAnother() throws Exception {
    DemoOperationLock lock = new DemoOperationLock();
    assertThat(lock.tryAcquire()).isTrue();
    long token = lock.token();
    assertThat(lock.tryAcquire()).as("second acquire is refused").isFalse();
    assertThat(lock.busy()).isTrue();

    Thread worker = new Thread(() -> lock.release(token), "reset-worker");
    worker.start();
    worker.join();

    assertThat(lock.busy()).isFalse();
    assertThat(lock.tryAcquire()).as("released permit is available again").isTrue();
    lock.release(lock.token());
    assertThat(lock.busy()).isFalse();
  }

  @Test
  void aDoubleReleaseDoesNotCreateASecondPermit() {
    DemoOperationLock lock = new DemoOperationLock();
    assertThat(lock.tryAcquire()).isTrue();
    long token = lock.token();
    lock.release(token);
    lock.release(token);
    assertThat(lock.tryAcquire()).isTrue();
    assertThat(lock.tryAcquire()).isFalse();
    lock.release(lock.token());
  }

  @Test
  void aStaleTokenCannotFreeTheNextOwnersPermit() {
    DemoOperationLock lock = new DemoOperationLock();
    assertThat(lock.tryAcquire()).isTrue();
    long first = lock.token();
    lock.release(first);
    assertThat(lock.tryAcquire()).isTrue();
    long second = lock.token();
    lock.release(first);
    assertThat(lock.busy()).as("the stale release did not free the new owner").isTrue();
    assertThat(lock.tryAcquire()).isFalse();
    lock.release(second);
    assertThat(lock.busy()).isFalse();
  }
}
