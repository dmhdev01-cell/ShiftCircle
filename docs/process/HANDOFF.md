# Handover note: ShiftCircle → OpenRig

**Date:** 2026-11-19 (America/Regina) · **From:** Claude (design and documentation phase) · **To:** OpenRig (implementation) · **Owner:** the project lead (repo owner)

Read this first, then the docs it points to. Everything needed to start building is in this repo.

---

## 1. What this is

ShiftCircle is a **working prototype** for the *AI Solutions Architect – Screening Assessment* (Government of Saskatchewan). It schedules 8- and 12-hour shifts (a 16 h day is a 12 h shift plus an extension) at a fictional 24/7 provincial correctional centre, checks every change against a **configurable Drools rules engine** that non-technical staff can edit, and feeds time to a simulated payroll export.

**The assessment** (summary; the lead has the original PDF):
- Seven calendar days from the invitation; **check the exact deadline with the lead**.
- Submit: working prototype + source + setup instructions; a **≤ 5-minute demo recording**; a **build record of ≤ 2 pages** (architecture, design decisions, AI-assisted development, 2–5 test cases incl. a failure/boundary case, governance and next steps).
- Scoring: usefulness/functionality/ease of use **30%** · technical implementation **25%** · governance and ministry suitability **20%** · creativity/simplicity/fit **15%** · effective use of AI and verification **10%**.
- A small, well-executed solution can get full marks; extra features don't automatically score higher. **Prefer finishing the Must list well over adding features.**
- AI must be used during design/development; **runtime AI is not required and is deliberately not used** (ADR-005).

## 2. Status

| Area | Status |
|---|---|
| Scope, requirements, architecture, rules engine design, mock union rules | ✅ Written (`docs/01`–`05`) |
| Data model, API spec, deployment spec, access control | ✅ Written (`docs/06`–`09`) |
| Test strategy and demo dataset spec | ✅ Written (`docs/10-testing.md`) |
| UI design: 6 screens + full UI spec | ✅ In `docs/ui/` |
| AI development log | ✅ Started (`docs/process/ai-dev-log.md`); **keep it updated** |
| Code | ✅ Built and on `main`: `api/` (Java 21, Spring Boot 4.x, Drools), `web/` (React), `docker-compose.yml`, `e2e/`, GitHub Actions CI. Every step in §6 is done except the items listed as not built in `docs/10-testing.md` §8 |
| Build record, demo script | ✅ `BUILD_RECORD.md`, `docs/demo-script.md` |
| Demo recording | ⏳ Made by the project lead (not part of the repository) |

*This note was written on 2026-11-19, before any code existed. §2 was brought up to date on 2026-11-24; the rest is kept as the brief the team worked from. Where §3 to §9 and the current docs differ, the current docs win (`docs/index.md` has the map).*

## 3. Repo map

```
README.md                    overview + doc index
docs/process/HANDOFF.md      this file
docs/01-scope-and-plan.md    problem, users, priorities (F1–F13), assumptions, plan
docs/02-requirements.md      screens, FR/NFR, rules summary, data needs
docs/03-architecture.md      containers, layers, change flow, security overview
docs/04-rules-engine.md      Drools design: fact builders + editable decision tables + publish pipeline
docs/05-union-rules.md       mock collective-agreement rule set (U-, P-, S-, O-, L- rules) with sources
docs/06-data-model.md        PostgreSQL schema, constraints, ER diagram, migrations
docs/07-api-spec.md          REST endpoints, rule-check/override contract, screen→endpoint map
docs/08-deployment.md        docker compose topology, env vars, startup, nginx, pilot path
docs/09-access-control.md    roles, permission matrix, enforcement, mock sign-in, privacy
docs/10-testing.md           test layers, rule boundary matrix, scenarios, E2E flows, dataset spec
docs/ui/README.md            UI spec: tokens (Sask palette), components, every screen, routes
docs/ui/screens/*.dc.html    exact design files (reference markup, not runnable)
docs/decisions.md            the decision log (ADR-001 … ADR-030)
docs/process/ai-dev-log.md   AI-assisted development log (assessment requirement)
```

