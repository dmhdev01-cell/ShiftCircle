# ShiftCircle build record

<!-- DRAFT (2026-11-20 05:50Z). Only facts true now; TODO / TODO-VERIFY mark what isn't built or re-verified yet. Target: 2 pages; details live in the linked docs. Delete this comment before submitting. -->

**What it is:** a working prototype that schedules 8, 12 and 16-hour shifts at a fictional 24/7 provincial correctional centre. A Drools rules engine, which non-technical staff edit as decision tables, checks every change, and a supervisor approves every change. Time feeds a simulated payroll export. All data is synthetic. It isn't an official Government of Saskatchewan service. Setup: `README.md` § Setup.

## 1. Architecture

Three containers under `docker compose` (ADR-006, ADR-011, ADR-012):

- **web:** nginx serving React 19, TypeScript and MUI 9 (pnpm, Vite). It's the only published port and it proxies `/api/`.
- **api:** Java 21, Spring Boot 4.1.3, Drools 10.2.0 embedded. Modules: domain, rules, application, infrastructure, api. Java fact builders do the time maths; rule templates plus editable rows compile into a KieBase.
- **db:** PostgreSQL 17 with Flyway V1–V3. Constraints: no overlapping shifts, maker/checker, override reasons. Triggers: append-only audit, locked pay periods.

<!-- TODO: one small diagram (browser → web → api → db; rule tables → build → KieBase hot swap); reuse docs/08-deployment.md §1. -->

Change flow (built and verified at the api in step 6): preview (`POST /rule-checks`) → save → `422` with plain-language rule results → acknowledge a warning, or override a Block in an emergency with a reason → audit event (ADR-014).

## 2. Key decisions

| Decision | ADR |
|---|---|
| No AI at runtime: the rules engine decides and a supervisor approves | ADR-002, ADR-005 |
| Drools decision tables edited in-app; maker/checker publishing with test scenarios and a dry run | ADR-012 |
| Coverage by unit and block, measured hourly | ADR-013 |
| Shift times are configuration; overtime = hours over the pay-period threshold | ADR-015, ADR-016 |
| Audit role grants deferred to a pilot (triggers are the proof); overtime authorization enforced by the workflow | ADR-018, ADR-019 |
| Demo data sizing corrected by arithmetic (see §3) | ADR-020 |

## 3. AI-assisted development

**Who did what.** Claude (Opus 5.5) did the design and specs on 2026-11-19. From 2026-11-20 an OpenRig team of AI agents did the build; the project lead set direction and made the decisions.

| Seat | Model | Role |
|---|---|---|
| orch-lead | Claude Sonnet 5.5 | Routing, decisions while the person was away |
| orch-advisor | Claude Opus 5.5 | Advice to the lead |
| dev-build | DeepSeek V4.1 Flash | Api, rules, generator (relaunched fresh at 05:10Z at its context limit) |
| dev-build2 | MiniMax M3.1 Flash, then DeepSeek V4.1 Flash | Web (relaunched fresh at 05:06Z after the MiniMax plan limit, error 2067) |
| dev-qa | GLM 5.3 | QA: clean-checkout runs, mutation checks |
| review-r1 / review-r2 | GLM 5.3 Flash / GLM 5.3 | Independent review, security probes |
| dev-design | Claude Opus 5.5 | UI notes, UI reviews, e2e tests, docs |

The verifiers are a different model family from the builders. After the 05:06Z relaunch both builders are DeepSeek, so cross-checks between builders aren't model-independent; verification still is.

**How it was verified.** 16 review and QA rounds plus two e2e runs, each recorded with what was checked, found and fixed (`docs/review-rounds.md`; narrative in `docs/ai-dev-log.md`). Fixes were proved by reverting them and watching their test fail.

**AI suggestions and claims that were corrected or rejected:**

| What happened | Caught by | Ref. |
|---|---|---|
| **A `.gitignore` line swallowed a source package.** `build/` (meant for the web) ignored `…/rules/build/`. Every "68/68" so far had run on untracked files, including a QA PASS; a clean clone couldn't compile. | review-r2, clean worktree | log #25, R5 |
| **A review claim disproved.** QA said the maker/checker CHECK rejects a NULL creator. A PostgreSQL CHECK that evaluates to NULL passes; the doc was reworded to match the code. | design seat, by reading the spec and the code | log #23 |
| **Two spec numbers couldn't both hold.** A 12 h crew on 4 on, 4 off works 84 h per 2 weeks, so it's in overtime before any absence. 8% absences can't fit a 3–6% overtime band; changed to 2% + 2% and 3–8%. | builder, by arithmetic | log #27, ADR-020 |
| **Concurrent saves got past a Block rule until a reviewer sent two requests at once.** Every test passed, because each save was checked on its own. Two saves for one officer 30 minutes apart both got 201; sent one after the other, the second got 422. Fixed in `f73d6c5` with a per-officer lock, then proven: four concurrent saves keep the rest rule intact, and the fix fails its test when reverted. | review-r2, 25 HTTP probes | R13 S2, R16 |
| **A reviewer corrected its own probe.** review-r2's live S4 check had an off-by-one in its setup (ten 16 h shifts span 30 days, so only nine were in the 28-day window), so it would have "passed" against correct code too. The finding from reading the code still stood; the corrected setup gives a genuine fail-before, pass-after pair. | review-r2, self-reported | R16 |
| **Rejected:** a custom rule catalogue, in favour of Drools so non-technical staff can edit rules | project lead | log #5 |
| **Corrected by the lead:** 16 h shifts treated as overtime-only doubles, and overtime treated per shift | project lead | log #13 |

