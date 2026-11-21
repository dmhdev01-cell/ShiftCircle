# Decision Log

Short records of important decisions. Status: Proposed → Accepted / Rejected / Superseded.

## ADR-001 — Scope to a single swap workflow
**Status:** Superseded by ADR-009 (2026-11-19)

## ADR-002 — Rules decide; humans approve
**Status:** Accepted
**Decision:** A deterministic rules engine decides whether any schedule change is allowed. A supervisor is accountable for every change and override. Nothing is auto-approved.

## ADR-003 — UI stack (Streamlit vs. FastAPI + HTMX)
**Status:** Superseded by ADR-006

## ADR-004 — Synthetic facility, real public rules
**Status:** Accepted
**Decision:** A fictional facility with synthetic staff and staffing levels. R-01 and R-02 come from public Saskatchewan employment-standards guidance. Collective-agreement values are placeholders, flagged in the UI. Real-world domain knowledge shapes the workflows; no real or non-public operational data is used.

## ADR-005 — No AI at runtime
**Status:** Accepted
**Context:** Scheduling decisions affect employment rights, pay and facility safety.
**Decision:** No AI in the running system. AI is used during design and development (required by the assessment) and logged in `ai-dev-log.md`.
**Consequences:** Simpler governance (no model risk, no external data flow); everything is reproducible. Future AI uses (drafting notifications, summarizing reports) are documented but not built.

## ADR-006 — Three containers: React SPA / ASP.NET Core / PostgreSQL
**Status:** Superseded in part by ADR-011 (middle tier is now Java + Spring Boot; the three-container layout stands)
**Decision:** Front end: React + TypeScript + MUI, served by nginx. Middle tier: ASP.NET Core Web API on .NET 10 (LTS). Database: PostgreSQL. Orchestrated with docker compose.
**Why .NET:** widely used in government and enterprise (including Microsoft-centric public-sector shops), long-term support, strong typing for rules logic, and first-class OpenAPI and EF Core with PostgreSQL.
**Alternatives:** Java 21 + Spring Boot (equally enterprise-grade; choose it if the target team is Java-oriented); Node/NestJS (fast, but less common for government middle tiers).

## ADR-007 — Rules engine: a fixed catalogue of rule types with database-stored settings
**Status:** Superseded by ADR-012
**Decision:** Coded rule types, configured through database rows with schema-checked settings, versioning and effective dates. See `04-rules-engine.md`.
**Alternatives:** Microsoft RulesEngine (JSON expressions), Drools (Java), or a domain-specific language. Rejected for the prototype because they're harder for non-developers to change safely and harder to test exhaustively.

## ADR-008 — Simulated integrations kept inside the three containers
**Status:** Proposed
**Decision:** Payroll CSV export and mock identity live inside the existing containers. No extra containers, so we stay within the three-container constraint.

## ADR-009 — Scope: scheduling prototype for a correctional centre
**Status:** Accepted
**Decision:** Planning board, employee view, overtime, time tracking with payroll export, reports, and a configurable rules engine (trades and notifications moved out by ADR-010). Features are tiered Must / Should / Could to fit seven days and a five-minute demo.
**Risk:** The scope is large for seven days. Should items are cut first.

## ADR-010 — Defer trades and notifications; size the simulation at 100 officers × 90 days
**Status:** Accepted (2026-11-19)
**Decision:** Shift trades (with monthly/quarterly limits) and notifications/alerts move to future work. The simulation uses 100 fictional officers over a 90-day quarter, with past actuals and future planned shifts.
**Why:** It narrows the build to the core: planning, rules, overtime, time/payroll and reports. A 90-day window with 100 officers is big enough to show realistic coverage gaps, overtime distribution and quarter-level reports.
**Consequences:** The rules engine keeps room for a `MaxCountInPeriod` rule type for trades later. The performance targets (NFR-05) are set for 100 officers.

## ADR-011 — Middle tier: Java + Spring Boot
**Status:** Accepted (2026-11-19); Java version revised by ADR-012
**Decision:** The API container runs a Spring Boot 4.x application on Java 21 (LTS), built with Maven, using Spring Data JPA / Hibernate, Flyway and Spring Security, against PostgreSQL. The three-container layout (web / api / db) is unchanged.
**Why:** Java with Spring is a long-established enterprise and government standard with a large talent pool, long-term support and mature tooling for REST APIs, security and database migrations. It fits the brief that the middle tier should be technology a government or enterprise would use.
**Consequences:** The rules engine is a framework-free Maven module (plain Java), so it can be unit-tested in isolation and reused elsewhere. Spring Boot minor versions get roughly 12 months of free support, so a pilot would plan regular upgrades.