## 4. Decisions already made (don't reopen without asking the lead)

| Decision | Where |
|---|---|
| Three containers only: **web** (nginx + React/TS/MUI), **api** (Java 21 + Spring Boot 4.x + Drools 10.x embedded), **db** (PostgreSQL 17) | ADR-006, ADR-011, ADR-012, `08-deployment.md` |
| **No AI at runtime**; rules engine decides; a supervisor approves every change | ADR-002, ADR-005 |
| **Drools decision tables** edited by non-technical admins via an in-app grid (Excel round-trip: future work, not built); time maths in Java fact builders; maker/checker publish with tests and dry run | ADR-012, `04-rules-engine.md` |
| Coverage **by unit and block**, measured **hourly** | ADR-013 (revised), `10-testing.md` §6.3 |
| **Shift times (configurable defaults):** 8 h 07–15 / 15–23 / 23–07; 12 h 00–12 / 12–24. L16 (16 h 20:00–12:00) is retired (V13 inactive, ADR-029); a 16 h shift is a 12 h shift plus an extension. Edited as a "Shift types" table through the rules approval flow. | ADR-015, ADR-029 |
| **Overtime = hours beyond the pay-period threshold** (default 80 h per 2 weeks; weekly 40 h selectable), not a property of a shift. Shifts are `ROSTERED` or `EXTRA`. | ADR-016 |
| API: REST `/api/v1`, Problem Details, rule results as `422` with `ruleResults`, preview endpoint, ETags | ADR-014, `07-api-spec.md` |
| Scope: planning board, employee view, overtime, time + payroll export, reports, rules admin, wall display. **Trades and notifications are future work.** | ADR-009, ADR-010 |
| Data: **100 fictional officers, 90 days** (1 Oct – 29 Dec 2026), "today" = 19 Nov 2026, seed 20261001 | `10-testing.md` §6 |
| Look: **Government of Saskatchewan digital standard** colours and Source Sans; **no government logo, wheat sheaf or coat of arms** | `docs/ui/README.md` §2–3 |

## 5. Guardrails (non-negotiable)

1. **Synthetic data only.** No real names, real staffing levels, real post layouts or non-public operational details. The lead's spouse works at a correctional centre and provides domain insight. That shapes rules and workflows only, never data.
2. **No secrets in the repo.** Ship `.env.example` only; the API must refuse to start without `POSTGRES_PASSWORD` and `SC_JWT_SECRET`.
3. **Never weaken a safeguard to make a demo work:** no auto-approval, no bypassing Block rules without an override reason, no editing audit rows, no skipping maker/checker.
4. **Every rule needs boundary tests** (under / exactly / over), reviewed by a human, not only generated.
5. **Log AI use** in `docs/process/ai-dev-log.md`, especially suggestions you corrected or rejected. That's 10% of the marks.
6. **Keep docs in sync** with what's built; record new decisions as ADRs.
7. **Commits:** small and descriptive. The lead pushes to GitHub (`dmhdev01-cell/ShiftCircle`, public since 23 Nov 2026).
8. Keep the footer line on every screen: "Not an official Government of Saskatchewan service · fictional, synthetic data only".

### Governance exceptions (recorded so the build record can't overstate them)

| Guardrail | Exception | Status |
|---|---|---|
| 4: boundary tests reviewed by a human | **Waived by the project lead on 2026-11-20.** The rule boundary tests are reviewed by AI verifiers instead: `dev-qa` (GLM 5.3, with mutation spot-checks) and `review-r2` (GLM 5.3, independent of the DeepSeek author). **No human review of the boundary tests has taken place.** | A pilot should restore human review (a labour-relations or scheduling practitioner) before any rule set is relied on. See `docs/process/ai-dev-log.md` #24. |

## 6. Next steps for development (in order)

Each step lists its "done when" check. If time runs short, cut from the bottom of the Should list (`01-scope-and-plan.md` §5), never from testing or governance.

