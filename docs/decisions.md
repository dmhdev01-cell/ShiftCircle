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
**Decision:** Required staffing is defined per unit per block (Day 07–15, Evening 15–23, Night 23–07), optionally with a qualification minimum. A shift counts toward a block when it covers at least half of it, so a 12-hour day counts toward Day and Evening.
**Alternatives:** headcount per shift only (too coarse for qualification checks); named posts (most realistic, but much more setup). Named posts remain a future extension of `unit_requirement`.
**Status note:** to be confirmed against real practice.

## ADR-014 — API conventions: REST, Problem Details, rule results in 422
**Status:** Accepted (2026-11-19)
**Decision:** REST/JSON under `/api/v1`, OpenAPI generated from code, RFC 9457 Problem Details for errors, rule outcomes returned as `422` with a `ruleResults` extension, a separate preview endpoint (`/rule-checks`), explicit `acknowledgeWarnings` and `override.reason` fields, and optimistic locking with ETags.
**Why:** predictable for reviewers and future integrators; makes "the rules said no" a first-class, explainable response rather than a generic error.