## ADR-012 — Rules engine: Drools decision tables that non-technical staff can edit
**Status:** Accepted (2026-11-19)
**Context:** Rules must be understandable and changeable by a non-technical person (HR, labour relations), and should run on a recognized engine.
**Decision:** Use Drools 10.x (Apache KIE), embedded in the API. Developers write rule **templates** and Java **fact builders** (the time-window maths). Non-technical admins edit **decision-table rows** in a friendly in-app grid, with plain-language previews and an Excel round-trip (the round-trip was not built in the prototype: docs/10 §8). Changes go through validate → compile → regression test → dry run → maker/checker approval → hot publish, with versioning and rollback.
**Alternatives:** (a) a custom rule-type catalogue (ADR-007): simpler, but not a recognized engine; (b) raw DRL rule files: too technical for the target editors; (c) DMN with visual editors: standards-based, but needs tooling outside the three containers. Noted as a future option.
**Consequences:** The Java target moves from 25 to **21 LTS**, because KIE's published support covers Java 21. Spring Boot 4.x compatibility is confirmed by a Day 1 spike; the fallback is Spring Boot 3.5.x (past free support, a recorded governance risk). Apache KIE is an incubating project, so its support model needs confirming before a pilot.

## ADR-013 — Coverage measured by unit and block
**Status:** Accepted (2026-11-19)
**Decision:** Required staffing is defined per unit per block (Day 07–15, Evening 15–23, Night 23–07), optionally with a qualification minimum. **Revised the same day:** coverage is measured hourly: each block's requirement applies to every hour in it, and a block is covered when every hour meets it. (The first version, "a shift counts toward a block if it covers half of it", double-counted 12-hour shifts; see ai-dev-log #10.)
**Alternatives:** headcount per shift only (too coarse for qualification checks); named posts (most realistic, but much more setup). Named posts remain a future extension of `unit_requirement`.
**Status note:** to be confirmed against real practice.

## ADR-014 — API conventions: REST, Problem Details, rule results in 422
**Status:** Accepted (2026-11-19)
**Decision:** REST/JSON under `/api/v1`, OpenAPI generated from code, RFC 9457 Problem Details for errors, rule outcomes returned as `422` with a `ruleResults` extension, a separate preview endpoint (`/rule-checks`), explicit `acknowledgeWarnings` and `override.reason` fields, and optimistic locking with ETags.
**Why:** predictable for reviewers and future integrators; makes "the rules said no" a first-class, explainable response rather than a generic error.

## ADR-015 — Default shift times, configurable through the rules workflow
**Status:** Accepted (2026-11-19)
**Decision:** Defaults set by the project lead: 8 h shifts 07:00–15:00, 15:00–23:00, 23:00–07:00; 12 h shifts 00:00–12:00 and 12:00–24:00; 16 h shifts 20:00–12:00 (regular, on units that allow them; revised the same day, they were first recorded as overtime-only doubles). Shift templates are configuration (`shift_template`), edited on a "Shift types" table in the Rules screen and published through the same draft → build → dry run → approve flow, because changing shift times changes rest and hours outcomes.
**Consequences:** The 12 h rotation must run 00–12, 00–12, 12–24, 12–24, then 4 off; a 12–24 shift followed by a 00–12 shift would give zero rest. Existing assignments keep their own times when a template changes. The UI mockups still show the earlier 07–19 / 19–07 12 h times; the build uses the new defaults.
**To confirm:** actual shift start times at the centre.

## ADR-016 — Overtime is based on hours in the pay period, not on shift length
**Status:** Accepted (2026-11-19)
**Decision:** Overtime = hours worked beyond the threshold for the period (default 80 h per 2-week pay period; weekly 40 h selectable), in time order. Rostered 8, 12 and 16-hour shifts are regular hours. Shifts carry `ROSTERED` / `EXTRA`, not "overtime". Default rate: 1.5× for all overtime hours, with an optional higher band (MOCK). Day-of-rest double time (P-02) is off by default pending confirmation.
**Why:** the lead's direction; matches averaging arrangements for long-shift rotations.
**Governance note:** the Saskatchewan Employment Act's default overtime is daily/weekly; period averaging relies on a modified work arrangement or collective agreement provisions. Recorded as an assumption to confirm.
**Consequences:** pay codes are recalculated for the whole period after any change and frozen on lock; the overtime ranking still uses overtime hours this quarter.

