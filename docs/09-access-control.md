# ShiftCircle — Access Control

**Status:** v1.0, checked against the API on `main` (23 Nov 2026; the planner cells were probed by hand with a signed-in token, see §3)

## 1. Roles

| Role | Who | Purpose |
|---|---|---|
| `EMPLOYEE` | Correctional officer | Own schedule, hours, offers and preferences; proposes extra shifts on My schedule: drafts, sends, follows and withdraws their own proposals (v1.3) |
| `SUPERVISOR` | Shift supervisor / scheduler | Plans and changes schedules **for the units in their scope**; overtime; actuals; pay-period lock; payroll export |
| `RULES_ADMIN` | HR / labour relations analyst | Edits rule tables in drafts and builds them; **can't approve or publish** |
| `RULES_APPROVER` | Senior labour relations or a manager | Approves, rejects and publishes rule versions; **can't edit drafts they approve** |
| `AUDITOR` | Internal audit, privacy officer, reviewer | Read-only across schedules, reports, rules and the audit log |
| `DISPLAY` | Wall-display device account | Reads today's counts only. No names, no other data. |

A user can hold several roles (e.g. a supervisor is usually also an employee). Separation of duties is enforced per action, not per person: the same person can't both create and approve the same rule version.

**PLANNER (ADR-026, added 2026-11-21) is facility-wide.** A planner generates, reads, commits and discards quarter drafts; reads every officer's preferences; and reads the planning board and the schedule screens like the auditor (read-only, all units); the reports are supervisor/auditor only. A planner cannot edit a supervisor's board, save an assignment on the board, lock a pay period, change a rule or approve one. **Exception (v1.3 P2, owner Q4):** the planner is the fallback decider of shift proposals for every unit, so approving a proposal creates a `shift_assignment` (kind `EXTRA`, source `PROPOSAL`) through the board's own rule check, with no override; this is the only place a planner writes a shift outside a plan commit (ADR-032, written in P5). Units, dated closures, flagged shifts and staffing (allocated headcount, leave allowance) are PLANNER-only; supervisors and officers get 403. Supervisors stay unit-scoped. An officer edits only their own preferences through `/me/preferences`; `/planner/preferences` answers only to PLANNER.

## 2. Permission matrix

✓ = allowed · **own** = only their own records · **scope** = only units in `user_unit_scope` · — = denied

**"Own" needs a linked officer.** `/me/schedule`, `/me/offers` and `/me/preferences` answer for the officer linked to the signed-in account. In the demo **T. Nakamura** has one and, since release v1.3 S4, so do the two supervisors (**M. Ellis** is Morgan Ellis on SUP-L, **J. Chen** Jamie Chen on SUP-O); the other demo accounts get `404` (schedule) or `403` (preferences) there, whatever the matrix says about "own".

**Never your own schedule (release v1.3 S4, owner answer Q3).** A supervisor whose own record is in their scope still can't change it: `POST`/`PATCH`/`DELETE /assignments` (an override included), `PUT`/`DELETE /time-entries/{id}`, `POST /absences`, `POST /open-shifts/{id}/offers` (any listed officer), `POST /open-shifts/{id}/assign` and `POST /offers/{id}/confirm` answer `403` "You can't change your own schedule; ask another supervisor." when the shift or record is the caller's (`SelfActionGuard`, the predicate shift proposals use). Accepting or declining an offer on My schedule stays the employee's own. A refusal is a plain `403` and is not audited, like the other authorization refusals.

