# ShiftCircle build record

**What it is:** a working prototype that schedules 8, 12 and 16-hour shifts at a fictional 24/7 correctional centre. Supervisors plan against editable Drools decision tables; a quarter planner builds the next 14 weeks through the same engine; time feeds a simulated payroll export. All data is synthetic, not an official Government of Saskatchewan service. Setup: `README.md`.

## 1. Architecture

Browser → nginx/React web → Spring Boot api (Drools rules engine) → PostgreSQL; only the web
publishes a port. A published rule set is compiled and swapped without a redeploy. A change is
previewed, saved, refused with plain reasons, then acknowledged or emergency-overridden with a
reason and audited (ADR-014). The planner writes a draft; commit re-checks and writes the quarter in
one transaction (ADR-026).

## 2. Key decisions

- No AI at runtime: the engine decides and a supervisor approves (ADR-002, ADR-005); Drools tables are edited in the app with maker/checker, test scenarios and a dry run (ADR-012). Coverage is hourly by unit and block in absolute time (the NIGHT block on D is 23:00 D–07:00 D+1); overtime is hours over the pay-period threshold (ADR-013, 016, 017).
- Baseline rule set v2 (V6) is seeded PUBLISHED by migration, like v1, without maker/checker or an audit row; every later version uses maker/checker (ADR-027, docs/04 §6).
- **Phase 3 (ADR-026/027):** a deterministic quarter planner (7 periods from 4 Jan 2027, rotating 5/2 default per officer, fixed 5/2 and 7/3 set per officer, 12 h crew 4/4 read-only), every proposal engine-checked, guarded commit; D12/N12 crews, rule-set v2, dataset 120 (100 FT + 20 casual), read-only absences and actual ends in rule facts.
- **Release 3 (ADR-027/028):** units close from a date; future shifts are flagged, never deleted; a Staffing tile; dataset 150 (120 FT + 30 PT, 20% leave).
- **Lead decisions:** emergency-only overrides (ADR-023), facility-wide lock and export (ADR-022), cross-unit cover (ADR-024), trigger-based audit (ADR-018, prototype only).

## 3. AI-assisted development

**Who and independence.** Claude Opus 5.5 did the design and specs, the phase 3 UI spec and the demo script. From 2026-11-20 an OpenRig team built and verified it: builders dev-build and dev-build2 (DeepSeek V4.1 Flash; dev-build2 on MiniMax until 05:06Z), verifiers dev-qa and review-r2 (GLM 5.3 then Flash), final security review-r3 (Claude Sonnet 5.5), lead Claude Sonnet 5.5. Builders and verifiers are different families except about **10:07Z–11:30Z on 2026-11-20** (MiniMax, R32–R34, weaker independence); phase 3 (R48–R61) is independent. dev-design's visual reviews and scripted planner walk are independent of the API authors but not of the UI spec. 61 review and QA rounds, the e2e runs and two visual reviews are recorded in `docs/process/review-rounds.md`; key fixes were proved by reverting them and watching their test fail.

**What verification caught** that had passed the author's own tests:

| Defect | Caught by | Ref. |
|---|---|---|
| **Remote code execution through a rule edit** (unescaped values in generated Drools source; no approval needed). Fixed in three layers, each enough alone | review-r2 ran a payload | R24, R28 |
| **Concurrent saves passed a Block rule**; now a per-officer lock. An open-shift **double fill** and an **unscoped roster list** were missed by earlier passes and closed later | review-r2; review-r3 | R13, R16, R40, R42 |
| **Phase 3:** candidate 1 had placeholder names, a UTC-midnight commit date, raw FTE keys, the wall Exit over the clock and stale "No draft" preferences; candidate 2 scored D12/N12 preferences as 8 h DAY (68 vs 195); the 120 commit hit a seeded pay period; the actual-time seam was unpinned | dev-design, review-r2 | R54–R59 |