## 4. Test cases and verified status

**Verified so far** (by a GLM verifier from a clean checkout unless noted):

| Steps | Result |
|---|---|
| 1–3 | 6/6, then 28/28 + web 9/9 (R1–R3) |
| 4 | 83/83, boundary matrix under/exactly/over, revert-the-fix checks (R6, R7) |
| 5 | 84/84; checksum reproduced; overtime 6.54%; coverage 98.04% (R10) |
| 6 | **Verified** at `f73d6c5`: 142/142, dev-qa PASS and review-r2 APPROVE with revert-the-fix checks (R15, R16), after two high findings in R12/R13 |
| 7–11 | TODO (step 8 overtime backend in progress; 9 time/payroll and 11 publish pipeline not built; web screens on an unmerged branch) |

Latest verified total on `main`: 142/142 at `f73d6c5` (R15). E2E against the fixtures-mode web `a908c1f`: 26 passed, 2 failed (the fixture CSV header doesn't match docs/07, fixtures only), 4 skipped (wall display not built). The earlier accessibility defect is fixed (E2E-2). <!-- TODO: final totals (unit / repository / api / web / e2e / axe), the command and the commit -->

| ID | Case | Expected | Result |
|---|---|---|---|
| T2 | Block: 12 h shift Fri 12:00–24:00, then Day 8 h Sat 07:00 (PC-01) | **BLOCK** U-01 (7 h rest) and U-05 (17 h in 24 h); nothing saved | Api: 422 and nothing saved (R12). UI: e2e E1 passes (fixtures). TODO-VERIFY on the full stack |
| T3 | Boundary: exactly 8 h of rest (PC-02) | U-01 PASS (inclusive); U-02 WARN | U-01 8 h 00 m PASS, 7 h 59 m BLOCK in the boundary matrix (R4, R7). TODO-VERIFY on PC-02 data |
| T7 | Rule change without code: U-10 from 4 to 3 nights (PC-06) | Dry run lists the four-night runs; warns after publish | TODO (step 11 backend not built) |
| T8 | Payroll export, locked 26 Oct – 8 Nov (PC-05) | CSV equals the golden file; overtime only beyond 80 h | TODO (step 9 backend not built) |
| T9 | Human judgment: 17 h in a lockdown (PC-03) | BLOCK without a reason; with ≥ 10 characters it saves and is audited | Api: 9 characters and 10 spaces refused, override and audit rows written (R12, R13) |

## 5. Governance and ministry suitability

- **Synthetic data only:** 100 officers from fixed fictional name lists, seed 20261001, `is_synthetic` on every person; the generator self-check passes (R10).
- **No secrets in the repo:** `.env.example` ships empty. Compose and the api both refuse to start without `POSTGRES_PASSWORD` (≥ 8) and `SC_JWT_SECRET` (≥ 32) (R2, R9).
- **Safeguards:** Blocks need an EMERGENCY override with a reason of ≥ 10 trimmed characters, and warnings must be acknowledged. Maker/checker is enforced by the api and a DB CHECK. Audit is append-only. Locked periods are protected by a trigger. Overtime is authorized only by a supervisor (S-04). There's no auto-approval. Concurrent saves are serialized per officer, so a race can't slip past a Block (R12, R13, R16).
- **Privacy:** role and unit scope on every endpoint, and out-of-scope returns `404` (R12; the one leak, rule preview without a scope check, was fixed in `f73d6c5` and verified in R15/R16). The wall display shows counts only. <!-- TODO-VERIFY: wall display not built -->
- **Rule values** are labelled by source (Employment Act, agreement, MOCK). MOCK values and period-based overtime (ADR-016) are assumptions to confirm.
- **Honest limits:**
  - **No human reviewed the boundary tests.** Guardrail 4 required it; the project lead waived it on 2026-11-20. AI verifiers reviewed them instead: dev-qa (PASS, mutation checks; R4, R6) and review-r2 (APPROVE after fixes; R5, R7), both GLM, independent of the DeepSeek author.
  - Audit is protected by triggers, not role grants, and the database owner could disable them (ADR-018).
  - The stock nginx master runs as root (`docs/08-deployment.md` §2).
  - Sign-in is a mock issuer; validation is real.
  - Accessibility: one known axe "serious" defect is open. <!-- TODO-VERIFY -->

## 6. Next steps (pilot)

1. Restore **human review of the rule boundary tests** by a labour-relations or scheduling practitioner.
2. Validate the MOCK rule values, shift times, overtime threshold and offer order with the centre (`HANDOFF.md` §8).
3. Government SSO over OIDC, with roles from directory groups.
4. Separate migration and application database roles, with `INSERT, SELECT` only on the audit log (ADR-018).
5. `nginx-unprivileged` and read-only, non-root containers; TLS, a secrets manager, managed PostgreSQL, and CI with image scanning (`docs/08-deployment.md` §9).
6. Future features: shift trades and notifications (ADR-010).
