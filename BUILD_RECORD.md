# ShiftCircle build record

<!-- SKELETON (2026-11-20). Fill each TODO with measured results only. Keep the final text to 2 pages or less: about 900–1,000 words plus one diagram. Delete these comments before submitting. -->

**What it is:** a working prototype that schedules 8, 12 and 16-hour shifts at a fictional 24/7 provincial correctional centre. A Drools rules engine, which non-technical staff edit as decision tables, checks every change. A supervisor approves every change, and the prototype feeds time to a simulated payroll export. All data is synthetic. It isn't an official Government of Saskatchewan service.

## 1. Architecture

Three containers run under `docker compose` (ADR-006, ADR-011, ADR-012):

- **web:** nginx serving a React 19 + TypeScript + MUI 9 build (pnpm, Vite). It's the only container that publishes a port, and it proxies `/api/`.
- **api:** Java 21, Spring Boot 4.1.3, with Drools 10.2.0 embedded. It's layered as domain, rules, application, infrastructure and api modules. Java fact builders do the time maths; rule templates compile with the editable decision-table rows into a KieBase.
- **db:** PostgreSQL 17 with Flyway V1–V3. Constraints enforce no overlapping shifts, maker/checker and override reasons; triggers enforce append-only audit and locked pay periods.

<!-- TODO: one small diagram (browser → web → api → db; rule tables → build → KieBase hot swap). Reuse the mermaid in docs/08-deployment.md §1 if it fits. -->

Change flow, as specified (TODO-VERIFY once step 6 is built): preview (`POST /rule-checks`) → save → `422` with plain-language rule results when blocked → acknowledge a warning, or override a block in an emergency with a reason → audit event (ADR-014).

## 2. Key decisions

| Decision | ADR |
|---|---|
| No AI at runtime: the rules engine decides and a supervisor approves | ADR-002, ADR-005 |
| Drools decision tables edited in-app; publishing is maker/checker with test scenarios and a dry run | ADR-012 |
| Coverage by unit and block, measured hourly | ADR-013 |
| Shift times are configuration (Shift types table) published through the rules workflow | ADR-015 |
| Overtime = hours over the pay-period threshold (80 h per 2 weeks by default) | ADR-016 |
| UI build decisions: hourly coverage cells, no lock with missing actuals, counts-only rule review, explicit proposal decisions | ADR-017 |
| Audit role grants deferred to a pilot; triggers are the prototype's proof | ADR-018 |
| Overtime authorization (S-04) enforced by the workflow, not a rule table | ADR-019 |

<!-- TODO: add any ADR recorded after 2026-11-20 (e.g. a Spring Boot fallback) and keep only the 6–8 that matter most. -->

## 3. AI-assisted development

**Tools:** Claude (Opus 5.5) for design and specs (2026-11-19). From 2026-11-20, an OpenRig team of AI agents did the build: a lead and an advisor (Claude Code), an implementer (opencode, DeepSeek), QA (opencode, GLM 5.3), independent reviewers (review-r1 <!-- TODO: model -->, review-r2, GLM 5.3) and a designer (Claude Code). The project lead set direction and decided. Steps, checks, corrections and rejections are logged in `docs/ai-dev-log.md` <!-- TODO: final row count -->.

**Verified by:** tests run in Docker, independent review rounds, and a check of each doc against the code. <!-- TODO: number of review/QA rounds, from the log -->

**Selected suggestions corrected or rejected** (from `docs/ai-dev-log.md`):

| # | What happened |
|---|---|
| 5 | **Rejected:** AI recommended a custom rule catalogue. The lead chose Drools so non-technical staff can edit rules as decision tables. |
| 13 | **Corrected by the lead:** AI had modelled 16 h shifts as overtime-only doubles and overtime per shift. Both are wrong: 16 h shifts are regular, and overtime is per pay period. |
| 18 | **Found by building:** Spring Boot 4 skipped Flyway without any error, and the app reported "ready" with no schema. Readiness now also requires a published rule set. |
| 19 (web) | **Rejected an instruction:** proxying to `api:8080` contradicted the deployment spec (8081). It was checked with the api builder first. |
| 22 | **AI review claim disproved:** QA said a CHECK constraint rejected NULL. PostgreSQL CHECKs pass on NULL. |

