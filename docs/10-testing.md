# ShiftCircle — Test Strategy and Test Data

**Status:** Draft v1.0 · 2026-11-19

## 1. Goals

1. Prove every rule behaves correctly **at its limits** (the most likely place for bugs, and what labour relations will ask about).
2. Prove the safeguards: an emergency-override Block (U-01, U-05, and U-03, which is dormant outside test fixtures: its row keys on the retired L16 template) can't be bypassed without a reason, and any other Block (e.g. U-08, U-09, U-14) can't be bypassed at all (ADR-023); maker/checker can't be skipped; locked pay periods can't change; employees can't see others' data.
3. Give the demo and the build record **repeatable** data and scenarios.
4. Produce 2–5 clear test cases (expected vs actual, including a failure or boundary case) for the build record.

## 2. Test layers

| Layer | Tool | What it covers | Runs |
|---|---|---|---|
| **Rule boundary tests** | JUnit 5 + AssertJ, in `shiftcircle-rules` (no Spring, no DB) | Each fact builder and each rule table row at under / exactly / over its limit (§3) | Every build, < 10 s |
| **Scenario library** | Same module; scenarios in `RuleScenarioRunner` (Java) | Named end-to-end rule scenarios with expected outcomes (§4). **The rules publish pipeline runs T1–T6** (T1–T5 plus the O-02 ranking check); T7–T14 are API/database tests. | Every build + every rule publish |
| **Use-case / repository tests** | Spring Boot Test + Testcontainers PostgreSQL | Services with a real database: overlap constraint, locked-period trigger, audit append-only, maker/checker check, ranking, payroll classification | Every build |
| **API and authorization tests** | Spring MockMvc or RestAssured against the running app (Testcontainers) | Every endpoint's happy path, the 422 rule contract, 412 stale ETag, and the permission matrix (`09-access-control.md`, grouped by area method plus per-endpoint authorization tests) | Every build |
| **Payroll golden file** | Use-case test | Export for planted pay period PP-2026-11 must equal `golden/payroll-2026-10-26.csv` byte for byte | Every build |
| **Generator self-check** | Runs at the end of `DemoDataGenerator` and as a test | Dataset invariants (§6.6); build fails if any break | Every build + on demo start |
| **Frontend unit tests** | Vitest + React Testing Library | Components: `ShiftChip`, `RuleResultList`, decision-table editor validation, the preview → 422 → override hook | Every build |
| **End-to-end** | Playwright against `docker compose up` | The 5 demo flows (§5), on desktop and tablet viewport | Before submission (and in CI if time allows) |
| **Accessibility** | `@axe-core/playwright` in the E2E run | No serious/critical axe violations on each screen; keyboard-only run of flows E1 and E3 | Before submission |
| **Performance smoke** | JUnit timing test (`PerformanceSmokeTest`); Playwright does not assert timings | Planning board (100 officers × 14 days) < 1 s; rule check < 200 ms; 90-day report < 2 s (NFR-05) | Before submission |

### Measured performance (NFR-05, 2026-11-20)

Full demo dataset (100 officers, 6,456 assignments, 84 schedule periods, checksum `4156077d76d41bd5fcf6d6a9a0f51111e9007d16c8a0c6b311e09c6fe801da6b`), PostgreSQL 17 in a Testcontainer, `PerformanceSmokeTest` in `maven:3.9-eclipse-temurin-21` on Docker Desktop for macOS. That is a VM, slower than the target host, so a pass here is pessimistic. Five warm-up calls, then 20 timed calls; the board range is four weeks (NFR-05 says 14 days, so this is stricter); the publish figures are single calls.

| Case | Median | p95 | Limit |
|---|---|---|---|
| Planning board, Unit A, 4 weeks (`GET /schedule`) | 11 ms | 15 ms | 1,000 ms |
| Rule check, busiest officer, 28-day look-back (`POST /rule-checks`) | 2 ms | 4 ms | 200 ms |
| 90-day coverage report (`GET /reports/coverage`) | 6 ms | 9 ms | 2,000 ms |
| Rule-set build (compile + scenarios + dry run) | 498 ms | — | recorded, no NFR |
| Rule-set publish (compiles again, then swaps) | 433 ms | — | recorded, no NFR |

These figures are from the clean-worktree run at `fe6487d` (the dataset with the 84 roster weeks).
The run at the tip `2537dd4` gave 17/22, 3/6 and 7/21 ms with a 889 ms build and a 739 ms publish,
and an earlier run on a busier host gave 54/58, 4/7 and 7/15 ms with a 655 ms build and a 516 ms
publish; the host is shared, so expect this spread. The test asserts the median and the p95 against
the NFR limits, so a regression fails the build rather than being noticed in the demo.

**Definition of done for any feature:** its rule and use-case tests pass, its endpoints have authorization tests, and the demo flow touching it passes in Playwright.

### Current counts (API and Playwright at `5a38580`, web unit tests at `8ae4bbd`, 24 Nov 2026)

