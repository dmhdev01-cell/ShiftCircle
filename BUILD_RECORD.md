# ShiftCircle build record

<!-- DRAFT (2026-11-20 08:05Z). Only facts true now; TODO / TODO-VERIFY mark what isn't built or re-verified yet. Target: 2 pages; details live in docs/review-rounds.md and the linked docs. Delete this comment before submitting. -->

**What it is:** a working prototype that schedules 8, 12 and 16-hour shifts at a fictional 24/7 provincial correctional centre. A Drools rules engine, which non-technical staff edit as decision tables, checks every change, and a supervisor approves every change. Time feeds a simulated payroll export. All data is synthetic. It isn't an official Government of Saskatchewan service. Setup: `README.md` § Setup.

## 1. Architecture

Three containers under `docker compose` (ADR-006, ADR-011, ADR-012):

- **web:** nginx serving React 19, TypeScript and MUI 9. It's the only published port and it proxies `/api/`.
- **api:** Java 21, Spring Boot 4.1.3, Drools 10.2.0 embedded. Java fact builders do the time maths; rule templates plus editable rows compile into a rule base that is swapped in when a version is published.
- **db:** PostgreSQL 17, Flyway V1–V4. Constraints: no overlapping shifts, maker/checker, override reasons. Triggers: append-only audit, locked pay periods.

<!-- TODO: one small diagram (browser → web → api → db; rule tables → build → hot swap); reuse docs/08-deployment.md §1. -->

Change flow: preview (`POST /rule-checks`) → save → `422` with plain-language rule results → acknowledge a warning, or override an emergency-policy Block with a reason → audit event (ADR-014).

## 2. Key decisions

| Decision | ADR |
|---|---|
| No AI at runtime: the rules engine decides and a supervisor approves | ADR-002, ADR-005 |
| Drools decision tables edited in-app; maker/checker publishing with test scenarios and a dry run | ADR-012 |
| Coverage by unit and block, measured hourly; overtime = hours over the pay-period threshold | ADR-013, ADR-016, ADR-017 |
| Only emergency-policy Blocks can be overridden; the 60 h week, consecutive days and 12 h runs can't (to confirm) | ADR-023 |
| Pay-period lock and export are facility-wide, audited; a pilot restricts them to payroll (to confirm) | ADR-022 |
| Audit grants deferred to a pilot (triggers are the proof); overtime authorization enforced by the workflow | ADR-018, ADR-019 |

## 3. AI-assisted development

**Who did what.** Claude (Opus 5.5) did the design and specs on 2026-11-19. From 2026-11-20 an OpenRig team of AI agents did the build; the project lead set direction and made the decisions.

| Seat | Model | Role |
|---|---|---|
| orch-lead / orch-advisor | Claude Sonnet 5.5 / Claude Opus 5.5 | Routing and decisions while the person was away / advice |
| dev-build | DeepSeek V4.1 Flash | Api, rules, generator |
| dev-build2 | MiniMax M3.1 Flash, then DeepSeek V4.1 Flash | Web (relaunched at 05:06Z after the MiniMax plan limit) |
| dev-qa | GLM 5.3 | QA: clean-checkout runs, mutation checks, private stacks |
| review-r1 / review-r2 | GLM 5.3 Flash / GLM 5.3 | Independent review, security probes |
| dev-design | Claude Opus 5.5 | UI notes and reviews, e2e tests, wall display, docs |

The verifiers are a different model family from the builders, so verification doesn't depend on the authors.

**How it was verified.** 30 review and QA rounds (the last a full clean-clone check of `main`), three e2e runs and one visual review, each recorded with what was checked, found and fixed (`docs/review-rounds.md`; narrative in `docs/ai-dev-log.md`). Fixes were proved by reverting them and watching their test fail.

**What the verification caught.** The best evidence that independent checking mattered is what passed every test and was still wrong:

