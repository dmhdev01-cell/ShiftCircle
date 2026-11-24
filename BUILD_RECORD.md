# ShiftCircle build record

**What it is:** a working prototype that schedules 8- and 12-hour shifts at a fictional 24/7 correctional centre; a 16 h day is a 12 h shift plus an extension. Supervisors plan against editable Drools decision tables; a quarter planner builds 14 weeks through the same engine, with hand edits in the draft; worked time feeds a simulated payroll export. All data is synthetic, not an official Government of Saskatchewan service.

## 1. Architecture

```
Browser -> nginx + React web -> Spring Boot api (Drools rules engine) -> PostgreSQL
           (only port published)   one engine for every write            audit by trigger
```

A change is previewed, saved, refused with plain reasons, then acknowledged or emergency-overridden with a reason and audited (ADR-014). Draft edits and the commit re-check through the same engine; commit writes the quarter in one transaction (ADR-026).

## 2. Key decisions

- **No AI at runtime:** the engine decides and a supervisor approves (ADR-002, 005); Drools tables are edited in the app with maker/checker, scenarios and a dry run (ADR-012).
- **Coverage and overtime:** hourly by unit and block; overtime is hours over the pay-period threshold (ADR-013, 016, 017).
- **Overrides and audit:** emergency-only overrides (ADR-023); facility-wide lock (ADR-022); trigger-based audit, prototype only (ADR-018).
- **Planner (ADR-026/027):** deterministic, every proposal engine-checked, guarded commit; a draft edit never offers an override.
- **Datasets:** 100 officers by default, 120 and 150 selectable; rule sets v1, v2 and v3 are seeded published (docs/04 §6); every later version uses maker/checker (ADR-027).

## 3. AI-assisted development

**Who.** Claude Opus 5.5 did the design and specs. From 2026-11-20 an OpenRig team built and verified it: DeepSeek V4.1 Flash builders, GLM 5.3 verifiers, Claude Sonnet 5.5 for security review and lead. Builders and verifiers were different families except about 10:07Z to 11:30Z that day (MiniMax, R32 to R34). Releases 3 to 7 were built by the same DeepSeek builders and gated by GLM QA (R65 to R72); 8 and 10 were documentation only.

**Caught by verification** after the authors' tests passed:

| Defect | Caught by |
|---|---|
| **Remote code execution through a rule edit** (unescaped values in generated Drools source); fixed in three layers | reviewer payload (R24, R28) |
| **Concurrent saves passed a Block rule**; now a per-officer lock. | reviews (R13, R16, R40, R42) |
| **Planner:** placeholder names, a UTC-midnight commit date, D12/N12 scored as 8 h | design review (R54 to R59) |

**Suggestions rejected.** The lead rejected a custom rule catalogue and 16 h shifts as overtime-only (log #5, #13), and a builder's catch-all handler that hid `403`s as `500`s (log #69).

## 4. Test cases and verified status

| ID | Case | Expected | Result |
|---|---|---|---|
| T2 | 12 h shift, then an 8 h shift after 7 h rest | BLOCK (U-01 and U-05; the planted officer also blocks on U-14), nothing saved | 422, no override (U-14 is not overridable) |
| T3 | Boundary: night ends 07:00, next shift 15:00 (exactly 8 h) | U-01 passes, U-02 warns, saves once acknowledged | pinned by rule/api tests |
| T7 | Rules admin lowers U-10 from 4 to 3 nights | dry run lists existing runs; once approved the check warns; no code change | pinned by rule/api tests |
| T8 | Payroll export, locked period | equals the golden file | byte-identical |
| T9 | 17 h cover in a lockdown | Block without override; with a written reason it saves and is audited | pinned by rule/api tests |

**Current gate (re-checked on `main`, 2026-11-23).** API **464 = 127 rules + 28 infrastructure + 309 api** tests, two class orders; web **341**; Playwright on a fresh stack per viewport: desktop **105 passed**, tablet **104 passed and 1 skipped**; fixtures 43. Checksums, golden and plan fingerprints are exact. No human has walked the demo.

## 5. Governance and ministry suitability

- **Synthetic, no secrets:** weak secrets refused; no keys in history.
- **Safeguards:** overrides need a written reason and are audited; other Blocks cannot be overridden; maker/checker; rule input untrusted.
- **Privacy:** role and unit scope on every endpoint (`404` outside); the wall display shows counts only.
- **Honest limits:**
  - **Guardrail 4 exception: no human reviewed the rule boundary tests.** The lead waived it on 2026-11-20; AI verifiers reviewed them (R4 to R7).
  - **Locked periods:** time entries are guarded by api and trigger, shifts only by the api (R38). A legal but wrong rule value is caught only by maker/checker and the dry run (R40).
  - **Tokens:** 8 h, no revocation; memory-only on prod-like, sessionStorage on the demo (ADR-025); mock issuer. **Not built:** Excel round-trip, offer withdrawal, payroll-clerk role, OpenAPI (docs/10).
  - **Rules:** U-03, U-11 dormant (retired L16 key); L-01 still lists 16 h; P-01 makes 4-on/4-off crews built-in overtime (no U-13).
  - **Planner:** qualifications warn-only; no part-time floor; leave not on the board; Unit C has 4 first-aiders (`docs/roadmap.md`); no planned leave in the planner's 2027 window by default (the 100 seed's absences fall in 2026); a late actual is not re-checked.

## 6. Next steps (pilot)

1. **Restore human review:** a practitioner reviews the rule boundary tests and validates the MOCK values.
2. Government SSO with short-lived tokens; a payroll-clerk role; separate database roles with insert-only audit and a locked-period shift guard (ADR-018); non-root containers, TLS, secrets manager, CI scanning (`docs/08` §9).

**Since v1.0-submission:** limits stated honestly, demo script re-walked, docs matched to the code (`docs/roadmap.md`).
<!-- TODO(PR-E, end of sprint): when PRs A-D land, update this line and the "Current gate" counts in section 4 (API, web, Playwright) from the final CI and e2e runs, then re-check it still fits 2 pages at Letter 11pt. -->