The sections after this one are the **history** of how the counts grew, release by release; read this block for today's numbers. Counting method: `@Test` methods on their own line (no parameterised tests), and each suite's own runner. Every number below was run on `5a38580` (release 11 `5a3be22` plus the docs PRs and the PR-H rules-wording fix), on a fresh stack per viewport; the API suite ran in GitHub CI (`mvn verify` on PR #19, the same command).

**v1.2 branch (after PR-O and PR-M; not the submission tag, whose counts are the table below):** API **480 = 127 rules + 28 infrastructure + 325 api** (`mvn verify` in GitHub CI on PR #23: 477 at `c6e7ac8`, plus the 3 `PlanInputsNeededTest` tests); web unit tests **567** in 56 files, lint 4 warnings, `tsc -b` clean; Playwright on PR-M's code before the PR-O merge (`421627a`, a fresh stack per viewport): `desktop-datasets` **126 passed**, `tablet-datasets` **125 passed, 1 skipped** (run with `E2E_WORKERS=1` on a loaded host), fixtures (all four projects) **45 passed, 159 skipped**. Checksums, payroll golden and plan fingerprints unchanged.

| Suite | Result | How it was obtained |
|---|---|---|
| API (Maven, Testcontainers) | **470 = 127 rules + 28 infrastructure + 315 api**, 0 failures, errors or skipped | `docker compose --profile test run --rm --build api-test` (`mvn -B verify`), `BUILD SUCCESS`, default class order (locally on `5a3be22`; in CI on `5a38580`). The `@Test` count in the three modules agrees. The release 8 gate was 464 in both class orders; reverse and random order were not re-run for this tip |
| Web unit tests (Vitest) | **532 passed** in 54 files (at `8ae4bbd`, PR #22's head) | `pnpm test` in Docker. `pnpm lint`: 4 warnings, 0 errors. `tsc -b` clean |
| Playwright, real api, desktop | `desktop-datasets`: **124 passed**, 0 failed | The whole desktop suite: the parallel `desktop` project (108 tests) then the stack-wide specs one at a time (16 more, E3 among them). Fresh stack, `EXPECT_COMMIT=5a38580` |
| Playwright, real api, tablet | `tablet-datasets`: **123 passed, 1 skipped**, 0 failed | The same on a second fresh stack; the TV-size check is desktop-only |
| Playwright, fixtures-mode web | **23 passed**, 79 skipped, 0 failed | `--grep-invert @api --project desktop-datasets` against the fixtures build; the skipped tests need the real api |
| Dataset checksums, payroll golden, plan fingerprints | unchanged | no migration or generator change since release 8: 100 `4156077d…da6b`, 120 `82b19cf8…32ca`, 150 `2e6cd938…d7f8`, payroll golden `9f2d51b3…04ff` (asserted by the reset and generator tests in the API run above) |

#### Earlier states (history)

**Final verified state (`5d0f810`, 2026-11-21; the security fixes below are newer).** dev-qa's independent pipeline on the candidate: API
**422 = 123 rules + 27 infrastructure + 272 api** tests, green in the default order and with random
seed 20261121; web **277** vitest; Playwright against the real api, fresh stack per viewport:
desktop **101 passed / 0 failed**, tablet **100 passed + 1 skipped / 0 failed** (the TV-size check is
desktop-only); fixtures **22 / 21** passed. Counts are `@Test` methods on their own line; no
parameterised tests. The 100 dataset checksum is
`4156077d76d41bd5fcf6d6a9a0f51111e9007d16c8a0c6b311e09c6fe801da6b` and the payroll golden
`9f2d51b38581abea673fe5c85aead3670ca45b36db390fee1d2033d1faa004ff`; the 120 dataset checksum is
`82b19cf814acde5c5740f9a9aa1162e61d4b7f5598848f99861d2f4ea66732ca`.

**Security fixes (`p3-sec`, code `74a58c0`).** review-r3's P3-1..P3-5 add three api tests
(`PlannerDiscardRaceApiTest`, `DemoResetFailureTest`, and the concurrency method in
`PlannerAbsenceApiTest`). An author run at that tip is **425 = 123 rules + 27 infrastructure + 275
api** in both orders; dev-qa verification is pending. The last independently verified tip is still
`5d0f810` at 422.

**Phase 3 preference/pattern (`p3-pref`, merged tip `78fb935`; dev-qa gate pending).** The branch
adds **19 api tests** over `p3-sec`'s 425: preference multi-select (V9, legacy value, validation),
the V9 backfill, coverage `extraPercent` and the axis floor, the ACKNOWLEDGE-Block sentence, the V10
default/backfill, the pattern API and validation, mixed-cohort generation, and the two plan
fingerprints. Author run from a clean worktree at the code tip `761f763` (Java identical to the
handover tip): **444 = 123 rules + 27 infrastructure + 294 api**, 0 failures/errors/skipped in the
default order (dev-qa's gate runs both orders); web **290** at the merged tip. The 120 draft is
5,103 assignment rows and the 100 draft 6,586, each sha256-identical to `c9ac073`; the 100/120
checksums and the payroll golden are unchanged. dev-qa's full gate is pending.

**Release 3 unit closures and staffing (`p4-unit`, code tip `ee4020c`; dev-qa gate pending).** The branch adds **8 api tests**: V11 and the shared `unit_active_on` function, the Units/closures API with its plain validation, the flagged future shifts, the staffing split/formula/allocations, the mid-quarter Unit C close with relief and determinism, and the no-closure identity assertions in `Demo120ResetApiTest`. Author run: **450 = 123 rules + 27 infrastructure + 300 api** in a clean default run before dataset 150, then demo 100/120/150, UnitApi, UnitPlanning and the V11 migration green at the 150 tip (12 targeted tests). The full **452 = 123 + 27 + 302** run is dev-qa's gate; my repeat at the 150 tip was killed by the harness timeout under host load (no test failure in the log). Web **313** at the merged tip; Playwright counts follow the merged-stack run. The 100/120 checksums, payroll golden and both plan fingerprints are unchanged while no unit is closed.

**Release 4 (`p5`, code tip `a23fa47`; docs handover tip follows; dev-qa gate pending).** The release adds **8 tests**: 4 rules (`EightHourNightWarningTest` ×3, the shift-types alternative check in `RuleRowValidatorTest`) and 4 api (`RuleSentenceTest` pin, `RuleSetV3SeedTest`, the NOT_ROSTERED headline test, the owner-token test). Author run on the merged tree: **460 = 127 rules + 27 infrastructure + 306 api**, 0 failures/errors/skipped in the default order; web **316**; audit codes 49. The five changes are: **#20** release 3's Block + ACKNOWLEDGE sentence is pinned over all three rows; **#14** a shift-less officer reads NOT_ROSTERED and is excluded from the scorecard/Compare preference counts (120: 195/240 → 196/214, 92%); **#17** the demo lock is owner-token based, so the reset's explicit release plus finally cannot free a new owner's permit (N-2 is unchanged and reported: a failed reset needs a retry); **#10** V12 publishes rule-set v3 with U-16 (Warn/acknowledge) for an 8 h officer on a night shift, 100/120/150 plan fingerprints unchanged because the planner never makes that assignment; **#16** the remaining "Week over 60 hours" web fixture strings and the U-14 message now read 48/60. Dev-qa's gate also found the pre-existing literal-route shadow that made the Shift types table (and U-16) unreachable; dev-build2 removed it red-first and the router test now opens `/rules/7/shift-types`. The 100/120/150 checksums and the payroll golden are exact.

**Release 5 (`p6`, API tip `60f8f7d`; web merges follow; dev-qa gate pending).** L16 is retired: the 100 seed has **no L16 rows** (was 270), V13 retires the template (`active=false`) without deleting old history, and new assignments/open shifts naming it get a plain 400. PC-03 is now P12 + a 5 h extension (17 h actual). New 100 pins: checksum **`4156077d...da6b`**, payroll golden **`9f2d51b3...04ff`** (1,037 rows, 8,197.60 worked h), plan fingerprint **unchanged** `ec337014...409e1b` (6,586 rows, 727 gaps); its warnings move **117 -> 135** because removing L16 history removed U-14 baseline keys, exposing 18 real U-14 plan warnings (U-12 78, U-14 57). The gate finding that PC-01 lost U-14 and Tara had no block-free pick-up was repaired in the seed (Nia: Mon 16 P12, Thu 19 E8, Sat 14 removed; Tara: Sun 29 removed), and the self-check asserts both; the repaired PC-01 block set is U-01/U-05/U-08/U-14 (64 h). Golden and plan stayed exact. The 120 and 150 checksums/fingerprints are exact. Author run: **462 = 127 rules + 28 infrastructure + 307 api**, 0 failures/errors/skipped; web **318/318** at the merged tip, build clean, lint 4 pre-existing warnings, audit codes 49.

**Release 7 #27 (`p8`, API tip `5c6e922`; merged code tip `eb7132c` with p8-web `0c888da`; final docs tip follows; dev-qa gate pending).** Planner draft edits: preview, add, move/reassign and remove, PLANNER and DRAFT only, `If-Match` draft version; Pass saves, Warn needs `acknowledgeWarnings:true`, Block refuses; one `edit_plan_draft` audit code with kind `ADD|MOVE|REASSIGN|REMOVE`; full synchronous recompute of gaps/warnings/scorecard (qualification included) via the extracted `PlanGenerator.assess`; commit still re-verifies every row. The pre-extraction characterization `GeneratorCharacterizationTest` at `84d0ea0` pinned the 100/120/150 checksums, the payroll golden, plan fingerprints, row counts and warning totals; it stays in the suite at the tip and the extracted path keeps it green. `PlanDraftEditApiTest` covers: preview saves nothing; remove+add restores the 5,103-row fingerprint and reproduces the generated scorecard (every key except `generatedMs`); a fresh generate after those edits is the unedited fingerprint again; duplicate 409, stale 412, missing If-Match 428, non-PLANNER 403, retired L16 400, closed unit 409; a one-way reassign audits `REASSIGN`; the UI-shaped Wade ESC D12 -> N8 same-day move is a Block 422 that saves nothing; the Bram E8 move is 422 `warnings-need-acknowledgement` then 200 with the acknowledgement; commit after edits 200 and a later edit 409. Generate/discard delete edits. The author run uses `-DargLine="-Xmx1536m -Dspring.test.context.cache.maxSize=1"` so the 26+ Spring contexts cannot exhaust the Docker VM (the default cache is 32); the tests themselves are unchanged. Author run: **464 = 127 rules + 28 infrastructure + 309 api**, 0 failures/errors/skipped, default and reverse order; web **341/341** at `0c888da`, `tsc -b`/build clean, lint 4 pre-existing warnings, audit **50** and `check-audit-codes.sh` agrees (web label "Draft shift edited").

## 3. Rule boundary matrix

Each line is at least three tests: just under, exactly at, just over. Times are local (America/Regina).

| Rule | Under (expected) | Exactly (expected) | Over (expected) |
|---|---|---|---|
| U-01 min 8 h rest in 24 h | 7 h 59 m rest → **BLOCK** | 8 h 00 m → **PASS** (inclusive) | 8 h 01 m → PASS |
| U-02 target 12 h between regular shifts | 11 h 59 m → **WARN** | 12 h → PASS | 13 h → PASS |
| U-03 12 h after a 16 h shift (**fixture-only**: the row keys on the retired L16 template, so it does not fire on live data) | 11 h 59 m → **BLOCK** | 12 h → PASS | — |
| U-04 10 h after OT extension ≥ 4 h | extension 4 h + rest 9 h 59 m → **WARN**; extension 3 h 59 m + rest 8 h → PASS (rule not triggered) | 10 h → PASS | — |
| U-05 max 16 h in any 24 h | rostered 16 h shift (exactly 16 h) → PASS | 16 h shift + 15 min extension → **BLOCK** (emergency override only) | — |
| U-08 max 7 consecutive work days (8 h) | 7 → PASS | 8th day scheduled → **BLOCK**; 8th day via overtime → **WARN** | — |
| U-09 max 4 consecutive 12 h shifts | 4 → PASS | 5th scheduled → **BLOCK**; 5th via OT → **WARN** | — |
| U-10 max 4 consecutive 12 h overnight (19–07; A12 00–12 and N12 19–07) shifts | 4 → PASS | 5th → **WARN** | — |
| U-11 16 h shifts: 3 per 7 d, 10 per 28 d | 3 in 7 d → PASS | 4th within 7 d → **WARN**; 11th within 28 d → **WARN** | 4th exactly 7 d after the 1st → PASS (window boundary) |
| U-12 2 consecutive days off per 7 | 48 h off → PASS | 47 h 59 m off → **WARN** (a break of 24 h or less isn't a day of rest) | — |
| U-14 weekly ceiling: warn above 48 h, block above 60 h | 48 h → PASS | 48.25 h → **WARN**; 60.00 h → **WARN** (the limit itself passes; the Block is above it); 60.25 h → **BLOCK** (no override, ADR-023) | — |
| U-16 8 h officer on a night shift | D8 07:00 → no result | N8 23:00 → **WARN** (acknowledged, not overridden); N12 19:00 → no result | — |
| P-01 overtime by pay period (threshold 80 h) | 80 h worked → 80 REG | 80.5 h → 80 REG + 0.5 OT15 | 96 h incl. a picked-up 16 h shift → 80 REG + 16 OT15; rostered 16 h shifts within 80 h → all REG |
| P-02 day of rest: 2×, min 2 h (off by default; test when switched on) | 1 h worked → paid 2 h OT20 | 2 h → 2 h OT20 | 8 h → 8 h OT20 |
| P-04 OT under 30 min unpaid | 29 m → 0 | 30 m → 0.5 h | — |
| L-01 / S-03 16 h regular only where allowed | 16 h rostered on a unit with `allows_16h` → PASS | 16 h rostered on a unit without it → **BLOCK** | — |
| Pay-period lock precondition (ADR-017) | one shift ended 1 min before now with no actual → lock **409 missing-actuals** | shift ending exactly now (`end_at = now`) with no actual → **409** (it counts as ended); with an actual or absence → lock succeeds | shift ending 1 min after now with no actual → not counted; lock succeeds if all ended shifts are recorded |
| Time zones / midnight | Night 23:00–07:00 crossing midnight: `work_date` = start date; a 12:00–24:00 shift **ends at 00:00 the next day** (not 23:59); 00:00–12:00 shift belongs to its own date; a 16 h shift 20:00–12:00 spans two dates; N12 19:00–07:00 crosses midnight with `work_date` = the start date and counts 12 h in the 168 h window; rest maths correct across midnight and month end (31 Oct → 1 Nov) | | |

**U-15 is a board status, not a rule row.** The board reads the pay period that contains the
requested `from` date and shows UNDER below 72 h, APPROACHING from 72 h, and IN_OVERTIME from 80 h.
`ScheduleApiTest#overtimeStatusChangesAtThePayPeriodThresholdBoundaries` pins 71.99 h, exactly 72 h,
79.99 h, exactly 80 h and 80.01 h (the `hours` column is 2 dp, so 71.99 h is 71 h 59 m 24 s);
`#overtimeStatusUsesThePeriodThatContainsTheBoardDateAndCountsAMidnightCrossing` checks the last day,
a 23:00–07:00 entry and a separate 2027 period.

## 4. Scenario library (named, reusable)

These are the verification cases. Pick 2–5 for the build record (recommended: **T2, T3, T7, T8, T9**). The rules publish pipeline runs T1–T5 and the T6 ranking check (`RuleScenarioRunner`); T7–T14 are covered by their own API/database tests because a rule row cannot affect payroll, maker/checker or lock behaviour.

| ID | Scenario | Expected |
|---|---|---|
| T1 | Assign a day shift to a rested, qualified officer under the threshold | Saved; all rules PASS |
| T2 | 12 h shift Fri 12:00–24:00; assign a Day 8 h shift Sat 07:00 (7 h rest; 17 h in 24 h) (planted **PC-01**) | **BLOCK** U-01 and U-05; message names both shifts; nothing saved. U-14 also blocks when the proposal takes the week over the 60 h ceiling (it does for the demo's Nia: 64 h), and U-08 blocks because the proposal makes 8 consecutive work days |
| T3 | **Boundary:** Night 8 h ends 07:00; Evening starts 15:00 (exactly 8 h) (planted **PC-02**) | U-01 PASS; U-02 WARN; saves after acknowledgement |
| T4 | A 16 h shift 20:00–12:00, then a shift starting 20:00 the same day (8 h rest) | U-01 PASS (exactly 8 h), **BLOCK** U-03 (needs 12 h after a 16 h shift; **fixture-only**: an L16 row is inserted, no live data has one) |
| T5 | Fifth consecutive 12 h overnight 19–07 shift (planted **PC-04**) | WARN U-10; saves after acknowledgement |
| T6 | Overtime candidates for planted open shift **PC-08** | Order matches fewest-OT-then-seniority; an officer with insufficient rest is SKIPPED and keeps their place; unqualified officer UNAVAILABLE for Control (**PC-09**) |
| T7 | Rules admin lowers U-10 from 4 to 3 nights; build + dry run | Dry run lists the existing 4-night runs (**PC-06**) as new warnings; after approval and publish, the same check now warns; **no code change** |
| T8 | Payroll export for locked period 26 Oct – 8 Nov (planted **PC-05**) | CSV equals the golden file; per-officer totals equal actual hours; overtime only for hours beyond the 80 h period threshold |
| T9 | **Human judgment:** lockdown; supervisor needs an officer for 17 h (planted **PC-03**) | BLOCK without override; with a reason (≥ 10 chars) it saves, creates an override record, appears in the audit log and the overrides report |
| T10 | Rules admin tries to approve their own draft | `403` from the API and rejected by the database check |
| T11 | Supervisor edits an actual in a locked pay period | `409`; database trigger also refuses |
| T12 | Employee requests another officer's hours | `404` (not revealed) |
| T13 | Validation: a rule row value below the legal floor (U-01 = 7) | Build fails validation with a plain message; can't be submitted |
| T14 | Supervisor locks a pay period with 3 ended shifts lacking actuals (ADR-017) | `409 missing-actuals` listing the 3; period stays open; after recording them, lock succeeds and is audited |

## 5. End-to-end demo flows (Playwright)

| ID | Flow | Checks |
|---|---|---|
| E1 | Supervisor tries to assign Nia Thompson to Sat days → blocked → "Find eligible officer" → offers to two officers | Block banner and messages; ranked list order; offer recorded |
| E2 | Employee (Tara) accepts the offer; supervisor confirms | Offer status changes; assignment appears on both screens; overtime status updates |
| E3 | Rules admin changes U-02 (rest target between shifts) from 12 to 14 h → build → submit; approver approves and publishes | The live sentence names the shift kinds in words (no stored pattern, no repeated clause); checklist states; dry-run numbers (real api: 1 result changes, U-02 in Unit A); live version increments; maker can't approve |
| E4 | Supervisor records actuals, locks the period, exports payroll | Lock prevents edits; CSV downloads and matches |
| E5 | Wall display | Shows counts only; no names anywhere in the DOM; refreshes |

These five flows are also the backbone of the ≤ 5-minute demo recording.

## 6. Demo dataset specification (`DemoDataGenerator`)

### 6.1 Fixed parameters

| Parameter | Value |
|---|---|
| Seed | `20261001` (`SC_DEMO_SEED`) |
| Window | 1 Oct – 29 Dec 2026 (90 days) |
| "Today" | 19 Nov 2026 (`SC_DEMO_TODAY`): days before today get actuals; today and later are planned only |
| Pay periods | Biweekly, Monday start: 28 Sep, 12 Oct, 26 Oct, 9 Nov, 23 Nov, 7 Dec, 21 Dec. Periods ending before today are **LOCKED**. |
| Schedule periods | One roster week (Monday–Sunday) per unit, from the Monday before the window (28 Sep) to the week that starts in it (28 Dec): 14 weeks × 6 units = **84 rows**. Weeks that ended before "today" are **PUBLISHED** (the morning after they ended); the week "today" falls in and the weeks after it are **DRAFT**, so a supervisor has a period to publish. Every shift points at the period that covers its work date. |
| Rule set | v1 from `05-union-rules.md`, published 1 Oct; the generator then creates demo versions v2–v7 (history only) so the Rules screen shows a realistic version list |

### 6.2 Units and required staffing (by block, ADR-013)

| Unit | Day 07–15 | Evening 15–23 | Night 23–07 | Qualification rule |
|---|---|---|---|---|
| Unit A · Living unit | 5 | 5 | 4 | ≥ 1 FIRST_AID per block |
| Unit B · Living unit | 5 | 5 | 4 | ≥ 1 FIRST_AID per block |
| Unit C · Living unit | 5 | 4 | 4 | ≥ 1 FIRST_AID per block |
| Admissions | 3 | 3 | 2 | — |
| Control | 3 | 3 | 3 | all CONTROL |
| Escort & transport | 6 | 4 | 2 | all ESCORT |
| **Total** | **27** | **24** | **19** | |

12-hour patterns are allowed on Units A–C and Control (`allows_12h`); the `allows_16h` flag remains in the data for old history, but the 100 seed no longer creates 16 h slots (ADR-029); Admissions and Escort use 8-hour shifts only.

### 6.3 Why these numbers produce realistic overtime

- Overtime is counted **per pay period** (P-01): officers who pick up extra shifts go over 80 h; rostered 12 h and 16 h shifts alone don't.

- 60 officers on 12 h "2 × 00–12, 2 × 12–24, 4 off" (4 crews of 15, each starting 2 days apart) → every day 15 officers work 00:00–12:00 and 15 work 12:00–24:00. (The order matters: a 12–24 shift can't be followed by a 00–12 shift the next day, which would be zero rest.)
- 30 officers on 8 h "5 on, 2 off" rotations with staggered days off: 16 on days, 12 on evenings, 2 on nights → about 11.4 / 8.6 / 1.4 on duty per day.
- The old 100 seed had 10 officers on 16 h shifts; that shape is retired with L16 (ADR-029). The current seed covers the same blocks with the 8 h and 12 h shifts.
- On-duty supply before absences: 00–07 ≈ 19.7, 07–12 ≈ 29.7, 12–15 ≈ 26.4, 15–20 ≈ 23.6, 20–23 ≈ 26.9, 23–24 ≈ 19.7, against required 19 / 27 / 27 / 24 / 24 / 19: about 585 staff-hours a day available against 560 required (≈ 4% spare), with some hours short and some over. That matches requirements **only when nobody is absent**, so the ~4% absences (2% sick + 2% vacation, ADR-020) create real gaps that overtime must fill. That's the point of the dataset.
- **Coverage is measured hourly** (ADR-013 revised): a block is covered when every hour in it meets the required headcount. A 00–12 shift therefore counts toward the end of the Night block and the first 5 hours of the Day block.

### 6.4 People

| Item | Rule |
|---|---|
| Names | First and last names drawn from fixed fictional lists (60 + 60) in the repo, combined uniquely by the seeded random generator. The named demo characters (Tara Nakamura, Nia Thompson, Ruth Okafor, Marc Desjardins, Kari Lindqvist, Sam Abara, Piotr Kowalczyk, Leah Morin, Devon Clarke, Aiden Bergeron) are created first with fixed IDs, matching the UI design. |
| Home units | Spread to fit requirements; Control and Escort staff hold those qualifications |
| Qualifications | CONTROL 25 officers; ESCORT 30; FIRST_AID 70 (overlaps allowed) |
| Seniority dates | Spread 2006–2025; include **two officers with equal OT hours and different seniority** (tie-break test) |
| Classification | All `CO`; FTE 1.00 |

### 6.5 Events

| Event | Rule |
|---|---|
| Sick days | ~2% of past and near-future shifts, random (seeded); recorded as type SICK only (ADR-020) |
| Vacation | ~2% of shifts, as blocks of 3–7 consecutive days, booked in advance (ADR-020) |
| Gap filling | For each hour below requirement, create an open shift; fill using the **real** ranking and rules: candidates in O-02 order, skip any with a Block, voluntary acceptance with probability 0.7 (seeded). Leave ~1–2% of gaps unfilled so reports show imperfection. |
| Actuals (past days) | Worked as scheduled, except: absences; ~3% of shifts extended by 0.5–2 h (extra hours; overtime only if the officer ends the period over 80 h); a few early leaves. Time entries get pay codes from the pay-classification rules. |
| Overrides | Exactly one: the planted PC-03. (An earlier version also planted three decorative overrides; they were removed after review because they were audit records of events that never happened.) |
| Audit | Every generated change writes an audit event with actor `system:generator` |

### 6.6 Planted cases (stable IDs, used by tests and the demo)

| ID | What | Where |
|---|---|---|
| PC-01 | Nia Thompson: P12 Fri 20 Nov 12:00–24:00; assigning her D8 Sat 21 Nov 07:00 is blocked by U-01 (7 h rest), U-05 (17 h in 24 h), U-08 (8 consecutive work days with the following week) and U-14 (the week reaches 64 h) | Unit B |
| PC-02 | An officer with N8 ending Thu 26 Nov 07:00 and an E8 slot open at 15:00 (exactly 8 h). **Caveat (dev-qa, 2026-11-20):** the planted officer (E-003) is also at 10 consecutive days in the base roster, so U-08 blocks the assignment too. Use PC-02 to show the boundary rule result (U-01 silent at exactly 8 h, U-02 WARN for 8 h against the 12 h target), not as an assignment to save | Unit A |
| PC-03 | P12 shift starting **Tue 3 Nov** 12:00 and ending 24:00, with a **5 h actual extension to 05:00 on Wed 4 Nov** (17 h worked; the assignment stays 12 h) and override reason "Lockdown, relief unavailable" (E-047 Pia Nguyen). Unit C is in no demo supervisor's scope, so it shows on the **auditor's** (facility-wide) overrides report, not a supervisor's | Unit C |
| PC-04 | Piotr Kowalczyk: four consecutive A12 (00:00–12:00) ending Mon 23 Nov, with a fifth available | Control |
| PC-05 | Pay period 26 Oct – 8 Nov, LOCKED, with officers under, exactly at and over the 80 h threshold, and a 29-minute extension (unpaid) | All |
| PC-06 | At least three 4-night runs in the published roster (for the dry-run test T7) | Mixed |
| PC-07 | Two officers with identical OT hours this quarter, different seniority | Unit A |
| PC-08 | Open shift Sat 21 Nov Unit B Days with candidates matching the UI's Overtime board; Tara Nakamura (the demo employee account) is free to take it | Unit B |
| PC-09 | An officer without CONTROL qualification ranked first for a Control open shift | Control |

### 6.7 Self-check (generator fails the build if any is false)

1. No overlapping assignments for any officer.
2. Apart from planted cases PC-01 to PC-04 and the logged overrides, **no saved assignment breaks a Block rule** of the rule set in force on its date.
3. Coverage: ≥ 97.5% of hour-slots meet requirement across the window; at least 5 unfilled gaps exist.
4. Overtime: total 3–8% of worked hours (ADR-020); at least 10 officers with zero overtime and at least 5 above 25 h this quarter (skew).
5. For every locked pay period: sum of actual time entries = sum of payroll export lines per officer. *(Checkable only once the payroll export exists, step 9; until then the self-check doesn't assert it.)*
6. Every person row has `is_synthetic = true`; no name appears outside the fixed lists. *(Enforced by construction, since names are drawn only from the fixed lists, rather than by a separate assertion.)*
7. Re-running with the same seed produces identical row counts and a matching checksum of assignments.
8. Every assignment that ended before "today" has an actual time entry or an absence (so every past period can be locked, ADR-017).
9. Schedule periods: every unit has one Monday-to-Sunday period per week of the window, no two periods of a unit overlap, the weeks that ended before "today" are published and the current and later weeks are drafts, and every shift points at the period that covers its work date.

## 7. Test data hygiene

- Unit tests build their own tiny fixtures with builders (`aShift().night12().endingAt("2026-11-21T07:00")…`), never the demo dataset.
- Integration tests use Testcontainers with migrations applied and **only** the fixtures each test needs. E2E tests use the full demo dataset after `docker compose down -v`.
- No real names, real staffing levels or non-public operational details, ever (synthetic data only, ADR-004).

## 8. Intentionally not built

Things the design describes that the prototype does **not** have. They are listed so that nothing reads as an implied feature, and no test claims to cover them. Checked against the code on 2026-11-20.

| Not built | What exists instead | Where it is designed |
|---|---|---|
| **Excel round-trip** for rule tables (download/upload `.xlsx`) | The in-app grid only. No export or import endpoint, no Apache POI dependency | docs/04 §2, docs/07 §4.7, FR-74 |
| **Employee shift planner** ("Propose shifts", `/me/propose`) and the supervisor's **proposals inbox** (`/proposals`) | Placeholder pages that say what is planned; no `/proposals` api. The `! D proposed` chip exists only in the fixtures web | docs/07 §4.4, docs/ui/README §6 |
| **My hours** (`/me/hours`) and a separate **rule version review** page (`/rules/{version}/review`) | Placeholder pages; the approver reviews and approves on the rules screen | docs/ui/README §6 |
| **Withdrawing or expiring an overtime offer** | Offers are accepted or declined. The schema has `WITHDRAWN` and `EXPIRED` statuses, but nothing sets them | docs/07 §4.2 (move and cancel) |
| **`ETag`/`If-Match` in general** | Only assignment move and cancel (docs/07 §4.2); rule drafts rely on the build fingerprint | docs/07 §1 |
| **Per-officer "changed since published" flag and the short-notice check** (FR-07, P-05/S-01) | The board returns `publishedState.unpublishedChanges` as a real count (the shifts of the period changed after it was published, from the audit trail) and names the period in `period`; no P-05/S-01 rule row and no per-officer changed marker | FR-07, docs/06 `schedule_period`, docs/05 P-05/S-01 |
| **OpenAPI document and Swagger UI** (NFR-09) | `docs/07` is the written contract. No springdoc dependency, no `/api/v1/openapi.json` and no Swagger UI | NFR-09, docs/07 §1 |
| **Editing shift-template start times through the rules flow** (ADR-015, FR-02) | The templates are seeded in `V2` (six), `V6` adds D12/N12 and `V13` retires L16 (eight rows, seven active). The rules screen's `/rules/{version}/shift-types` route resolves to the SHIFT_LENGTHS table (allowed lengths), not a shift-template editor | ADR-015, docs/ui/README §6 |
| **Full token claims:** `nbf`, `iss`, `aud` | The mock issuer's tokens are checked for signature, `exp` and the identity claims only. A real identity provider over OIDC would bring the rest (pilot) | docs/09 §4 |
| **A payroll-clerk role** for lock, unlock and export | Any supervisor with a unit in scope, audited (ADR-022) | ADR-022 pilot note |
| **Arrow-key (roving tabindex) navigation** in the roster grid | Every chip is reachable by Tab, with a skip link; reaching one can take many presses | ai-dev-log #51 |
| **Tablet-specific layouts** | Responsive layouts; the e2e suite runs at 768×1024 with axe. No tablet-specific design or touch testing | docs/ui/README §4 |
| **Wall display "open shifts in the next 48 h" list** | Counts of open shifts today per unit and in total (the api returns counts only) | WallDisplay.dc.html |
| **Notifications, shift trades** | Offers are in-app only | ADR-010 |
| **A session that survives a refresh on `prod-like`** (token persistence) | The token is memory-only by decision on prod-like; the demo profile does keep it in `sessionStorage` (ADR-025 amendment, built and tested): on prod-like a refresh, new tab or deep link shows "Please sign in to continue." and returns to the screen after sign-in | ADR-025 |

- **Cycle-average hours in payroll:** payroll overtime stays per 14-day period (P-01, unchanged). The planner scorecard reports `quarterHours` per officer (min/avg/max) as a U-13 report-only figure; the default rotating pattern's 72 h changeover period is not rebalanced by payroll, and real cycle averaging would need a rule change.

- **Qualification coverage card (release 6 #6, Option A, warn-only):** the scorecard `qualification` card counts, for every active unit requirement with `min_with_qualification > 0`, the block-days where fewer qualified officers are on duty than the minimum. No placements change; no rule is enforced. With no closures: 100 **346 of 1,470**, 120 **0 of 1,470**, 150 **103 of 1,470** (A DAY16, A NIGHT9, B DAY9, B NIGHT10, C DAY22, C EVENING1, C NIGHT20, CTL DAY2, CTL NIGHT8, ESC DAY2, ESC NIGHT4). A date-aware closure removes that unit's checked days (UnitPlanningApiTest closes Unit C from 15 Feb 2027: 42 of 98 days checked, 1,302 total = 1,470 - 3 C requirements x 56 closed days; a closure from 1 Mar removes 3 x 42 and gives 1,344, as gate 6 saw), and an officer placed as relief is counted in the unit where they are placed with their own qualifications. `valid_from` is not read; the card says so. `qualificationPolicy` is removed.

- **16-hour shifts in the planner:** the planner rosters 8- and 12-hour shifts only; a 16 h preference is stored and shown unmet ("the planner does not roster 16-hour shifts"). In practice a "16 h shift" is a 12 h shift plus an extension of about 4–5 h worked as overtime and recorded after the fact (the U-04/U-05/P-01 paths); the person confirmed this on 2026-11-21. L16 is retired (V13 inactive, no rows in the 100 seed, ADR-029); the U-03/U-04/U-05/U-11 rules and the extension tests stay.

- **Part-time/casual hours:** the planner targets FTE × 80 h per pay period for FTE < 1.0 officers, who fill leftover gaps and nights newest-first and are never guaranteed hours; the scorecard reports planned vs target by FTE band. Payroll overtime stays per period and does not average over a cycle.

- **D12/N12 crews (V6):** `HoursAndRunsRulesTest` adds the boundary cases: D12/N12 are 12 h kinds with nominal 720; U-02 warns after an N12 into a D12; U-09 four D12 pass and five block; U-10 four N12 pass and five warn (the fact builder counts N12 as an overnight); U-14 four N12 = 48 h pass, five = 60 h warn, plus a D8 = 68 h block (midnight crossing counted); U-05 a 16 h D12 extension passes and 16.25 h blocks. `PlanGeneratorCrewTest` proves 4 N12 + 4 D12 + 4 D8 + 2 E8 stay in their crews, 2 N12 on every one of the 98 nights, no N8/L16/A12/P12, and the scorecard reports the N12 crew.
- **Night rule:** an 8 h officer never gets N8; the default plan's night blocks are covered only by 12 h A12 (100 seed) or N12 crew (120); an 8 h NIGHT preference is shown unmet with "only 12-hour officers work nights". The default 100 plan is 727 gaps of 1,764 (DAY 109, EVENING 30, NIGHT 588) after the paired 12 h phases; every unit-night is still short with 14 effective 12 h officers for 19 posts.
- **Coverage is absolute time:** `ScheduleQuery` and the plan's gap report use `CoverageCalculator`; the NIGHT block on D is 23:00 D to 07:00 D+1. The board and a committed plan now agree exactly (576 before the night rule; the same per-unit/per-block counts), instead of the old day-modulo board counting every night short (1,058 vs 571).
- **Planner compare:** after a commit the board and draft columns are identical (coverage gaps, shifts, officers, hours, warnings, weekends); before a commit the board is the seeded state. The compare is real, not two rows with a hard-coded 0. A committed id stays readable (`committedDraft` in `/planner/plan`, gaps/warnings/schedule/coverage/compare all 200), and a supervisor edit after the commit moves only the board column; `draftStatus: COMMITTED` and `basis` say the comparison includes edits since the commit.
- **Reset lock:** acquire on the request thread, release on the virtual reset thread. `DemoOperationLockTest` proves a cross-thread release and no double permit; `DemoResetApiTest` resets twice in a row (~5 s each) and pins the 100 checksum, no D12/N12 in the 100 roster, and ADM/ESC `allows_12h=false` after V6.
- **Time entries:** `PUT /time-entries` with `workedAsScheduled:true` plus actual times is `400` problem+json ("Send either workedAsScheduled or the actual times, not both") and writes nothing; an adjusted actual must be within 24 h of the rostered shift.

- **120 dataset (option B):** 100 full-time crews (38 N12 + 54 D12 + 3 E8 + 5 relief; the relief carry N12/D12 crew codes, so tag counts are 41/56/3) + 20 casuals (8 N12-capable, 12 8 h), selector `120`; reset twice identical at checksum `82b19cf814acde5c5740f9a9aa1162e61d4b7f5598848f99861d2f4ea66732ca` (1.4-2.7 s), then reset 100 returns to `4156077d...da6b` and ADM/ESC `allows_12h=false`. The planner on 120 has **38 gaps of 1,764** (2.2%), 7 warnings, generate ~0.9 s, and zero Block; no L16/N8. A real commit writes **5,103 shifts** (board week 77 rows) and a 100 commit writes **6,586**; a LOCKED first period refuses the next commit with 409 LOCKED_PERIOD, and the planner refuses a pre-existing overlapping period with 409 PAY_PERIOD_OVERLAP rather than absorbing it. The 120 seed periods match the 100 layout (last 21 Dec-3 Jan), so the planner's first 2027 period starts cleanly. **Qualifications are not enforced by the planner**: the provider seeds all CTL CONTROL, all ESC ESCORT and FIRST_AID for the first two A/B/C N12/D12 officers plus the E8; measured qualification failures: **0 block-days on 120**, **346 on the 100 seed** (A/NIGHT 98, B/NIGHT 13, C/NIGHT 13, CTL/DAY 1, CTL/NIGHT 98, ESC/DAY 24, ESC/NIGHT 98, A/EVENING 1); the scorecard `qualification` card reports the measured gap (346 of 1,470 on the 100 seed; 0 on 120; 103 on 150), warn-only. **Planned leave IS an input now** (item 23): `POST /planner/absences {employeeId,date,type}` (PLANNER only, 401/403 otherwise) inserts a future `absence` row; the next generate skips that officer on that date and the scorecard reports `absences` ("N officers on leave were skipped: relief officers covered M of the shifts"). It is a read-only skip, not leave management; no approval workflow or screens. Same seed + same absences reproduces the plan; no absences returns the baseline plan. Repeating the same officer/date/type returns 200 with the existing row (one absence stored); a different type on the same date is 409. The 120 seed still contains no planned leave by default, so the dataset checksum is unchanged by this feature; the demo adds 3-4 officers for a week through the endpoint.

## Phase 3 test classes (for the acceptance table)

New or materially extended in phase 3: `PlannerApiTest` (draft/commit/scorecard/preferences/compare/committed read), `PlanGeneratorFteTest` (FTE bands and casual target), `PlanGeneratorCrewTest` (D12/N12/D8/E8 separation, 4/4 coverage), `WeekendRotationProbeTest`, `RotatingBreakProbeTest` (variant A-F evidence for ADR-026), `DemoResetApiTest` (100 reset twice, checksum, audit, guards), `DemoResetProfileTest` (not in prod-like), `DemoResetGatingTest` (`sc.demo.generate=false`), `DemoOperationLockTest` (cross-thread release), `Demo120ResetApiTest` (120 composition, deterministic checksum, reset back to 100, 120 plan gaps/warnings/no Block, qualification report), `PlannerAbsenceApiTest` (read-only skip, idempotency, authz, concurrent one-row guarantee), `PlannerHistoryActualApiTest` (an extension on the 21-29 Dec look-back history reaches the generator), `ActualTimesInRulesTest` (the roster/actual envelope: U-04/U-05 and rest see an extension, a short actual cannot relax a Block), `PlannerDiscardRaceApiTest` (a discard racing a commit is 409, never a false DISCARDED), `DemoResetFailureTest` (an Error releases the lock, sets FAILED and hides the raw text), `PlannerPreferenceKindsTest` (F10: D12/N12 score by their template row; scorecard == compare; N12 12/NIGHT MET, D12 8h NOT_MET), `HoursAndRunsRulesTest` (D12/N12 boundary cases), `ReferenceDataMatchesRuleRowsTest` (published v2 == code rows), `SchemaConstraintsTest` (V6 baseline), `ReferenceApiTest` (eight templates), `PayrollApiTest` (contradictory time-entry body), `JwtServiceTest` (tamper test flake fix). The final counts are in §2.
