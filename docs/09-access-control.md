# ShiftCircle — Access Control

**Status:** Draft v1.0 · 2026-11-19

## 1. Roles

| Role | Who | Purpose |
|---|---|---|
| `EMPLOYEE` | Correctional officer | Own schedule, hours, offers and proposals |
| `SUPERVISOR` | Shift supervisor / scheduler | Plans and changes schedules **for the units in their scope**; overtime; actuals; pay-period lock; payroll export |
| `RULES_ADMIN` | HR / labour relations analyst | Edits rule tables in drafts and builds them; **can't approve or publish** |
| `RULES_APPROVER` | Senior labour relations or a manager | Approves, rejects and publishes rule versions; **can't edit drafts they approve** |
| `AUDITOR` | Internal audit, privacy officer, reviewer | Read-only across schedules, reports, rules and the audit log |
| `DISPLAY` | Wall-display device account | Reads today's counts only. No names, no other data. |

A user can hold several roles (e.g. a supervisor is usually also an employee). Separation of duties is enforced per action, not per person: the same person can't both create and approve the same rule version.

## 2. Permission matrix

✓ = allowed · **own** = only their own records · **scope** = only units in `user_unit_scope` · — = denied

| Capability | EMPLOYEE | SUPERVISOR | RULES_ADMIN | RULES_APPROVER | AUDITOR | DISPLAY |
|---|---|---|---|---|---|---|
| View own schedule, hours, offers | own | own | own | own | — | — |
| View unit roster (names and shifts) | own unit, shifts only | scope | — | — | ✓ | — |
| View others' hours, absences, overtime totals | — | scope | — | — | ✓ | — |
| Absence **type** (sick/vacation) for others | — | scope | — | — | ✓ | — |
| Assign, move or cancel shifts | — | scope | — | — | — | — |
| Emergency override of a Block rule whose policy allows one (U-01, U-03, U-05; ADR-023) | — | scope (reason required) | — | — | — | — |
| Publish a schedule period | — | scope | — | — | — | — |
| Create open shifts, send offers, assign overtime | — | scope | — | — | — | — |
| Accept or decline an overtime offer | own | own | own | own | — | — |
| Submit shift proposals | own | own | — | — | — | — |
| Decide on proposals | — | scope | — | — | — | — |
| Record actuals | — | scope | — | — | — | — |
| Lock a pay period | — | facility-wide (any supervisor with at least one unit in scope; audited), ADR-022 | — | — | — | — |
| Unlock a pay period | — | facility-wide (reason required; audited), ADR-022 | — | — | — | — |
| Payroll export | — | facility-wide (audited with file hash), ADR-022 | — | — | — | — |
| Reports | own hours only | scope | — | — | ✓ | — |
| View rule tables and versions | — | read | ✓ | ✓ | ✓ | — |
| Edit draft rule tables, build, submit | — | — | ✓ | — | — | — |
| Approve, reject, publish rule versions | — | — | — | ✓ (not own drafts) | — | — |
| View audit log | — | scope | own rule changes | rule changes | ✓ | — |
| Wall display counts | — | ✓ | — | — | ✓ | ✓ |

## 3. How it's enforced

| Layer | Mechanism |
|---|---|
| UI | Menu items and buttons are shown by role. A convenience only, never the control. |
| API (role) | Spring Security method security: `@PreAuthorize("hasRole('SUPERVISOR')")` on each use case |
| API (scope) | A `ScopeGuard` checks the target unit, or the target employee's unit, against the caller's `user_unit_scope`. Out-of-scope IDs return `404`, so they don't reveal what exists. "Own" checks compare against the caller's linked `employee_id`. |
| Data queries | Repository methods for lists take the caller's scope as a parameter (no unfiltered list queries in controllers) |
| Database | Triggers refuse `UPDATE`, `DELETE` and `TRUNCATE` on `audit_event` (role grants deferred to a pilot, ADR-018); `CHECK (approved_by <> created_by)` on rule versions; a trigger blocks changes to time entries in locked pay periods |
| Tests | One automated authorization test per matrix cell that says "—" or "scope", against real HTTP endpoints |

## 4. Mock sign-in (prototype)

- On the `demo` profile, the sign-in screen lists demo users (`GET /auth/demo-users`). Picking one calls `POST /auth/mock-login`, which returns a **signed JWT** (HS256, key from `SC_JWT_SECRET`, 8-hour expiry) carrying `sub`, `roles` and `units`.
- The API validates the token on every request **exactly as it would a real identity provider's token**. Only the token issuer is fake.
- Every screen shows the "mock sign-in" label. The `prod-like` profile disables the endpoints entirely.

**Demo users (fictional):**

| User | Roles | Scope |
|---|---|---|
| M. Ellis | SUPERVISOR, EMPLOYEE | Units A, B |
| J. Chen | SUPERVISOR, EMPLOYEE | Admissions, Control, Escort & transport |
| T. Nakamura | EMPLOYEE | — |
| L. Fraser | RULES_ADMIN | — |
| P. Singh | RULES_APPROVER | — |
| A. Reviewer | AUDITOR | all |
| Unit office TV | DISPLAY | all (counts only) |

## 5. Pilot: real identity

- Replace mock sign-in with government SSO over **OIDC** (e.g. Microsoft Entra ID). The API becomes a resource server validating the provider's tokens.
- Roles and unit scope come from **directory groups** (e.g. `SC-Supervisor-UnitB`), managed through the normal access-request process, with periodic access reviews.
- Session timeouts, step-up authentication for rule publishing and payroll export, and break-glass procedures are set by ministry security policy.

## 6. Privacy notes (FOIP)

- Data minimization: absences record a type only, never a medical reason.
- Employees see colleagues' shifts (as on a posted schedule) but not their hours, absences or overtime.
- The wall display shows counts only, because it's a shared screen.
- The audit log records **who** saw or changed sensitive data where it matters (payroll export, pay-period unlock, overrides).
- A privacy impact assessment (PIA) is required before any real employee data is used.