| What happened | Caught by | Ref. |
|---|---|---|
| **Remote code execution through a rule edit.** Rule values reached the generated Drools source unescaped: a rules admin, with no approval, could edit a pattern, press Build and run arbitrary Java on the server. The builder's tests and a QA PASS missed it; an independent reviewer **executed a payload** to prove it. Fixed in layers (whitelist grammar, validation before any compile, generic compile errors); re-verified with a 19-value character battery, and each layer stops the payload on its own. | review-r2 | R23, R24, R28 |
| **Concurrent saves got past a Block rule.** Each save was checked on its own, so every test passed; two saves for one officer sent at once both got 201. Fixed with a per-officer lock; the fix fails its test when reverted. | review-r2 | R13, R16 |
| **Source code missing from git, twice.** A `.gitignore` line meant for the web (`build/`, later `coverage/`) ignored a Java package, so results, including a QA PASS, ran on files a clean clone didn't have. A guard script now fails on any ignored file under a source folder. | review-r2, then the builder | R5, log #25 |
| **A screen that passed two automated checks was visibly broken.** In the wall display's stale state every card spilled into the footer and old numbers still looked live. A geometry probe and the author's fit test had checked only the live state; a visual review of screenshots found it. | dev-design (author) | Visual, R27 |
| **The payroll lock used the real clock, not the demo's**, so the demo's lock step was refused on a fresh stack and no test caught it. Fixed in `210e59b`; the lock works at the demo clock from a clean clone (R30). | dev-qa | R25, R30 |
| **Claims corrected:** a reviewer's own probe was vacuous (off-by-one setup; it said so); a QA claim that a CHECK rejects NULL was disproved; two spec numbers couldn't both hold (84 h on a 12 h rotation is overtime before any absence, ADR-020); docs said U-14 could be overridden, the code said no (ADR-023); a verifier retracted its own finding (empty fields in the auditor's override view) after checking the raw data: its query had used the wrong field names. | r2, design seat, builder, dev-qa | R16, log #23, #27, R25, R30 |
| **Rejected or corrected by the lead:** a custom rule catalogue (Drools chosen so staff can edit rules); 16 h shifts as overtime-only and overtime per shift. | project lead | log #5, #13 |

## 4. Test cases and verified status

**Verified** by a GLM verifier from a clean checkout or a private stack (details per round in `docs/review-rounds.md`):

| Steps | Result |
|---|---|
| 1–5 | Schema, rules boundary matrix (under/exactly/over), generator checksum; 84/84 (R1–R10) |
| 6 | 142/142 at `f73d6c5`, after two high findings (R12, R13, R15, R16) |
| 7 (web) | Real api, private stack: Playwright 5 passed / 2 skipped per viewport (R25) |
| 8, 9 | 200/200 on merged main with revert-the-fix checks (R18–R21); T8 golden CSV recomputed independently (R17) |
| 10 | 206/206; reports reconciled against independent SQL and the real payroll CSV (R22) |
| 11 | 235/235 at `35c225d`, after a critical finding (R23, R24, R28) |
| 12a (wall display) | Counts only, stale state, role reach (R26, R27) |
| Move and cancel | 270 tests at `62dd4fc`; ~30 probes, no Block bypass by moving (R29) |
| All of `main` | From a true clean clone at `17308b7`: api 246/246, web 118/118, demo script walked end to end (R30) |

Latest independently verified api totals: **270 at `62dd4fc`** (R29) and **246/246 from a clean clone at `17308b7`** (R30). E2E (Playwright, axe on every screen) at `17308b7` (R30): real api desktop 13 passed, tablet 12 passed + 1 skipped; fixtures web 35 passed, 3 skipped, 0 failed. The class-order failure R30 found in the `api-test` service is fixed in `22375d4` (each API test class gets its own database): the author's clean-worktree runs in three class orders (reverse, and random with two seeds) each gave 91 rules + 20 infrastructure + 165 api = **276 tests, 0 failures**. Not yet independently re-verified. <!-- TODO: final totals on the submission commit (api / web / e2e / axe), with the command -->

| ID | Case | Expected | Result |
|---|---|---|---|
| T2 | 12 h shift Fri 12:00–24:00, then Day 8 h Sat 07:00 (PC-01) | **BLOCK** U-01 (7 h rest), U-05 (17 h in 24 h); nothing saved | 422, nothing saved (R12). Full stack: also U-14 (60 h week), so **no override is offered** (R25) |
| T3 | Exactly 8 h of rest (PC-02) | U-01 PASS (inclusive); U-02 WARN | 8 h 00 m PASS, 7 h 59 m BLOCK (R4, R7). TODO-VERIFY on PC-02 data |
| T7 | Rule change without code: U-10 from 4 to 3 nights (PC-06) | Dry run lists the four-night runs; warns after publish | Over HTTP: the dry run lists the run (counts only); after approval and publish by another user the check warns, no code change (R23, R28) |
| T8 | Payroll export, locked 26 Oct – 8 Nov (PC-05) | CSV equals the golden file; overtime only beyond 80 h | Golden file recomputed independently, byte-identical (R17); live export byte-identical (R25) |
| T9 | 17 h in a lockdown (PC-03) | BLOCK without a reason; with ≥ 10 characters it saves and is audited | 9 characters and 10 spaces refused; override and audit rows written (R12, R13) |

## 5. Governance and ministry suitability

- **Synthetic data only:** 100 fictional officers, seed 20261001, `is_synthetic` on every person; one planted override only, so the audit log holds no invented events (R10, R25).
- **No secrets in the repo:** `.env.example` ships empty; compose and the api refuse to start without strong secrets; no `.env`, key or certificate anywhere in the history (R2, R9, R30).
- **Safeguards:** emergency-policy Blocks need a reason of ≥ 10 characters and are audited (PC-03); other Blocks can't be overridden (PC-01, ADR-023). Warnings must be acknowledged. Maker/checker in the api and a DB CHECK; append-only audit; locked periods protected by a trigger; only a supervisor authorizes overtime; saves are serialized per officer (R12–R16, R21, R28).
- **Rule editor security:** staff input is treated as untrusted code input: whitelisted, validated before compile, generic errors (R28).
- **Privacy:** role and unit scope on every endpoint, out-of-scope is `404` (R12, R16). The wall display shows counts only, even when the api sends a planted name (R26). Supervisors don't see rule-change audit events; the auditor sees all (`docs/09-access-control.md` §2).
- **Rule values** are labelled by source (Employment Act, agreement, MOCK); MOCK values are assumptions to confirm.
- **Honest limits:**
  - **No human reviewed the boundary tests.** Guardrail 4 required it; the project lead waived it on 2026-11-20. AI verifiers (GLM, independent of the DeepSeek author) reviewed them instead (R4–R7).
  - Audit is protected by triggers, not role grants (ADR-018); the stock nginx master runs as root (`docs/08-deployment.md` §2); sign-in is a mock issuer, validation is real.
  - Accessibility: no serious or critical axe findings on the screens the e2e suite visits; reaching a roster chip by keyboard takes many Tab presses (no arrow-key navigation; ai-dev-log #51).

## 6. Next steps (pilot)

1. Restore **human review of the rule boundary tests** by a labour-relations or scheduling practitioner.
2. Validate the MOCK rule values, shift times, overtime threshold and offer order with the centre (`HANDOFF.md` §8); confirm ADR-020, ADR-022 and ADR-023.
3. Government SSO over OIDC, with roles from directory groups; a payroll-clerk role for lock and export (ADR-022).
4. Separate migration and application database roles, with `INSERT, SELECT` only on the audit log (ADR-018).
5. `nginx-unprivileged` and read-only, non-root containers; TLS, a secrets manager, managed PostgreSQL, and CI with image scanning (`docs/08-deployment.md` §9).
6. Future features: shift trades and notifications (ADR-010).
