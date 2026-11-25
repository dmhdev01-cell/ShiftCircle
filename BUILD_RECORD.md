# ShiftCircle build record

**What it is:** a working prototype (submitted as release `v1.3`) that schedules 8- and 12-hour shifts (a 16 h day is 12 h plus an extension) at a fictional 24/7 correctional centre. Supervisors plan against editable Drools tables and work their own posts; officers propose extra shifts; a quarter planner builds 14 weeks with the same engine; worked time feeds a simulated payroll export. All data is synthetic, not an official Government of Saskatchewan service.

## 1. Architecture

```
Browser -> nginx + React web -> Spring Boot api (Drools rules engine) -> PostgreSQL
           (only port published)   one engine for every write            audit by trigger
```

A change, draft edit or proposal approval is previewed, then saved, refused with plain reasons, or acknowledged or overridden with a reason, and audited (ADR-014, 026, 032).

## 2. Key decisions

- **No AI at runtime:** the engine decides and a person approves (ADR-002, 005); rule tables are edited in the app with maker/checker, scenarios and a dry run (ADR-012).
- **Overtime** is hours over the pay-period threshold (ADR-016); emergency-only overrides (ADR-023); trigger-based audit (ADR-018). **Planner (ADR-026, 027):** deterministic, every placement engine-checked, guarded commit.
- **Supervisors (ADR-031):** a post is a unit of a new kind, so coverage, payroll and reports needed no new code; who may work it is a rule table (R-01, R-02); overtime pools by rank; nobody edits their own schedule. **Proposals (ADR-032):** decided per shift in scope, rules re-run at approval, no override.

## 3. AI-assisted development

**Who.** Claude Opus 5.5 designed it. From 20 Nov an OpenRig team built and verified it (DeepSeek V4.1 Flash builders, GLM 5.3 verifiers, Claude Sonnet 5.5 security and lead; different families except R32 to R34 and releases 3 to 7). For v1.2 and v1.3, Claude agents built one gated pull request each.

**Caught by verification** after the authors' tests passed:

| Defect | Caught by |
|---|---|
| **Remote code execution through a rule edit** (unescaped source); fixed in three layers | reviewer payload (R24, R28) |
| **Concurrent saves passed a Block**; now a per-officer lock | reviews (R13, R16, R40, R42) |
| **The dry run ignored post-rule edits**; an approver saw no impact | v1.3 UI test (S2) |

**Rejected:** a custom rule catalogue, 16 h shifts as overtime-only, a catch-all handler that hid `403`s as `500`s.

## 4. Test cases and verified status

| ID | Case | Expected | Result |
|---|---|---|---|
| T2 | 12 h shift, then an 8 h shift after 7 h rest | BLOCK (U-01, U-05, U-14), nothing saved | 422, no override |
| T3 | Night ends 07:00, next shift 15:00 (exactly 8 h) | U-01 passes, U-02 warns, saves once acknowledged | pinned by tests |
| T8 | Payroll export, locked period | equals the golden file | byte-identical |
| T9 | 17 h cover in a lockdown | Block; with a written reason it saves, audited | pinned |

**Gate for `v1.3` (`main` `d3d1d28`, 25 Nov 2026):** API 624 tests, web 695, Playwright desktop 144 passed, tablet 143 passed and 1 skipped, 0 failed; the golden moved once for the supervisors (officers' rows unchanged). The demo walk was scripted, not by a person.

## 5. Governance and ministry suitability

- **Synthetic data;** weak secrets refused; role and unit scope on every endpoint (`404` outside); the wall display shows counts only. **Safeguards:** written, audited overrides; other Blocks can't be overridden; maker/checker; no one approves their own shift.
- **Honest limits:**
  - **Guardrail 4 exception: no human reviewed the rule boundary tests.** Waived by the lead on 2026-11-20; AI verifiers reviewed them (R4 to R7).
  - **Locks and tokens:** locked periods are guarded by the api only (R38); a legal but wrong rule value is caught only by maker/checker (R40); 8 h tokens, no revocation (ADR-025). **Not built:** Excel round-trip, offer withdrawal (docs/10).
  - **Rules:** U-03, U-11 dormant (retired L16 key); L-01 lists 16 h; P-01 makes 4-on/4-off crews built-in overtime, supervisors included.
  - **Planner:** qualifications warn-only; no part-time floor; leave on the draft only; Dataset 100's 8 h supervisors leave post nights short (`docs/roadmap.md`).

## 6. Next steps (pilot)

1. **Restore human review:** a practitioner reviews the rule tests and the MOCK values.
2. Government SSO; a payroll-clerk role; insert-only audit roles (ADR-018); TLS, CI scanning (`docs/08` §9).

<!-- Page check (keep): fit 2 pages. Recipe: Chromium print to PDF, 11 pt, line-height 1.38, content width = page minus margins; measured content height must be <= ~1.95 pages. Cases: Letter 1 in margins (6.5 x 9 in), A4 2 cm margins (17 x 25.7 cm). Measured at PR-I (756 words): Letter 1.95 pages of content, 2 PDF pages; A4 1.71, 2 PDF pages. Re-measured for v1.3 (S8, 25 Nov 2026, 724 words, Source Sans 3 loaded; the PR-I text measured 1.95 on the same harness): Letter 1.92 pages of content, 2 PDF pages. -->
