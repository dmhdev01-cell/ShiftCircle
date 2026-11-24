# Release notes

What each release added, and the test counts at the time. These paragraphs used to sit in the README; the README now keeps only the current numbers. The author and review rounds behind each release are in [review-rounds.md](review-rounds.md), and the AI-assisted work in [ai-dev-log.md](ai-dev-log.md).

Each release was built on its own branch, gated by an independent QA seat on the exact tip (web, API in two class orders, Playwright per viewport on a fresh stack, dataset checksums, payroll golden and plan fingerprints), and only then pushed to `main` by the operator.

## Phase 3 final (before release 3)

The first independently verified tip was `5d0f810` (R61). API: **422 = 123 rules + 27 infrastructure + 272 api tests**, green in the default order and with random seed 20261121, 0 failures/errors/skipped. Web unit tests: **277**. Playwright against the real API, whole suite, a fresh stack per viewport: desktop **101 passed / 0 failed**, tablet **100 passed and 1 skipped** (the TV-size check is desktop-only) **/ 0 failed**; fixtures: **22 / 21**, as recorded at the time. The static counts agreed (123 + 27 + 272 `@Test` methods, one per line, no parameterised tests).

Two branches followed on top of it:
- **Security fixes** (R62) added three API tests: an author run was **425 = 123 + 27 + 275** in both orders.
- **Preferences and patterns** added 19 API tests: an author run was **444 = 123 + 27 + 294**, web **290**. The 120 and 100 drafts stayed shift-for-shift sha256-identical to `c9ac073`, and the checksums and payroll golden were unchanged.

Both are on `main` and are covered by every later gate.

**Fresh-clone check at `f1d696d` (2026-11-20, macOS, Docker Desktop).** Setup sections 1, 2 and 4 of the README were run from a fresh clone. Both Playwright viewports on one stack gave 21 passed, 1 skipped and 4 failed, all 4 on tablet after desktop had changed the data; tablet alone on a fresh stack gave 12 passed, 1 skipped (the TV-size check runs on desktop only). That is why the README asks for one viewport per fresh stack. The `--add-host` line was run on macOS; on Linux it was not run (`--network host` with `BASE_URL=http://localhost:8080` is the alternative). Not run in that clone: the `api-test` service (the builders and QA ran the same Maven build) and the web unit tests (the same command passed in the branch worktrees).

## Release 3: unit closures, relief and the staffing estimate

Adds dated unit closures, closed-unit relief and the staffing estimate, then Dataset 150. Authored as **450 = 123 + 27 + 300** in a clean default run before Dataset 150; its two 150 tests were green, web **313**. With no closure rows the 120/100 plan fingerprints and all checksums stayed identical, and 150 has its own pinned checksum and plan. the QA seat's first gate found a wall-display defect at `a0d4f6f`; the release passed at `09ed7ba` (R65, R66).

## Release 4: preference headline, Not rostered, demo lock, U-16

Adds the #20 Block + ACKNOWLEDGE pin, #14 `Not rostered` status and the corrected preference headline (Dataset 120: 196 of 214, 92%, scorecard = Compare), the #17 owner-token demo lock, the #10 U-16 Warn/acknowledge rule (rule set v3, V12) for an 8 h officer on a night shift, and the #16 48/60 wording. Author run: **460 = 127 rules + 27 infrastructure + 306 api**, 0 failures/errors/skipped; web **316**; audit codes **49**. The gate found a pre-existing route shadow that made the Rules Shift types table (with U-16) unreachable; it was fixed red-first and the router test pins `/rules/7/shift-types`. The 100/120/150 checksums, the three plan fingerprints and the payroll golden stayed exact; Dataset 120 stays 38 gaps / 7 warnings / 5,103 shifts / 107 officers. Passed at `f1883c4` (R67, R68).

## Release 5: L16 retired

The Dataset 100 seed has no 16 h rows, V13 sets the template inactive without deleting old history, and new assignments or open shifts naming it get a plain 400. PC-03 is rebuilt as a P12 + 5 h actual (17 h). New Dataset 100 pins: checksum **`4156077d…da6b`**, payroll golden **`9f2d51b3…04ff`** (1,037 rows, 8,197.60 h). The 100 plan fingerprint is unchanged (`ec337014…409e1b`, 6,586 rows, 727 gaps) and its warnings move **117 → 135**, because removing L16 history exposed 18 real U-14 plan warnings that the old baseline subtracted. The gate's seed repair restored PC-01 (U-01/U-05/U-08/U-14 at 64 h) and Tara's block-free Sun 29 pick-up; the golden and plan stayed exact. 120/150 checksums and fingerprints are exact. Author run: **462 = 127 rules + 28 infrastructure + 307 api**; web **318**. Passed at `731b722` after the repair (R69, R70).

