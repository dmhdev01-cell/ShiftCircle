# ShiftCircle build record

<!-- DRAFT (2026-11-20 12:10Z, feature freeze). TODO marks what changes at the final merge. Target: 2 pages; per-round detail lives in docs/review-rounds.md. Delete this comment before submitting. -->

**What it is:** a working prototype that schedules 8, 12 and 16-hour shifts at a fictional 24/7 provincial correctional centre. Every change is checked by a Drools rules engine, whose rules non-technical staff edit as decision tables, and approved by a supervisor. Time feeds a simulated payroll export. All data is synthetic. It isn't an official Government of Saskatchewan service. Setup: `README.md` § Setup.

## 1. Architecture

```mermaid
flowchart LR
    B[Browser: desktop · tablet · TV] -->|:8080| W[web: nginx + React 19 / MUI 9]
    W -->|/api/ proxy| A[api: Java 21 · Spring Boot 4.1.3 · Drools 10.2.0]
    A -->|JDBC| D[(db: PostgreSQL 17 · Flyway V1–V4)]
    R[Rule tables edited in-app] -->|validate → compile → scenarios → dry run → approve| A
```

Only the web publishes a port. Rule rows compile into a rule base that is swapped in when a version is published. Database constraints and triggers enforce no overlaps, maker/checker, override reasons, the append-only audit and locked periods. A change goes: preview → save → `422` with plain reasons → acknowledge a warning, or override an emergency-policy Block with a reason → audit event (ADR-014).

## 2. Key decisions

| Decision | ADR |
|---|---|
| No AI at runtime: the rules engine decides, a supervisor approves | ADR-002, 005 |
| Drools decision tables edited in-app; maker/checker publish with test scenarios and a dry run | ADR-012 |
| Coverage by unit and block, hourly; overtime = hours over the pay-period threshold | ADR-013, 016, 017 |
| **Deviations, for the person to confirm:** only emergency-policy Blocks can be overridden (docs said U-14 could be; the code says no); pay-period lock and export are facility-wide for any supervisor (a pilot gives them to payroll); audit is protected by triggers, not role grants | ADR-023, 022, 018 |

## 3. AI-assisted development

**Who did what.** Claude Opus 5.5 did the design and specs (2026-11-19). From 2026-11-20 an OpenRig team of AI agents built and verified it; the project lead set direction.

| Seat | Model | Role |
|---|---|---|
| orch-lead / orch-advisor / dev-design | Claude Sonnet 5.5 / Opus 5.5 / Opus 5.5 | Routing, advice; UI spec, reviews, e2e, wall display, docs |
| dev-build, dev-build2 | DeepSeek V4.1 Flash (dev-build2 MiniMax M3.1 Flash until 05:06Z) | Api, rules, generator; web |
| dev-qa, review-r2 / review-r1 | GLM 5.3 / GLM 5.3 Flash | QA on clean checkouts; independent review and security probes |

**Independence, honestly:** builders and verifiers are different model families, except from about **10:07Z to 11:30Z**. The OpenCode credit ran out, and all five OpenCode seats ran on MiniMax (M3.1 Flash building, M3 verifying). The rounds in that window (R32–R34) have weaker independence. The original mapping was back from about 11:40Z.

**How it was verified:** 34 review and QA rounds, three e2e runs and two visual reviews, each recorded with what was checked, found and fixed (`docs/review-rounds.md`; narrative in `docs/ai-dev-log.md`). Fixes were proved by reverting them and watching their test fail.

**What verification caught** that had passed the author's own tests:

| Defect | Caught by | Ref. |
|---|---|---|
| **Remote code execution through a rule edit:** rule values reached the generated Drools source unescaped, so a rules admin could run Java on the server with no approval. Fixed in layers (whitelist grammar, validation before compile, generic errors); each layer stops it alone. | review-r2 executed a payload | R24, R28 |
| **Concurrent saves passed a Block rule** (both got 201); fixed with a per-officer lock | review-r2 | R13, R16 |
| **Source missing from git, twice:** `.gitignore` lines for the web hid Java packages; a guard script now fails on any ignored source | review-r2, builder | R5, log #25 |
| **Stale wall display looked live and spilled into the footer;** two automated checks covered only the live state | visual review | Visual, R27 |
| **Payroll lock used the real clock**, so the demo's lock step failed on a fresh stack | dev-qa | R25, R30 |
| **Test-order bug:** the README's test service failed when built fresh; each test class now gets its own database | dev-qa | R30, R31 |
| **Raw HTTP 500** for an overridden overlapping shift: the 409 handler had only been tested directly, never over HTTP | dev-qa | R32, log #68 |
| **Blank page for the auditor:** the api sends a `null` the fixtures never had; now an error boundary plus real-api contract samples | real-api e2e, then dev-qa | R32 |
| **Flaky web suite** under host load (2 of 6 runs red); fix author-reported, re-check pending | dev-qa | R34 |

