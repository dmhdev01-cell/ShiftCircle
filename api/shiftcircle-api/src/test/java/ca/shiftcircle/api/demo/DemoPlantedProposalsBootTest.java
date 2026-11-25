package ca.shiftcircle.api.demo;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * v1.3 P5 security review I-2: a failure while planting the demo proposals on the fresh-boot path
 * is logged and boot goes on (the roster is already there); the reset, which calls {@code plant}
 * directly, still fails as any reset step does.
 */
class DemoPlantedProposalsBootTest {

  @Test
  void aFailedPlantAtBootIsLoggedAndBootContinues() {
    TransactionTemplate tx = mock(TransactionTemplate.class);
    doThrow(new IllegalStateException("No eligible date for a planted proposal"))
        .when(tx)
        .executeWithoutResult(any());
    DemoPlantedProposals planted = new DemoPlantedProposals(null, null, null, null, tx);

    assertThatCode(() -> planted.afterGenerate(20261001L)).doesNotThrowAnyException();
    assertThatThrownBy(() -> planted.plant(20261001L))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("No eligible date");
  }
}