## ADR-017 — UI build decisions: hourly coverage cells, lock precondition, counts-only rule review, explicit proposal decisions
**Status:** Accepted (2026-11-20, lead confirmed; proposed in `docs/ui/build-notes.md` §3)
**Decision:**
1. **Coverage cells show the lowest hourly count and the short hours.** `GET /schedule` and `GET /display/today` return, per block, `lowestHourly`, `shortHours` and `covered` (`07-api-spec.md` §4.2). The wall display stays counts only.
2. **A pay period can't be locked while any shift in it that has ended lacks an actual** (a time entry or an absence). The API refuses with `409 missing-actuals`; the UI disables "Lock pay period" and says how many are missing. The demo generator must give every past shift an actual (self-check 8).
3. **The rule version review shows dry-run impact as counts** by rule, unit and date, never names, because `RULES_APPROVER` has no roster access (`09-access-control.md` §2).
4. **Proposals are decided with an explicit Accept or Decline per item**, sent once; accepted items re-run the rules and follow the normal 422 / acknowledge / override contract.
**Why:** (1) with hourly coverage (ADR-013) a single block number can read `5 / 5` while two hours are short; (2) exporting a period with unrecorded shifts would put wrong figures into payroll; (3) keeps the permission matrix true on every screen; (4) "not yet decided" must stay visible, and nothing auto-approves (HANDOFF guardrail 3).
**Consequences:** extra fields in two endpoints; one new problem type; boundary test and scenario T14 in `10-testing.md`; generator self-check 8.