| # | Step | Done when |
|---|---|---|
| 1 | **Compatibility spike (do first, ≤ half a day):** minimal Spring Boot 4.x app on Java 21 that compiles a Drools rule template + data rows into a KieBase and fires one rule (U-01) in a stateless session | Test passes in Docker. **If it fails:** try Spring Boot 3.5.x; record the result and the governance trade-off (3.5 is past free support) as an ADR. |
| 2 | **Scaffold:** `api/` (Maven multi-module per `03-architecture.md` §2), `web/` (Vite React TS + MUI theme from `docs/ui/README.md` §3), `docker-compose.yml`, `.env.example`, nginx config, health checks | `docker compose up --build` serves an app shell at http://localhost:8080 with the Sask-styled top bar, nav and footer; `/api/v1/version` returns build info |
| 3 | **Database:** Flyway `V1`–`V3` per `06-data-model.md` (incl. `btree_gist` exclusion constraint, locked-period trigger, append-only audit, maker/checker check) | Repository tests prove each constraint (T10, T11 and overlap) |
| 4 | **Rules engine:** fact builders (rest gaps, rolling hours, consecutive runs, 16 h shift counts, days off, hours so far in the week and pay period); templates for the 8 rule tables; rule set v1 from `05-union-rules.md` | The full boundary matrix in `10-testing.md` §3 passes |
| 5 | **Demo data generator** per `10-testing.md` §6, with self-check | Self-check passes; planted cases PC-01…PC-09 exist with stable IDs; same seed gives the same checksum |
| 6 | **Core API:** mock sign-in + JWT + role/scope enforcement; `GET /schedule`; `POST /rule-checks`; assignments with the 422 / acknowledge / override contract; audit events | API and authorization tests pass (one per denied/scoped cell of `09-access-control.md` §2) |
| 7 | **Planning board UI** + rule-check panel + override dialog | E2E flow E1 (block part) passes |
| 8 | **Overtime:** open shifts, ranked candidates (O-01…O-03), offers, accept, confirm; employee **My schedule** with offer card | E1 + E2 pass; T6 passes |
| 9 | **Time & attendance:** actuals, period-based overtime (P-01, P-01b, P-04), lock/unlock, **payroll CSV** | T8 golden file passes; E4 passes |
| 10 | **Reports:** coverage (hourly-based), hours, overtime, overrides; CSV export | Numbers reconcile with time entries; NFR-05 timings met |
| 11 | **Rules admin** (incl. the **Shift types** table, ADR-015): decision-table grid, plain-language sentences, build (validate → compile → scenarios → dry run), submit, approve, publish (hot swap), version history | T7, T10, T13 and E3 pass |
| 12 | Should items if time allows: **wall display** (E5), shift planner/proposals, Excel round-trip (not built: docs/10 §8), audit viewer | Their tests pass |
| 13 | **Submission:** `README.md` setup section, `BUILD_RECORD.md` (≤ 2 pages; architecture diagram, decisions, AI use with ≥ 1 rejected suggestion, 2–5 tests T2/T3/T7/T8/T9, governance and next steps; governance must state the guardrail 4 exception in §5, and next steps must list restoring human review of the boundary tests), `docs/demo-script.md`, ≤ 5-minute recording | A clean clone + `docker compose up` works on a second machine; the recording shows working vs simulated parts and one safeguard |

## 7. Testing: what's required (summary of `docs/10-testing.md`)

- **Rule boundary tests** for every rule at under / exactly / over its limit, including midnight and month-end crossings. Fast, no Spring, no DB.
- **Scenario library** T1–T13 as data files. The rules publish pipeline runs it too, so a rule change can't go live if a scenario fails.
- **Integration tests** with Testcontainers PostgreSQL for constraints, triggers, ranking and payroll classification.
- **Authorization tests**: one per denied or scoped cell of the permission matrix; out-of-scope reads return 404.
- **Payroll golden file** for the locked period 26 Oct – 8 Nov.
- **Generator self-check** (no overlaps; no unexplained Block violations; coverage ≥ 97.5% of hour-slots; overtime 3–8% of hours with a realistic skew, ADR-020; reproducible checksum).
- **Playwright E2E** for flows E1–E5 on desktop and tablet viewports, with **axe** accessibility checks and a keyboard-only run of E1 and E3.
- **Performance smoke** for NFR-05 (planning board < 1 s, rule check < 200 ms, 90-day report < 2 s).
- **Build record test cases:** use T2 (block), T3 (exact 8 h boundary), T7 (rule change without code), T8 (payroll), T9 (human judgment/override).

