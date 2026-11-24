package ca.shiftcircle.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class SelfActionGuardTest {

  private static final UUID ME = UUID.randomUUID();

  private static AuthPrincipal principal(UUID employeeId) {
    return new AuthPrincipal("t.user", "T. User", List.of("EMPLOYEE"), List.of(), employeeId);
  }

  @Test
  void theSameEmployeeIsSelf() {
    assertThat(SelfActionGuard.isSelf(principal(ME), ME)).isTrue();
    assertThat(SelfActionGuard.isSelf(principal(ME), UUID.randomUUID())).isFalse();
  }

  @Test
  void anAccountWithNoOfficerIsNeverSelf() {
    assertThat(SelfActionGuard.isSelf(principal(null), ME)).isFalse();
    assertThat(SelfActionGuard.isSelf(principal(null), null)).isFalse();
    assertThat(SelfActionGuard.isSelf(principal(ME), null)).isFalse();
  }

  @Test
  void requireNotSelfRefusesWith403AndTheMessage() {
    assertThatThrownBy(() -> SelfActionGuard.requireNotSelf(principal(ME), ME, "Not your own"))
        .isInstanceOfSatisfying(
            ResponseStatusException.class,
            e -> {
              assertThat(e.getStatusCode().value()).isEqualTo(403);
              assertThat(e.getReason()).isEqualTo("Not your own");
            });
    assertThatCode(
            () -> SelfActionGuard.requireNotSelf(principal(ME), UUID.randomUUID(), "Not your own"))
        .doesNotThrowAnyException();
  }
}