**Suggestions corrected or rejected:** the lead rejected a custom rule catalogue (Drools lets staff edit rules) and 16 h shifts as overtime-only (log #5, #13). The builder rejected a catch-all error handler that would turn `403`s into `500`s, then built it with that trap closed (log #69). Verifiers retracted two of their own claims (R16, R30).

## 4. Test cases and verified status

**Counts.** The test sources at `211e8f9` hold 91 rules + 27 infrastructure + 201 api = **319 tests** (static count, `@Test` on its own line). The last full clean-worktree run is **301 = 91 + 27 + 183** at `5e7765f` (this author, default order and random seed 20261120); dev-qa's independent run at `211e8f9` is pending and will be recorded here. Earlier, as history: 296 = 91 + 22 + 183 at `dcee43b`, 295 at `a10688e`, 284 from a clean clone at `489b3e1` (R33), 276 in three class orders at `22375d4` (R31). Web: vitest 195 in 21 files, 0 failures; lint 0 errors (2 pre-existing warnings); build clean. E2E (Playwright, axe on every screen) in R34: real api desktop 20 passed, tablet 19 + 1 skipped; fixtures 43 passed / 3 skipped; the final real-api re-run at the merged tip is dev-build2's.

| ID | Case | Expected | Result |
|---|---|---|---|
| T2 | 12 h shift Fri 12:00–24:00, then Day 8 h Sat 07:00 (PC-01) | BLOCK U-01, U-05; nothing saved | 422, nothing saved; U-14 also fires, so **no override is offered** (R12, R25, R30) |
| T3 | Exactly 8 h of rest | U-01 PASS (inclusive), U-02 WARN | 8 h 00 m PASS, 7 h 59 m BLOCK (R4, R7) |
| T7 | Rule change without code: U-10 from 4 to 3 nights | Dry run lists the runs; warns after publish | Over HTTP, approved and published by another user (R23, R28) |
| T8 | Payroll export, locked 26 Oct – 8 Nov | CSV equals the golden file | Golden recomputed independently; live export byte-identical (R17, R25, R33) |
| T9 | 17 h in a lockdown (PC-03) | BLOCK; ≥ 10-character reason saves and audits | 9 characters and 10 spaces refused; override and audit written (R12, R13) |

## 5. Governance and ministry suitability

- **Synthetic data only:** 100 fictional officers (seed 20261001, `is_synthetic` on every person). **No secrets:** `.env.example` ships empty; compose and the api refuse weak secrets; the history has no `.env`, keys or certificates (R2, R9, R30).
- **Safeguards:** an emergency-policy Block needs a reason of ≥ 10 characters and is audited; other Blocks can't be overridden; warnings must be acknowledged. Maker/checker in the api and the database. Only supervisors authorize overtime. Rule-editor input is treated as untrusted code.
- **Privacy:** role and unit scope on every endpoint, out of scope `404`; the wall display shows counts only, even when the api plants a name (R26).
- **Honest limits:** **no human reviewed the rule boundary tests.** Guardrail 4 required it; the project lead waived it on 2026-11-20, and GLM verifiers reviewed them instead (R4–R7). Sign-in is a mock issuer, though validation is real. The nginx master runs as root. MOCK rule values need confirming. Designed but not built: Excel round trip, shift proposals, OpenAPI and more (`docs/10-testing.md` §8).

## 6. Next steps (pilot)

1. Human review of the rule boundary tests by a scheduling or labour-relations practitioner.
2. Validate the MOCK rule values, shift times and offer order with the centre; confirm ADR-020, 022 and 023.
3. Government SSO (OIDC) with roles from directory groups; a payroll-clerk role for lock and export.
4. Separate migration and application database roles, with insert-only audit (ADR-018); non-root containers, TLS, a secrets manager, CI with image scanning (`docs/08-deployment.md` §9).