| Capability | EMPLOYEE | SUPERVISOR | RULES_ADMIN | RULES_APPROVER | AUDITOR | PLANNER | DISPLAY |
|---|---|---|---|---|---|---|---|
| View own schedule, hours, offers | own | own | own | own | — | own | — |
| View unit roster (names and shifts) | — (not built: an officer sees only their own schedule; `GET /schedule` is `403`) | scope | — | — | ✓ | ✓ (read-only) | — |
| View others' hours, absences, overtime totals (Reports; absence types in Time & attendance) | — | scope | — | — | ✓ | — (`403` on the reports and on Time & attendance; the board shows hours and overtime status only) | — |
| Absence **type** (sick/vacation) for others (Time & attendance) | — | scope | — | — | ✓ | — (no absence items in the board or draft payload yet; `403` on Time & attendance) | — |
| Assign, move or cancel shifts | — | scope (the target unit; the officer may come from any unit: cross-unit cover, ADR-024); **never own** (`403`) | — | — | — | — | — |
| Emergency override of a Block rule whose policy allows one (U-01, U-03, U-05; ADR-023) | — | scope (reason required); **never own** (`403`) | — | — | — | — | — |
| Publish a schedule period | — | scope | — | — | — | — | — |
| Create open shifts, send offers, assign overtime | — | scope; never offer, assign or confirm to oneself (`403`) | — | — | — | — | — |
| Accept or decline an overtime offer | own | own | own | own | — | own | — |
| Submit and withdraw shift proposals (API, v1.3 P1; screen P3) | own | own (a supervisor is also an officer) | — | — | — | — | — |
| Read the proposals inbox and detail (API, v1.3 P2; screen P4: **Proposals (n)** in the SUPERVISOR and PLANNER nav, `/proposals`) | — | scope (the **item's** unit): the inbox lists only proposals with an item in scope (empty otherwise); the detail is `404` with no item in scope and lists an out-of-scope item read-only (unit, time, decision; no rules, hours or actions); own proposals are shown, marked `own` | — | — | — | ✓ facility-wide | — |
| Decide proposals (API, v1.3 P2; screen P4) | — | scope (the **item's** unit; `404` when the proposal has no item in scope, `403` for naming an out-of-scope item in the decision); **never own** (`403`, `SelfActionGuard`; the screen shows an own proposal read-only, "Yours: waiting for another supervisor or the planner"); never past a Block (no override button) | — | — | — | ✓ facility-wide fallback decider; never own | — |
| Record actuals | — | scope; **never own** (`403`) | — | — | — | — | — |
| Lock a pay period | — | facility-wide (any supervisor with at least one unit in scope; audited), ADR-022 | — | — | — | — | — |
| Unlock a pay period | — | facility-wide (reason required; audited), ADR-022 | — | — | — | — | — |
| Payroll export | — | facility-wide (audited with file hash), ADR-022 | — | — | — | — | — |
| Reports | own hours only | scope | — | — | ✓ | — | — |
| View rule tables and versions | — | read | ✓ | ✓ | ✓ | — | — |
| Edit draft rule tables, build, submit | — | — | ✓ | — | — | — | — |
| Approve, reject, publish rule versions | — | — | — | ✓ (not own drafts) | — | — | — |
| View audit log (`GET /audit-events`) | — | scope: events on shifts, open shifts, time entries, offers and pay periods in their units; **no rule-change (`rule_set_version`) events** | — (works from the rules screens; rule-change audit is the auditor's) | — (same) | ✓ facility-wide | — | — |
| Quarter planner: generate, read, edit single draft shifts, discard and commit a draft | — | — | — | — | — | ✓ facility-wide, drafts only | — |
| Read every officer's preferences | own | own | own | own | — | ✓ (read); own edit | — |
| Reset the demo data (demo profile only) | — | — | — | — | — | ✓ | — |
| Wall display counts | — | ✓ | — | — | ✓ | — | ✓ |

## 3. How it's enforced

| Layer | Mechanism |
|---|---|
| UI | Menu items and buttons are shown by role. A convenience only, never the control. |
| API (role) | Spring Security method security: `@PreAuthorize("hasRole('SUPERVISOR')")` on each use case |
| API (scope) | A `ScopeGuard` checks the target unit against the caller's `user_unit_scope`. For an employee's own request it also checks the caller's linked officer. **Cross-unit cover (ADR-024):** a supervisor may assign an officer from **any** unit into a unit in their own scope. The rule preview then shows that officer's rest and hours conflicts, which the supervisor needs in order to decide. The same exception covers a **shift proposal** on a unit in scope from an officer of another unit: its decider sees that officer's rule results, pay-period hours and place in the overtime order for that item only (docs/07 §4.4); the note is shown as plain text and never audited. A supervisor can't assign **into** a unit outside their scope, and can't read an officer's data outside their scope except through that preview. Out-of-scope IDs return `404`, so they don't reveal what exists. "Own" checks compare against the caller's linked `employee_id`. |
| Data queries | Repository methods for lists take the caller's scope as a parameter (no unfiltered list queries in controllers) |
| Database | Triggers refuse `UPDATE`, `DELETE` and `TRUNCATE` on `audit_event` (role grants deferred to a pilot, ADR-018); `CHECK (approved_by <> created_by)` on rule versions; a trigger blocks changes to time entries in locked pay periods |
| Tests | Authorization tests for the denied or scoped cells of the supervisor, employee, rules, auditor and display roles, grouped by area method plus per-endpoint tests, against real HTTP endpoints. **The planner's `403` cells (reports, audit log, rules, Time & attendance, payroll) are enforced by `@PreAuthorize` and were probed by hand; no automated test covers them yet.** |

## 4. Mock sign-in (prototype)

- On the `demo` profile, the sign-in screen lists demo users (`GET /auth/demo-users`). Picking one calls `POST /auth/mock-login`, which returns a **signed JWT** (HS256, key from `SC_JWT_SECRET`, 8-hour expiry) carrying `sub`, `roles` and `units`.
- The API validates the token on every request **exactly as it would a real identity provider's token**. Only the token issuer is fake.
- Every screen shows the "mock sign-in" label. The `prod-like` profile disables the endpoints entirely.

**Demo users (fictional):**

| User | Roles | Scope |
|---|---|---|
| M. Ellis | SUPERVISOR, EMPLOYEE | Units A, B; both supervisor posts (SUP-L, SUP-O; V19, release v1.3) |
| J. Chen | SUPERVISOR, EMPLOYEE | Admissions, Control, Escort & transport; both supervisor posts (SUP-L, SUP-O; V19, release v1.3) |
| T. Nakamura | EMPLOYEE | — |
| L. Fraser | RULES_ADMIN | — |
| P. Singh | RULES_APPROVER | — |
| A. Reviewer | AUDITOR | all |
| P. Planner | PLANNER | all (read-only; preferences planning) |
| Unit office TV | DISPLAY | all (counts only) |

## 5. Pilot: real identity

- Replace mock sign-in with government SSO over **OIDC** (e.g. Microsoft Entra ID). The API becomes a resource server validating the provider's tokens.
- Roles and unit scope come from **directory groups** (e.g. `SC-Supervisor-UnitB`), managed through the normal access-request process, with periodic access reviews.
- Session timeouts, step-up authentication for rule publishing and payroll export, and break-glass procedures are set by ministry security policy.

## 6. Privacy notes (FOIP)

- Data minimization: absences record a type only, never a medical reason.
- Employees see only their own shifts, hours and offers; they never see colleagues' shifts, hours, absences or overtime.
- The wall display shows counts only, because it's a shared screen.
- The audit log records **who** saw or changed sensitive data where it matters (payroll export, pay-period unlock, overrides).
- A privacy impact assessment (PIA) is required before any real employee data is used.
