# ShiftCircle build record

**What it is:** a working prototype that schedules 8- and 12-hour shifts at a fictional 24/7 correctional centre; a 16 h day is a 12 h shift plus an extension. Supervisors plan against editable Drools decision tables; a quarter planner builds 14 weeks through the same engine, with hand edits in the draft; worked time feeds a simulated payroll export. All data is synthetic, not an official Government of Saskatchewan service.

## 1. Architecture

```
Browser -> nginx + React web -> Spring Boot api (Drools rules engine) -> PostgreSQL
           (only port published)   one engine for every write            audit by trigger
```

A change is previewed, then saved, refused with plain reasons, or acknowledged or emergency-overridden with a reason, and audited (ADR-014). Draft edits and the commit use the same engine; commit is one transaction (ADR-026).

## 2. Key decisions

- **No AI at runtime:** the engine decides and a supervisor approves (ADR-002, 005); Drools tables are edited in the app with maker/checker, scenarios and a dry run (ADR-012).
- **Overtime, overrides, audit:** overtime is hours over the pay-period threshold (ADR-013, 016, 017); emergency-only overrides (ADR-023); trigger-based audit, prototype only (ADR-018).
- **Planner (ADR-026/027):** deterministic, every proposal engine-checked, guarded commit; no override in a draft.
- **Datasets:** 100 officers by default, 120 and 150 selectable; rule sets v1 to v3 seeded, later ones by maker/checker (ADR-027).

## 3. AI-assisted development

**Who.** Claude Opus 5.5 did the design and specs. From 2026-11-20 an OpenRig team built and verified it: DeepSeek V4.1 Flash builders, GLM 5.3 verifiers, Claude Sonnet 5.5 for security review and lead. Builders and verifiers were different families except 10:07Z to 11:30Z that day (MiniMax, R32 to R34); releases 3 to 7 had the same builders and GLM QA (R65 to R72).

**Caught by verification** after the authors' tests passed:

| Defect | Caught by |
|---|---|
| **Remote code execution through a rule edit** (unescaped Drools source); fixed in three layers | reviewer payload (R24, R28) |
| **Concurrent saves passed a Block rule**; now a per-officer lock. | reviews (R13, R16, R40, R42) |
| **Planner:** placeholder names, UTC-midnight commit date, D12/N12 scored as 8 h | design review (R54 to R59) |

**Rejected:** a custom rule catalogue, 16 h shifts as overtime-only (log #5, #13), a catch-all handler that hid `403`s as `500`s (#69).

## 4. Test cases and verified status

| ID | Case | Expected | Result |
|---|---|---|---|
| T2 | 12 h shift, then an 8 h shift after 7 h rest | BLOCK (U-01, U-05; also U-14), nothing saved | 422, no override (U-14 can't be overridden) |
| T3 | Boundary: night ends 07:00, next shift 15:00 (exactly 8 h) | U-01 passes, U-02 warns, saves once acknowledged | pinned by tests |
| T8 | Payroll export, locked period | equals the golden file | byte-identical |
| T9 | 17 h cover in a lockdown | Block; with a written reason it saves, audited | pinned by tests |

**Last full gate (`8b0df25`, 2026-11-23, before PRs #4 to #8):** API 464 tests, web 341, Playwright desktop 105 passed, tablet 104 passed and 1 skipped; re-gated at release. Checksums, golden and plan fingerprints are exact. No human has walked the demo.

## 5. Governance and ministry suitability

- **Synthetic, no secrets:** weak secrets refused; no keys in history. **Privacy:** role and unit scope on every endpoint (`404` outside); the wall display shows counts only.
- **Safeguards:** overrides need a written reason and are audited; other Blocks cannot be overridden; maker/checker; rule input untrusted.
- **Honest limits:**
  - **Guardrail 4 exception: no human reviewed the rule boundary tests.** Waived by the lead on 2026-11-20; AI verifiers reviewed them (R4 to R7).
  - **Locked periods:** shifts are guarded by the api only (R38). A legal but wrong rule value is caught only by maker/checker and the dry run (R40).
  - **Tokens:** 8 h, no revocation; memory-only on prod-like, sessionStorage on the demo (ADR-025). **Not built:** Excel round-trip, offer withdrawal, payroll-clerk role, OpenAPI (docs/10).
  - **Rules:** U-03, U-11 dormant (retired L16 key); L-01 still lists 16 h; P-01 makes 4-on/4-off crews built-in overtime (no U-13).
  - **Planner:** qualifications warn-only; no part-time floor; leave entered by the planner and shown on the draft roster, not on the live board; Unit C has 4 first-aiders (`docs/roadmap.md`); a late actual is not re-checked.

## 6. Next steps (pilot)

1. **Restore human review:** a practitioner reviews the rule boundary tests and validates the MOCK values.
2. Government SSO with short-lived tokens; a payroll-clerk role; separate database roles with insert-only audit and a locked-period shift guard (ADR-018); non-root containers, TLS, secrets, CI scanning (`docs/08` §9).

**Since v1.0-submission:** limits stated honestly, demo script re-walked, docs matched to the code (`docs/roadmap.md`).
<!-- TODO(PR-E, end of sprint): when PRs A-D land, update this line and the "Last full gate" counts in section 4 (API, web, Playwright) and README section 4 "Count" from the final CI and e2e runs; then re-check it still fits 2 pages at Letter 11pt with 1.38 line height (it has little spare). -->