## 8. Open questions (ask the lead; some need a practitioner)

1. Coverage model: is **by unit and block** right, or do centres staff by headcount or by named post?
2. Shift times are the lead's best guess (ADR-015): confirm real start times. Common rotations: is 12 h "2 × 00–12, 2 × 12–24, 4 off" realistic? 8 h patterns? Which units use 16 h shifts, and on what rotation? **Confirmed (2026-11-21):** a "16 h shift" is a 12 h shift plus about 4 h extension worked as overtime and recorded after the fact (U-04/U-05/P-01). The planner rosters 8/12 h only and shows a 16 h preference unmet; L16 is retired (ADR-029) and the U-03/U-04/U-05/U-11 rules plus the extension tests stay.
3. Is there required rest after a 16 h shift or after an extension?
4. How is overtime offered (fewest hours, seniority, rotating list)? What happens to someone skipped for insufficient rest?
5. Is overtime ever ordered (mandatory), and how often per person?
6. Overtime is period-based (confirmed): what's the threshold (80 h per 2 weeks?), the rate(s), and does paid leave count toward it?
7. Schedule posting lead time and notice for changes.
8. The exact submission deadline and format.

Until answered, build with the documented defaults; they're all configuration (rule tables or seed config), not code.

## 9. Known gaps and inconsistencies to tidy

- **UI mockups show old 12 h times** (07–19 / 19–07, chips `D12`/`N12`). Build with the ADR-015 defaults (00–12 / 12–24, chips `A12`/`P12`; 16 h is 12 h + extension; L16 is retired). Mockup "OT" chips mean "extra shift"; overtime is the period status pill (ADR-016).
- **UI sample numbers vs generator:** the design files show illustrative staffing (e.g. Unit B needing 5/4/3; wall display Escort 7/6). The generator config in `10-testing.md` §6.2 is authoritative; align the UI's demo data to it when building.
- *(Built since, from the documented patterns, except the proposals inbox, rule version review and My hours, which are placeholders: `docs/10-testing.md` §8.)* **Not yet designed:** sign-in picker, time & attendance, proposals inbox, rule version review, tablet layouts (see `docs/ui/README.md` §6). Build them from the documented patterns.
- *(Historical.)* `01-scope-and-plan.md` still has a day-by-day plan from before the Drools and spec work; **§6 of this note supersedes it**.
- `02-requirements.md` §4 keeps the older R- rule IDs as a summary; the authoritative IDs are U-/P-/S-/O-/L- in `05-union-rules.md`.
- ADR-006 is partly superseded (middle tier is Java, not .NET); kept for history.
- Not yet specified in detail: frontend state/routing beyond `docs/ui/README.md` §7. *(CI now exists: `.github/workflows/ci.yml`, `docs/08-deployment.md` §10.)*

## 10. Suggested demo storyline (≤ 5 minutes)

1. **Problem and users** (30 s): 24/7 centre, 8/12 h shifts (a 16 h day is 12 h + extension), rest and overtime rules, payroll handoff.
2. **Planning board** (60 s): coverage and overtime at a glance; assign Nia → **blocked** with clear reasons (safeguard).
3. **Overtime** (60 s): fair ranked list, skipped-for-rest kept in place; offer → employee accepts on My schedule.
4. **Rules admin** (60 s): a non-technical change (12 h → 14 h), plain-language sentence, tests and dry run, second approver publishes. **No code change.**
5. **Time and reports** (45 s): lock period → payroll CSV; coverage and overtime reports.
6. **Close** (15 s): what's real vs simulated (sign-in, payroll system, data), and next steps for a pilot.