<!-- TODO: keep 3–4 rows; prefer ones with evidence. Note: the log currently has two rows numbered 19 (rules engine and web scaffold). Renumber before citing. -->

## 4. Test cases

All tests run in Docker. Rule boundary tests check every rule just under, exactly at and just over its limit (`docs/10-testing.md` §3).

| ID | Case | Expected | Result |
|---|---|---|---|
| T2 | Block: 12 h shift Fri 12:00–24:00, then a Day 8 h shift Sat 07:00 (PC-01) | **BLOCK** U-01 (7 h rest) and U-05 (17 h in 24 h); nothing saved | TODO |
| T3 | Boundary: Night 8 h ends 07:00, Evening starts 15:00, exactly 8 h (PC-02) | U-01 PASS (8 h is inclusive); U-02 WARN; saves after acknowledgement | TODO |
| T7 | Rule change without code: U-10 from 4 to 3 nights; build and dry run (PC-06) | Dry run lists the existing 4-night runs; after approval and publish, the check warns | TODO |
| T8 | Payroll export, locked period 26 Oct – 8 Nov (PC-05) | CSV equals the golden file; overtime only beyond 80 h | TODO |
| T9 | Human judgment: 17 h in a lockdown (PC-03) | BLOCK without a reason; with a reason (≥ 10 characters) it saves, and the override is audited and reported | TODO |

<!-- TODO: totals at submission (unit / repository / API / E2E / axe), test command, and the commit they ran on. -->

## 5. Governance and ministry suitability

- **Synthetic data only.** No real names, staffing or post layouts. The 100 officers will come from fixed fictional name lists with a fixed seed. <!-- TODO-VERIFY: generator (step 5) and its self-check -->
- **No secrets in the repo.** Only `.env.example` is shipped, and the API refuses to start without `POSTGRES_PASSWORD` and `SC_JWT_SECRET` (tested, ai-dev-log #17).
- **Safeguards that can't be skipped:**
  - Already in the database and tested (ai-dev-log #18): a maker/checker CHECK, a minimum length for override reasons, append-only audit triggers, and a locked-pay-period trigger.
  - <!-- TODO-VERIFY at the API (step 6+) --> Blocks need an emergency override with a written reason, maker/checker is also enforced by the API, and there's no auto-approval.
- **Privacy** <!-- TODO-VERIFY (steps 6, 12) -->: access limited by role and unit; out-of-scope records return `404`; the wall display shows counts only.
- **Rule values:** labelled by source (Employment Act, agreement, or MOCK). MOCK values and period-based overtime (ADR-016) are assumptions to confirm with practitioners.
- **Honest limits of the prototype:**
  - **Boundary tests were not reviewed by a human.** Guardrail 4 required it; the project lead waived it on 2026-11-20. AI verifiers review them instead: dev-qa (GLM 5.3, with mutation spot-checks) and review-r2 (GLM 5.3, independent of the DeepSeek author). <!-- TODO: state their verdicts only once the lead confirms them -->
  - **Audit:** append-only is enforced by triggers, not database role grants. The single database owner could disable them (ADR-018).
  - **Web container:** nginx's master process runs as root in the stock image; the api container runs non-root (`docs/08-deployment.md` §2).
  - **Sign-in:** mock. The token issuer is fake; token validation is real.

## 6. Next steps (pilot)

1. Restore **human review of the rule boundary tests** by a labour-relations or scheduling practitioner.
2. Validate MOCK rule values, shift times, the overtime threshold and the offer order with the centre (`HANDOFF.md` §8).
3. Government SSO over OIDC, with roles from directory groups.
4. Separate database migration and application roles, with `INSERT, SELECT` only on the audit log (ADR-018).
5. `nginx-unprivileged` and non-root, read-only containers. TLS, a secrets manager, managed PostgreSQL, and a CI pipeline with image scanning (`docs/08-deployment.md` §9).
6. Future features: shift trades and notifications (ADR-010).