**Suggestions corrected or rejected.** The lead rejected a custom rule catalogue and 16 h shifts as overtime-only (log #5, #13); the builder rejected a catch-all handler that hid `403`s as `500`s, then built it safely (log #69). Phase 3 corrected the 7/3 default and the "gaps are mostly sizing" reading; decisions 15–16 and log #96–97 hold the rest.

## 4. Test cases and verified status

**Release 5 (`p6`, author tip `60f8f7d`; dev-qa gate pending).** L16 retired: no 16 h rows in the 100 seed; V13 inactivates the template; new uses get a plain 400. PC-03 is P12 + a 5 h actual (17 h); the gate repair restored PC-01 and Tara's block-free Sun 29 pick-up. New 100 pins: checksum `4156077d…da6b`, golden `9f2d51b3…04ff` (1,037 rows, 8,197.60 h); plan `ec337014…409e1b` unchanged (6,586 rows, 727 gaps), warnings 117 -> 135. 120/150 exact. API **462 = 127 + 28 + 307**, 0 failures; web 318; audit 49. **Release 6 (#6 Option A, `p7`, author tip `da08dde`).** A read-only qualification card: 100 **346**, 120 **0**, 150 **103** of 1,470 block-days; closed unit-days and start dates are not checked; relief counts where placed. No placement change or migration; pins unchanged. API **462 = 127 + 28 + 307**; web **325/325**, audit 49. **Release 7 (#27, `p8`).** Draft shifts are added, moved, reassigned or removed through the same engine; Block refuses, Warn needs a second save, one audit code, no migration, pins exact.

**Final state (`5d0f810`, independently verified).** API **422 = 123 rules + 27 infrastructure + 272 api**, 0 failures/errors/skipped, default and random order (seed 20261121); web **277**; Playwright real api, a fresh stack per viewport, desktop **101/0**, tablet **100 + 1 skipped/0**; fixtures **22/21**. Checksums: 100 roster and 84 periods `3390148255…6539`, payroll golden `d502848d…d06a`, 120 `82b19cf8…32ca`. Checked by dev-qa (pipeline; demo §1–6 at API level), review-r2 (planner, rule set v2), review-r3 (security) and dev-design (planner walk, §7); no human has walked the demo. Then `p3-sec 74a58c0` (+3 tests) and `p3-pref` (+19) gave **444 = 123 + 27 + 294**, web **290**; drafts sha256-identical to `c9ac073`; checksums, golden same.

| ID | Case | Expected | Result |
|---|---|---|---|
| T2 | 12 h shift, then 8 h after 7 h rest | BLOCK, nothing saved | 422, **no override** (R12, R30) |
| T8 | Payroll export, locked period | Equals the golden file | Recomputed independently; byte-identical (R17, R33) |
| P3 | Quarter plan on dataset 120 | Engine-checked draft, honest gaps, guarded commit | 38 gaps / 7 warnings / zero Block; 5,103 shifts on commit; re-walked twice (R60), 422 both orders (R61) |

## 5. Governance and ministry suitability

- **Synthetic, no secrets:** 100 officers (or 120/150); weak secrets refused; no `.env` or keys in history (R30, R61).
- **Safeguards:** overrides need a written reason and are audited; other Blocks can't be overridden; maker/checker; rule input is untrusted; the planner's commit re-checks and never implies an override.
- **Privacy:** role and unit scope on every endpoint (`404` outside); the wall display shows counts only (R26); the planner reads every unit but can commit only its quarter plan, after the re-check and one accepted warning list.
- **Honest limits:**
  - **No human reviewed the rule boundary tests:** the lead waived guardrail 4 on 2026-11-20 and AI verifiers reviewed them (R4–R7).
  - **Locked periods:** time entries are guarded by the api and a trigger, but shifts only by the api: a raw SQL `UPDATE` can still cancel one (R38); the audit table is append-only by trigger. Rule ranges are sanity bounds: 280 of 297 hostile values were refused, but a legal wrong value (e.g. a 0.5 h overtime threshold) is caught only by maker/checker, the scenarios and the dry run (R40).
  - **Tokens and scope:** 8 h, no revocation, memory-only (ADR-025); mock issuer; nginx root. **Not built:** Excel round-trip, employee planner/proposals, offer withdrawal, payroll-clerk role, arrow-key nav, OpenAPI (docs/10).
  - **Planner:** qualifications warn-only (Release 6 card); no leave seeded (the absence input is a read-only skip); overtime per period (P-01); a late actual not re-checked; 14 of 20 zero-shift casuals read MET and 5 PARTLY (dev-qa; candidate 4 not built); the commit audit stores the warning count, not the list (F8); U-14 passes at exactly 60.00 h (docs/05, docs/10).

## 6. Next steps (pilot)

1. A practitioner reviews the rule boundary tests and validates the MOCK values.
2. Government SSO with short-lived tokens; a payroll-clerk role; separate database roles with insert-only audit and a locked-period shift guard (ADR-018); non-root containers, TLS, a secrets manager and CI scanning (`docs/08` §9).