## Release 6: Qualified staff card

Adds a read-only **Qualified staff** card to the quarter plan: failing and checked block-days per unit and block, with the sentence "N block-days are below the qualified minimum. The planner does not enforce this." Measured with no closures: Dataset 100 **346 of 1,470**, Dataset 120 **0 of 1,470**, Dataset 150 **103 of 1,470**. Closed unit-days are not checked; relief counts where placed; qualification start dates are not checked. Checksums, golden and plan fingerprints unchanged. Author run **462 = 127 + 28 + 307**; web **325**, build clean, lint 4 pre-existing warnings, audit codes 49. Passed at `dae3fac` (R71).

## Release 7: planner hand edits in a draft, and the docs bundle

A planner can add, move (time or unit), give to another officer, or remove one shift in an uncommitted draft. Every save goes through the same rules engine: a Block saves nothing, a Warn needs a second, acknowledged save, and there is no emergency override in a draft. Each save re-scores the whole draft; edited shifts read "· edited" and the audit log records each edit as "Draft shift edited". Generate and discard drop hand edits after a confirm; commit re-checks every shift. No migration; all checksums, the golden and the plan fingerprints stay exact. The same release added the licence, the user guide, the install guide and the move of the process records to `docs/process/`. Gate: web **341**, API **464 = 127 + 28 + 309** in both orders, Playwright desktop **105 / 0 failed**, tablet **104 passed and 1 skipped / 0 failed**, fixtures **43 / 0 failed**, audit codes **50**. Passed at `871375d` (R72).

## Release 8: public repository (docs only)

Screenshots from the gated build in the user guide, the repository made public (and renamed `ShiftCircle`), and small documentation corrections: the closure arithmetic behind 1,302, the `acknowledgeWarnings` types, ADR-030's note on `EXTRA` and the re-score, and comment-only path fixes. One test-only fix rode along: two tests (the reports override and the demo-data self-check) used the real clock; from 23 Nov the reports test failed on a clean tip because its override row fell outside the report window. Both now use fixed demo times. No test was added or removed, and no product code changed. Gate: API **464** in both orders, web **341**, Playwright and fixtures unchanged from release 7. Passed at `8b0df25`.

## Release 10: neutral wording (docs only)

The README no longer describes the repository's purpose beyond "a prototype", and the design-canvas sentence and two process-record wordings were reworded. No code, test or data change; counts as at release 8.

## Release 11 (v1.1): the board as a scheduling grid, a readable quarter plan, planned leave

