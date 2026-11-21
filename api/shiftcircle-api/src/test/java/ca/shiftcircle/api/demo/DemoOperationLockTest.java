package ca.shiftcircle.api.demo;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** The reset acquires on the request thread and releases on its worker thread. */
class DemoOperationLockTest {

  @Test
  void aPermitAcquiredOnOneThreadCanBeReleasedOnAnother() throws Exception {
    DemoOperationLock lock = new DemoOperationLock();
    assertThat(lock.tryAcquire()).isTrue();
    assertThat(lock.tryAcquire()).as("second acquire is refused").isFalse();
    assertThat(lock.busy()).isTrue();

    Thread worker = new Thread(lock::release, "reset-worker");
    worker.start();
    worker.join();

    assertThat(lock.busy()).isFalse();
    assertThat(lock.tryAcquire()).as("released permit is available again").isTrue();
    lock.release();
    assertThat(lock.busy()).isFalse();
  }

  @Test
  void aDoubleReleaseDoesNotCreateASecondPermit() {
    DemoOperationLock lock = new DemoOperationLock();
    assertThat(lock.tryAcquire()).isTrue();
    lock.release();
    lock.release();
    assertThat(lock.tryAcquire()).isTrue();
    assertThat(lock.tryAcquire()).isFalse();
    lock.release();
  }
}