## ADR-018 — Audit-log role grants deferred to a pilot; triggers are the prototype's proof
**Status:** Accepted (2026-11-20, from review of `502c434`)
**Decision:** `V1__schema.sql` creates no database roles or grants. The prototype runs migrations and the app as one database user (the `postgres` image's `POSTGRES_USER`). Append-only audit is enforced by triggers that raise an error on `UPDATE`, `DELETE` and `TRUNCATE` of `audit_event`, and repository tests prove them.
**Why:** a separate application role needs a second set of credentials and a role-aware Flyway setup, which adds setup risk for the reviewer without changing what the demo can show. The triggers block every application path, including bugs.
**Limit (stated honestly):** the single user owns the tables and is a superuser in the official image, so it could drop or disable the triggers. The trigger protects against application error and ordinary SQL, not against someone holding the database owner's credentials.
**Pilot:** a migration-owner role and an application role with `INSERT, SELECT` only on `audit_event`; audit retention per the records schedule. Recorded in `08-deployment.md` §9.
**Supersedes:** the earlier wording in `06-data-model.md` and `09-access-control.md` that the application role had `INSERT, SELECT` only.

## ADR-019 — S-04 (overtime authorization) is enforced by the workflow, not a decision table
**Status:** Accepted (2026-11-20, lead's decision). **Confirmed by the person on 2026-11-20.**
**Decision:** S-04 has no rule table and no `RequiresAuthorization` template. `EXTRA` shifts and overtime offers can be created or confirmed only by a `SUPERVISOR` (`POST /assignments`, `POST /open-shifts/{id}/offers|assign`, `POST /offers/{id}/confirm`, `POST /proposals/{id}/decision`), and each writes an `audit_event` with actor and time. An employee accepting an offer doesn't create the assignment; the supervisor's confirmation does.
**Why:** "who may authorize" is a permission, already enforced by role and scope checks (`09-access-control.md` §3) and proven by the authorization tests; a configurable table would let an admin switch off a safeguard (HANDOFF guardrail 3).
**Consequences:** `05-union-rules.md` §2E and §4 updated; S-04 is tested by the authorization tests (an `EMPLOYEE` creating or confirming an `EXTRA` shift gets `403`) and by checking the audit event, not by the rule boundary matrix.

## ADR-020 — Demo data sizing correction: 2% sick + 2% vacation, overtime band 3–8%
**Status:** Accepted (2026-11-20, `orch.lead` while the project lead was away). **Confirmed by the person on 2026-11-20.** Found by the generator build (`docs/ai-dev-log.md` #27).
**Decision:** the demo generator uses about **2% sick + 2% vacation** (was 4% + 4%), and self-check 4 accepts **3–8% overtime** of worked hours (was 3–6%).
**Arithmetic (per 2-week pay period, 80 h threshold, ADR-016):**
- 12 h crews, 60 officers on 2 × 00–12, 2 × 12–24, 4 off. That's 48 h per 8 days, so **84 h** per period, and 4 h of overtime each before any absence is covered: 60 × 4 = **240 h**.
- 8 h staff, 30 officers on 5 on, 2 off: **80 h**, exactly at the threshold, so every extra shift they take is overtime.
- 16 h staff, 10 officers on 1 on, 2 off: about **74.7 h**.
- Worked hours with nobody absent: 60 × 84 + 30 × 80 + 10 × 74.7 ≈ **8,190 h**. Structural overtime alone is 240 / 8,190 ≈ **2.9%**.
- Absent hours are refilled mostly by extra shifts, and almost everyone available is already at or over 80 h, so nearly every refilled hour is overtime:
  - 8% absences: up to about 2.9% + 8% ≈ **11%** overtime, so the 3–6% band can't hold.
  - 4% absences: up to about 2.9% + 4% ≈ **7%**, which fits inside 3–8%.

  These are upper bounds: an absent 12 h officer also loses some of their own structural overtime.
**Doesn't change:** HANDOFF §4's dataset decisions (100 fictional officers, 90 days 1 Oct – 29 Dec 2026, "today" 19 Nov, seed 20261001), the rotations, the staffing requirements, or the overtime rule. It changes only the absence rates and one self-check threshold.
**Trade-off:** fewer absences mean fewer coverage gaps to demonstrate. Gap filling, unfilled gaps (self-check 3) and the planted cases are unaffected.

## ADR-021 — Save-time safeguards: one scope guard, one officer lock, overrides never swallow warnings
**Status:** Accepted (2026-11-20, from the dev-qa / review-r2 review of `0dc96e1`; the lead routed the findings).
**Decision:**
1. **Preview and save share one authorization path.** `POST /rule-checks` delegates to the same service method as `POST /assignments`, so a supervisor's preview is unit-scope checked (404 outside scope) and an employee can preview only their own record on their own unit.
2. **Saves are serialized per officer.** `POST /assignments` takes `pg_advisory_xact_lock` on the employee id before evaluating the rules, so two concurrent saves cannot both pass against the same old roster. The overlap exclusion constraint stays as the last line of defence and now answers `409` rather than an error page.
3. **An emergency override does not acknowledge warnings.** A request that overrides a `BLOCK` must also list every `WARN` code in `acknowledgeWarnings`; otherwise it is refused with `422 warnings-need-acknowledgement`. Nothing auto-approves.
4. **Bad input never becomes a 500.** Unknown identifiers answer `404`, a malformed or incomplete body answers `400`, and every error is RFC 9457 `problem+json` with no stack trace or internal class name.
**Why:** the review proved each of these with a working probe: a supervisor previewed a unit outside their scope; two parallel saves both created shifts that break U-01; an override silently approved warnings; and bogus ids returned 500 pages. All four are HANDOFF guardrail 3 or the RFC 9457 contract in `07-api-spec.md` §1/§3.
**Consequences:** the preview's employee-own path is unchanged; the rule check now reads the published version from `rule_set_version` instead of a constant (so a published v2 is reported without a code change); `existingShifts` reads 28 days back (U-11 needs 28 days) and 14 days forward; `AuthorizationMatrixTest`, `AssignmentApiTest` and `ProblemDetailsApiTest` prove each case.

## ADR-022 — Pay-period lock, unlock and payroll export are facility-wide; double lock is idempotent
**Status:** Accepted (2026-11-20, `orch.lead` while the project lead was away, from dev-qa's step 9 PASS). **Confirmed by the person on 2026-11-20.**
**Decision:**
1. A pay period has no unit (`pay_period` in `06-data-model.md`), so locking, unlocking and exporting can't be scoped to units. **Any supervisor with at least one unit in scope** may lock, unlock (with a reason) and export the facility's period. The auditor reads it. Each action is audited with the actor; unlock also records the reason, and export records the file hash.
2. **Locking an already locked period is idempotent:** it returns `200` with the period view and writes no second audit row.
**Why:** payroll runs per period for the whole facility. Splitting a period by unit would mean partial locks and partial exports that payroll can't use. The idempotent lock makes a double click or a retry harmless, without a misleading second audit entry.
**Trade-off (stated plainly):** one supervisor can lock or unlock the period for every unit, and the export carries pay lines (employee number, hours, pay codes) for officers **outside that supervisor's scope**. This is wider than the unit scope used everywhere else (`09-access-control.md` §2). The audit trail makes it visible, but it doesn't prevent it.
**Pilot:** restrict lock and export to a payroll-clerk role (or a payroll office), or require a second approver for unlock and export, and review who can see facility-wide pay lines under FOIP.
**Consequences:** `09-access-control.md` §2 (the record-actuals row stays unit-scoped; lock, unlock and export are facility-wide) and `07-api-spec.md` §4.5 updated; each facility-wide cell needs an authorization test (a supervisor with any scope allowed, the auditor and others refused) — check they exist before calling step 9 complete.

## ADR-023: Override policy defaults. Only rules marked emergency can be overridden; the U-08, U-09 and U-14 Blocks can't be
**Status:** Accepted (2026-11-20, `orch.lead` while the project lead was away). **Confirmed by the person on 2026-11-20.**
**Context:** `05-union-rules.md` said U-14's Block allowed an override. Rule set v1 (`RuleRowsV1.java`, `V2__reference_data.sql`) gives U-14, U-08 and U-09 the override policy `ACKNOWLEDGE`, and the api refuses an emergency override for a Block with that policy. The full-stack e2e run made this visible: PC-01 (Nia) blocks on U-01, U-05 and U-14, and no override is offered.
**Decision:** keep the code. Only Blocks whose policy is `EMERGENCY` can be overridden, with a reason of ≥ 10 characters, and audited: U-01, U-03 and U-05 in v1 (U-06 when built). The U-08 (consecutive days), U-09 (consecutive 12 h shifts) and U-14 (60 h weekly ceiling) Blocks can't be overridden in v1. The override policy is a column of each rule row, so a ministry can loosen it through the rules admin's maker/checker flow without a code change.
**Why:** a Block that nothing can override is the safer default; no safeguard is weakened. Loosening a rule then becomes a deliberate, approved and audited rule change, not a per-shift decision.
**Trade-off (stated plainly):** a real lockdown that needs a 61st hour in a week, or an 8th consecutive day, can't be saved without a rules change. The answer today is to change the rule through maker/checker. That is slower than an emergency override, but fully audited.
**Consequences:** `05-union-rules.md` §2 (legend, U-06, U-08, U-09, U-14), §3 notes and the §5 example; `10-testing.md` §1 and the U-14 boundary row; `09-access-control.md` §2 override row; `02-requirements.md` FR-23. The demo shows PC-01 as the Block with no way around it, and PC-03 (U-05, a lockdown) as the legitimate override.

## ADR-024: Cross-unit cover. A supervisor may assign an officer from any unit into a unit they run
**Status:** Accepted (2026-11-20, `orch.lead` while the project lead was away, from review-r3's authorization pass). **Confirmed by the person on 2026-11-20: keep it.**
**Context:** `docs/09` §3 said the scope guard checks "the target unit, or the target employee's unit". The code checks the **target unit only** for a supervisor (`AssignmentService.preview` and `assign` call `ScopeGuard.requireUnit` on the shift's unit). So a supervisor can preview and save a shift for an officer whose home unit is outside their scope, as long as the shift is in a unit they run.
**Decision:** keep the code. This is cross-unit cover: an officer from another unit works an extra or covering shift in a unit the supervisor runs, which a 24/7 centre needs when relief is short. A supervisor:
- **may** assign an officer from any unit into a unit in their own scope;
- **sees** that officer's rest and hours conflicts in the rule preview, because the decision needs them;
- **can't** assign into a unit outside their scope (`404`);
- **can't** read an officer's data outside their scope except through that preview.
**Trade-off (stated plainly):** the preview reveals one officer's rule results, such as rest gaps, hours in 24 h and weekly hours, to a supervisor of another unit. It shows nothing else about that officer.
**Pilot:** allow cross-unit cover only for officers whom their home unit has explicitly shared (a cover pool), or ask the home unit's supervisor to approve, and review it under FOIP.
**Consequences:** `09-access-control.md` §2 (assign row) and §3 (API scope); `07-api-spec.md` §4.2 Roles.

## ADR-025: The sign-in token stays in memory only; a refresh asks for sign-in and returns to the screen
**Status:** Accepted. **Confirmed by the person on 2026-11-20.** Raised by the UI test round (defect D11, found by dev-qa).
**Context:** the web keeps the signed token in memory, not in `localStorage` or `sessionStorage`. A full page reload or a deep link therefore starts without a session. Before the fix, that showed four `401` answers and page errors on screens such as Reports instead of the sign-in screen.
**Decision:** keep the token memory-only: no `localStorage`, no `sessionStorage`, no cookie written by the web. A screen opened without a session goes to `/login` with "Please sign in to continue." After sign-in the person returns to the screen they asked for. The return path is validated (`web/src/shell/returnPath.ts`: in-app paths only), so the sign-in screen cannot be used as an open redirect.
**Why:** a token in web storage can be read by any script that runs on the page. The prototype's sessions are short (8 h), and a refresh is cheap with mock sign-in. A pilot moves to government SSO, where the session is the identity provider's.
**Trade-off (stated plainly):** every refresh, new tab or deep link asks for sign-in again.
**Consequences:** `web/src/shell/RequireSession.tsx`, `LoginPage.tsx`; e2e `session-and-nav.spec.ts` (reload on `/reports/coverage` and `/planning` lands on sign-in with the notice and no page errors, then returns); `10-testing.md` §8 and README list it as a known limit.


## ADR-026: Quarter planner — deterministic heuristic, rule-verified draft, confirmed pattern defaults
**Status:** Accepted (2026-11-21). **Confirmed by the person on 2026-11-21** (via operator-agent), with the later refinements recorded here: the plan starts Mon 4 Jan 2027 (00:28Z); weekends rotate (00:29Z); the 8 h default is the rotating 5 on / 2 off pattern (option F, 01:56Z); only 12 h officers work nights (02:24Z); the real 12 h shifts are D12 07:00–19:00 and N12 19:00–07:00, run by separate day and night crews (02:26Z); a "16 h shift" is a 12 h shift plus about 4 h worked as an extension (02:29Z); actual times feed the rule checks where a time entry exists (02:35Z); dataset 120 is 100 full-time crew officers plus 20 casual relief officers (04:19Z); planned absences are a read-only planner input (05:21Z).
**Context:** the person wants a facility-level planner to build a whole-quarter draft from preferences and seniority, then supervisors adjust it. The rules engine is the product's safety boundary; a solver would put a second copy of the rules beside it, and a time-boxed solver would not be deterministic. The deadline leaves one day for verification.
**Decision:**
- **Heuristic, not a solver.** Deterministic constructive placement with a fixed seed and stable ordering; a bounded local search is a Should and was not built. The same seed and data produce the same plan (pinned by `PlannerApiTest#theSameSeedAndDataProduceTheSamePlan`).
- **The engine is the only rule source.** Every proposal goes through `RuleCheckService.evaluate(proposed, facts)` — the same fact builders and published rule base as the planning board — against the draft's own assignments **plus the committed history before the window**. A Block rule means the shift is not placed and the hour stays a visible gap; warnings are kept and counted. This is the seam review-r2 checks.
- **Window and carry.** Seven 14-day pay periods, Mon 4 Jan – Sun 11 Apr 2027 (98 days; 13 weeks plus one week). The 35 days before the window are the look-back for rest, consecutive days and 7/28-day windows. Under `ROTATING_5_2`, period −1 (21 Dec – 3 Jan) would have the pair one weekday later than period 0; the seeded history is read, never rewritten. The committed quarter also creates its seven pay periods and each unit's seven schedule periods (review-r2 gap), so the plan can be locked and paid.
- **Patterns.**
  - 8 h `ROTATING_5_2` (**default, chosen by the person on 2026-11-21**): the days-off pair retreats one weekday per pay period; at the Sun-Mon wrap it takes a 3-day break (Mon-Wed) plus a Mon-Tue break, so the changeover period is 72 h and there is no Sun-Mon state. For some phases the pattern would create a seventh consecutive work day; the engine blocks that shift, so the generator leaves it out and the officer has a second 72 h period instead. The person accepted the honest cost. Weekends rotate for every officer. The person accepted the honest cost: at the changeover an officer has one U-12 warning and one U-14 warning per quarter, and hours are balanced over the quarter (72 h one period, 80 h the rest), not per period. Evidence: `RotatingBreakProbeTest` (variant F) and the decision table (F avg 0.86 U-12/U-14 per officer, 72-80 h, quarter 78.86, weekends 22/22/22); fixed is 0 warnings and exactly 80 h but pins weekends.
  - 8 h `5_ON_2_OFF` (selectable): fixed pair per officer, phases staggered; 80 h every period, no warnings, some officers always work weekends (scorecard weekends min/avg/max).
  - 8 h `7_ON_3_OFF` (selectable): the existing 10-day cycle; warnings show honestly.
  - 12 h: the 100 seed uses A12 00–12 / P12 12–24, 4 on / 4 off. V6 adds the real D12 07–19 and N12 19–07 templates and rule set v2; the 120 dataset runs separate D12 day and N12 night crews, 4 on / 4 off, paired phases so the post count is exactly covered every day (84 h per period, 4 h structural overtime per officer, reported in the scorecard).
  - 16 h: **not generated by the planner**. In practice a "16 h shift" is a 12 h shift plus an extension of about 4 h worked as overtime and recorded after the fact (the U-04/U-05/P-01 paths); the person confirmed this on 2026-11-21. A 16 h preference is stored and shown unmet with the plain reason "the planner does not roster 16-hour shifts"; the seeded L16 officers, the L16 template and rules U-03/U-05/U-11 are untouched. Retiring L16 is a post-freeze option once the person confirms.
  - One shift kind per work block; a kind change happens only across off days, because P12→A12 or N8→D8 the next day is zero rest and the engine blocks it.
- **Nights are 12 h only (person, 2026-11-21).** An 8 h officer works D8 or E8 and is never rostered on N8; the block grouping only builds DAY and EVENING groups for 8 h staff. 12 h officers cover nights with A12 in the 100 seed; the real D12 07-19 / N12 19-07 crews are the V6 baseline (templates and rule rows), and the 120 planner-demo dataset runs them with separate day/night crews, including ADM and ESC under a local agreement (the 100 seed keeps `allows_12h=false` for those two units). An 8 h officer's NIGHT preference stays stored and is shown unmet with the plain reason "only 12-hour officers work nights"; the scorecard carries the same `nightPolicy` sentence. With crew rows (the 120 dataset) the N12 crew is fixed and the dataset seeds the newest officers into it; the scorecard reports `n12Officers`, `n12NightShifts` and a crew note. Without crew rows (the 100 seed) the night block takes volunteers first in seniority order, most senior first, then the rest newest-first (seniority date descending, ties by employee id). Cross-unit cover is never generated. The scorecard's `newestFirstHeld` and sentence come from this ordering.
- **Preferences are soft.** Shift length 8/12/16, time of day and up to two preferred days off, seeded synthetically for the 100 demo officers deterministically from the dataset seed and the officer number (demo data, not part of the roster checksum). They are visible to PLANNER only; an officer edits their own at `/me/preferences`. Where staffing and the rules do not allow a wish, the scorecard counts it unmet rather than bending a rule.
- **Draft and commit.** A draft lives in `plan_draft`, `plan_draft_assignment` and `plan_draft_gap` and never touches `shift_assignment` until commit. Commit (a) re-runs every rule check against the current committed state, refusing any Block with a per-assignment failure list; (b) requires the exact warning list count to be acknowledged in one decision; (c) requires `If-Match` with the draft version and answers 412 when stale; (d) refuses a locked period with 409; (e) writes every row and one `commit_plan` audit event in a single transaction, linking each row to its draft (`shift_assignment.plan_draft_id`). Overrides are never implied (ADR-021).
- **Role.** A new facility-level `PLANNER` role (all units), read-only on the planning board like the auditor. Supervisors stay unit-scoped. `GET /planner/preferences` is PLANNER-only.
- **Scorecard.** Coverage gaps (short block-days of all block-days, measured in absolute time: the NIGHT block on date D runs 23:00 D to 07:00 D+1, the same code the board uses), warnings grouped by plain rule name — **only warnings the plan adds**: each officer's history-only warning baseline is evaluated once and subtracted, because the seeded roster's own windows are not this plan's doing; preference asked/met by kind, night share by seniority band plus the newest-first check and nights against a wish, `nightPolicy` (only 12 h officers work nights), officers and hours over 80 per period, generation milliseconds, and weekends worked per officer (min/avg/max).
- **Planned absences (2026-11-21).** A planner may mark a future absence with `POST /planner/absences` (employee, date, type); the next generate reads `absence` rows in the quarter and skips that officer on those dates, leaving the post to a relief/casual officer or a visible gap. This is a read-only input, not leave management: no approval, no screens, and the 120 seed does not seed leave by default. The scorecard carries an `absences` line/counts. The 100 seed's 2026 absences fall outside the 2027 window, so its plan is unchanged.
- **FTE and the casual pool (2026-11-21).** `employee.fte` now drives planning: full-time officers
  (FTE 1.0) get the pattern above; officers with FTE < 1.0 are a fill pool with no guaranteed hours,
  taken after full-timers are placed, nights first, newest-first, one shift at a time, each proposal
  engine-verified and never above FTE × 80 hours in a pay period. The scorecard reports hours
  against target by FTE band and says plainly that part-time/casual officers fill what is left;
  unfilled gaps stay gaps.
- **Actual times in rule checks (person, 2026-11-21 02:35Z, amendments item 17).** Where a time
  entry exists, the fact builders use the **actual end** instead of the rostered end, so U-04,
  U-05 and the next shift's U-01/U-02 rest see a recorded extension; the next day's proposal is
  checked against the actual, not the roster. The `PUT /time-entries` body that carried both
  `workedAsScheduled` and actual times is now `400` and writes nothing. The 100 checksum and the
  payroll golden are unchanged; 132 seeded entries legitimately differ from the roster, so some
  seeded checks now cite actual times (e.g. Unit A N8 13 Nov: U-01/U-05/U-14 BLOCK with a
  94-minute actual). Known limit: an actual recorded after later shifts already exist is not
  re-checked (audited, post-freeze).
- **Demo reset and dataset 120 (person, 2026-11-21 04:19Z, option B).** The reset card selects
  `100` (the default seed, unchanged) or `120` = 100 full-time crew officers + 20 casual relief
  officers (FTE 0.4–0.8). The reset is a Flyway clean+migrate seeded by the selected provider,
  asynchronous, one at a time, PLANNER-only and audited; a reset back to 100 restores the 100
  checksum and the V3 unit flags. The 120 provider is the crew dataset in
  `DATASET120-SPEC.md` (38 N12 + 54 D12 + 3 E8 + 5 relief + 20 casuals); it is a separate provider,
  not a change to the 100 seed.
**ESC evening cover (known):** Escort & transport has only D12/N12 crews and no E8 officer; its 19-23 evening requirement is deliberately thin, and all 38 gaps in the 120 plan are ESC evening block-days (measured). Adding an E8 crew or more N12 posts would close them; the demo states this rather than hiding it.
**Trade-offs (stated plainly):** the default rotates weekends but every officer still gets a fixed 5/2 rhythm within a period; the fixed pattern keeps some officers on weekends and says so; a constructive plan has more gaps than a solver might (gaps are visible and fillable, never hidden); a draft can become stale between preview and commit, which the ETag and the re-check catch. **Night capacity is now explicit:** with 14 effective 12 h officers for 19 night posts a day, every unit-night is short (588 short night block-days; 727 gaps of 1,764 in the default plan after the paired 12 h phases; DAY 109, EVENING 30), and 8 h casuals cannot fill nights. The 120 dataset must carry at least 38 N12-capable officers (4-on/4-off) plus the qualified mix before the night gaps can close.
**Consequences:** `V5__planner.sql`, `PlanGenerator`, `PlannerService`, `PlannerController`, `PreferenceController`, `RuleCheckService.evaluate(ShiftFact, List<ShiftFact>)`; `PlannerApiTest`, `WeekendRotationProbeTest`; `07-api-spec.md` §4.9, `09-access-control.md` §2, `06-data-model.md` §6.

## ADR-027 — D12/N12 crews and rule-set v2 (additive)

**Status:** Accepted (2026-11-21), after the person's amendments 13/14 (02:24Z and 02:26Z), the GO on D12/N12 at 02:27Z, and the option-B dataset 120 choice at 04:19Z.
**Decision:** V6 adds the `D12` 07:00–19:00 and `N12` 19:00–07:00 templates (effective 2027-01-04)
and publishes baseline rule-set version 2. U-02's `afterShiftKind` becomes
`(D8|E8|N8|A12|P12|D12|N12)` — additive, existing kinds unchanged — and U-10's wording is
"overnight 19-07" (its `SHIFTS_NIGHT_12H` counts A12 and N12). `ShiftFact.isTwelveHour` and
`nominalMinutes` recognise both; the consecutive-run builder counts N12 as an overnight. No rule is
loosened, no severity or override policy changes.
**Isolation:** the 100 seed keeps A12/P12/L16 assignments, its checksum
`3390148255...6539`, the payroll golden and `allows_12h=false` for ADM/ESC; a reset test pins all
four. The 120 dataset provider sets `allows_12h=true` for ADM/ESC when it seeds (the reset is
Flyway clean+migrate, so switching back to 100 restores the V3 flags). The planner reads
`rotation_pattern.code` (`D12_*`, `N12_*`, `D8_*`, `E8_*`, `CASUAL_12/8`) and keeps crews separate;
12 h phases are paired (j and j+4) so a crew of 2p covers exactly p posts every day. The 100 plan
gained day cover from the pairing (789 → 727 gaps), which is an allocation improvement, not a rule
change.
**Governance (review-r2, SAFE WITH NOTES):** V6 seeds version 2 directly as PUBLISHED, exactly like
version 1: `created_by`/`approved_by` are NULL, `change_reason` is recorded, and there is no
`audit_event` row. That is the **baseline-seeding exception**, not the product's change path; every
later version goes through maker/checker (ADR-019, docs/04 §6). U-10's message now reads "overnight
(00-12 or 19-07)" because the counter still includes A12 00-12 night-block shifts from v1 as well as
N12 19-07; behaviour is otherwise unchanged.

**Evidence:** `HoursAndRunsRulesTest` D12/N12 cases (U-02 after N12, U-09 4/5, U-10 4/5, U-14
48/60/68, U-05 16/16.25), `PlanGeneratorCrewTest` (196 N12 on 98 nights, separate crews, no
N8/L16), `ReferenceDataMatchesRuleRowsTest`, `DemoResetApiTest`, `DemoOperationLockTest`.
**Post-freeze:** retire L16 once the person confirms; re-check the payroll golden if the 100 seed
ever switches to D12/N12 (N12 crosses midnight and pay-period boundaries).