Everything merged to `main` after tag `v1.0-submission` (`efba3f7`), through sixteen pull requests (#1 to #16) on 23 and 24 November 2026. Gate: the tip `5a3be22`, from a fresh stack per viewport (counts at the end).

**Planning board (supervisor)**
- **Week, Pay period and Month views, Comfortable and Compact density** (#11): totals per officer and per day, a strip of figures in the compact density, coverage heat cells and qualification badges. Week and Comfortable stay the defaults, so the demo walk is unchanged. A pay period says it spans two roster weeks and a month says it spans several roster periods; neither offers a publish.
- **Find, filter, sort and export** (#16): name search, Overtime, Rotation, Works and Qualification filters, sorts, CSV for Excel (this view or the whole unit, with a formula guard), copy for a spreadsheet, and a landscape print that keeps the footer line.
- **Fill a gap from the board** (#15): a short coverage cell or a gap word opens the free officers, ranked by pay-period hours with rest and overtime hints, and *Check & assign* runs the normal rule check.
- **Honest publish and menu** (#14): the publish message no longer claims the officers see the roster as final (FR-06 stays partial); Reports is hidden from the planner, whom the API refuses; Employee view only appears for an account linked to an officer.

**Quarter plan (planner)**
- **Readable plan** (#10): a week picker with gap counts, gaps grouped into runs under a weeks-by-units strip, the all-units table collapsed, a warning marker on flagged shifts, and a line for unused part-time capacity.
- **Planned leave** (#12): leave shows on the draft roster as Vac, Sick or Other, and the planner enters it in a dialog (one audited absence per day, type only). Dataset 150's seeded leave now reads as leave, with relief officers covering it.

**Also in this release**
- **Demo session survives a refresh** on the demo profile, with a build-time kill switch `VITE_PERSIST_DEMO_SESSION=false` (#4); the not-available states for sending a proposal and finding an officer on a slot with no open shift (#5); a dataset notice on the Quarter plan, `activeDataset` on `/api/v1/version`, and the Other absence code (#7); date range and unit pickers on every report (#8).
- **CI** on every pull request (check scripts, web checks, API `mvn verify`) and loopback-only dev ports (#1).
- **Documentation:** the truth pass on architecture, rule defects (U-03 and U-11 dormant) and known limits, with a new roadmap (#9); the audit against the code, an architecture diagram and a documentation map (#13); FR-06 stated as partial (#6); the build record and the demo script re-walked (#2, #3); fresh screenshots and the traceability and coverage rows for all of the above (this release's docs PR).

**No migration, no generator change.** The dataset checksums (100, 120, 150), the payroll golden and the plan fingerprints are unchanged.

**Counts at the gate:** API **470 = 127 rules + 28 infrastructure + 315 api** (`mvn verify`, `BUILD SUCCESS`, default class order, 0 failures, errors or skipped); web unit tests **463** in 51 files, lint 4 warnings and 0 errors, `tsc -b` clean; Playwright against the real API, a fresh stack per viewport: `desktop-datasets` (the whole desktop suite) **124 passed**, `tablet-datasets` **123 passed and 1 skipped** (the TV-size check is desktop-only), 0 failed; fixtures-mode web (`--grep-invert @api`): **23 passed**, 79 skipped (the real-API specs), 0 failed. The parallel projects list 110 tests per viewport and the stack-wide specs add 14 (`e2e/README.md`).

**Still not built** (unchanged, `docs/10-testing.md` §8 and `docs/roadmap.md`): the Excel round-trip, sending a proposal and the proposals inbox, offer withdrawal, OpenAPI, and the rule corrections on the roadmap (U-03 and U-11 re-keyed, L-01, U-13). The planner's `403` cells have no automated test.

## Release 11.1 (v1.1.1): one-line install

Install-only change on top of v1.1: `install.sh` at the repo root (prerequisite checks, pinned clone, generated secrets never printed, `docker compose up -d --build --wait`, health checks, idempotent re-run, never `down -v`), a Quick install section in README and INSTALL, and a CI step running `bash -n` and shellcheck. No application, rules, data or test change; the v1.1 counts stand. Tag: `v1.1.1-submission`.

**Release step:** after merge, tag the merge commit `v1.1.1-submission` and push the tag, then run `scripts/check-install-pin.sh --remote` and the README one-liner once from an empty directory (free port, own `SHIFTCIRCLE_PROJECT`).

## v1.3 (in progress)

### Shift proposals, P1: the officer API

The first of five proposal PRs (P1 to P5; plan `v1.2-proposals`, owner answers Q1 to Q5 approved). **P1 is the API for the officer side only; there is no screen yet.** An officer can preview a multi-item proposal (each item rule-checked with the earlier items as extra facts, so rest between two drafts shows), send it (a Block can't be sent, a Warn can), list their own proposals, and withdraw one while every item still waits. A waiting item expires when its shift starts, on every read and withdraw and by an hourly sweep. Nothing creates a shift: the inbox and the decision are P2, so until then a sent proposal stays Waiting and then Expires.

- **Migration V18** reshapes the unused V1 `proposal` and `proposal_item` tables in place (status and decision sets, decider, comment, snapshots, a note-length check, a decline-needs-a-comment check, an ADD-needs-the-whole-shift check, and a unique index so one officer can't have the same shift waiting twice). The number is V18 because PR-N takes V14 and the supervisors' S1 to S3 reserve V15 to V17; if a lower number is still free at merge time it must be renamed **before** merging, since Flyway refuses an out-of-order version on an existing database.
- **Audit:** three new action codes, `submit_proposal`, `withdraw_proposal` and `expire_proposal_item`, and one entity type, `proposal`; the web labels and `check-audit-codes.sh` agree (**54** codes, was 50: the script counts actions and entity types together). `decide_proposal_item` follows in P2.
- **`SelfActionGuard`** (`ca.shiftcircle.api.security`) is the shared "not your own record" predicate. P2's decision endpoint and the supervisors' S5 self-edit guard use it, so neither feature owns it. P1 only adds it and its unit test.
- **`RuleCheckService`** gains `evaluateWithExtras(change, extraShifts, snapshot)` and `factOf(change, id)`; the existing overloads are unchanged. (The plan called this an `evaluate(change, extraFacts)` overload, but that signature is already the planner seam.)
- Scope and limits: the proposer is always the caller (an `employeeId` in the body is a 400), at most 10 items per proposal and 20 waiting per officer, dates from now to 11 Apr 2027, any active unit.
- **Pins:** no dataset checksum, payroll golden or plan fingerprint reads the new columns; none moved.

Tests: +23 API (20 in `ProposalApiTest`: V18 constraints 3, preview 3, send 5, withdraw 4, expiry 2, scope 3, plus the 20-waiting limit and the list filter; 3 in `SelfActionGuardTest`). Web: the audit labels only. Counts for the whole release are measured once at the end of v1.3.

