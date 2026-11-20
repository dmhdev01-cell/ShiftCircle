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
**Decision:** Use Drools 10.x (Apache KIE), embedded in the API. Developers write rule **templates** and Java **fact builders** (the time-window maths). Non-technical admins edit **decision-table rows** in a friendly in-app grid, with plain-language previews and an Excel round-trip. Changes go through validate → compile → regression test → dry run → maker/checker approval → hot publish, with versioning and rollback.
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

