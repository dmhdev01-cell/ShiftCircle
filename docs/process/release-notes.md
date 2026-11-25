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

## Release 12 (v1.2): the shift dialog says up front what it can't do; the quarter plan says what it uses; plan options for the quarter plan

Not part of the submission tag. Changes merged after `v1.1.1-submission`, one pull request each. Tag: `v1.2`; `install.sh` and the README and INSTALL one-liners now install `v1.2`, while the course submission, `v1.1.2-submission` (branch `release/v1.1.x`), keeps its own installer pinned to that tag.

**PR-O: a started shift is not offered a move or cancel.** The owner opened a night shift that had already started (Tue 17 Nov, 23:00, with the demo clock at noon on Thu 19 Nov), picked a new date and shift, pressed **Move shift** and only then read "Past shifts are corrected in Time & attendance, not on the schedule." The refusal was right (`409 .../shift-started`); the order was not.
- `GET /schedule` now sends `now`, the business clock's instant (`2026-11-19T18:00:00Z` in the demo, the same clock the api refuses with), and on each live-board shift `actualRecorded`, `absenceRecorded` and `fillsOpenShift`, the same checks `PATCH` and `DELETE /assignments/{id}` make. The planner's draft leaves them out.
- The shift dialog: a started shift has no **Move…** or **Cancel shift…** and says *This shift started on Tue 17 Nov at 23:00. Worked shifts are corrected in Time & attendance.*, with **Open in Time & attendance**. A future shift with an actual or an absence has no **Cancel shift…**, and one that fills an open shift has no **Move…**, each in the api's own words. "Already cancelled" can't be known in advance (the board never lists a cancelled shift); it stays an answer, now with **Reload the board**.
- **Time & attendance** takes `?date=&unit=&shift=`: it opens on the pay period holding the date, filtered to the unit, with that shift's record panel open.
- An api refusal shows its title and its detail, not the detail alone.
- Dates in words: *Scheduled Tue 17 Nov 2026, 23:00 – 07:00 next day*; the shift list says "next day" instead of "+1". The **New date** picker stays a native date input; the line under it says when the moved shift would start, and refuses a start that has already passed, with the reason, before anything is sent.
- After the review (S1): the api refuses a move whose **target** start has passed, `409 .../target-started`, by the same business clock, with or without an override. Before, a move to 16 Nov with an override returned 200 and left a planned past shift that could not be moved again.
- After the review (S2): the board also sends `payPeriodLocked` per shift. A shift in a locked pay period says *This pay period is locked. Unlock it with a reason to make changes.* (the api's words, which it checks before "started") and links nowhere, instead of pointing at a read-only Time & attendance.
- Accessibility and hardening from the gates: the enabled **Cancel shift** button is white on the block red (8.6:1; it was 1.04:1), the Time & attendance record panel is a dialog named by its heading, and the T&A link ignores a `shift` or `date` value that is not an id or an ISO date (a crafted link could crash the screen through a CSS selector).
- The api is still the authority: no rule, payroll, migration or generator change. Dataset checksums, the payroll golden and the plan fingerprints are unchanged.

**Tests:** web unit tests **551** in 55 files (+19: every dialog state including a locked period, the cancel button's colours, the T&A deep link and a crafted link, the date words); lint 0 errors (4 warnings, unchanged); `tsc -b` clean. API: `ScheduleApiTest` gains two tests (the board's `now` and the flags; an absence time entry sets `actualRecorded` but not `worked`, and a locked period sets `payPeriodLocked`), `AssignmentMoveCancelApiTest` one (a past target, with and without an override, exactly now, and later the same day), and `PlannerLeaveRosterApiTest` asserts the draft leaves `now` and the flags out; those classes with `SchedulePublishApiTest`, `AssignmentApiTest` and `ConstraintProblemApiTest`: **54 passed**, 0 failed. New Playwright spec `started-shift-dialog` (@api): a started shift on the board has no Move or Cancel and its link opens Time & attendance on that shift; a future shift (Wed 25 Nov, outside the demo week the other writing specs use) still moves, and a start that has passed is refused before submit. The fixtures-mode move spec now picks a shift after the demo day. Playwright against the real API on a fresh stack at `cca2d4b`, `--project desktop-datasets`: **126 passed**, 0 failed (124 + the 2 new). Tablet and the full `mvn verify` were not run on this branch (CI runs `mvn verify`); the API classes that cover the change (`ScheduleApiTest`, `SchedulePublishApiTest`, `SchedulePeriodSeedApiTest`, `AssignmentApiTest`, `AssignmentMoveCancelApiTest`, `PlannerApiTest`, `PlannerLeaveRosterApiTest`) passed, `PlannerApiTest` on a re-run alone after its 120 s timing guard missed under host load.

**Found, not changed:** a move's rule results can list the same rule more than once (U-16 seven times in one walk); the three new `EXISTS` checks have no supporting index (fine at demo scale, 23–30 ms per board; an index belongs in a pilot-hardening migration).

**PR-M: plan inputs on the Quarter plan** (branch `sc-pr-m`): the plan is no longer a black box.
- A headline above the scorecard, and on the empty quarter before a draft: "Planning 150 officers in 6 units · 120 full-time, 30 part-time or casual · 138 FTE against about 127 needed · 4 Jan – 11 Apr 2027", with the Generate options (the default seed before a draft, the seed used after), the 8 h pattern, the rule set, the planned leave days and the preferences on file.
- A **Show plan inputs** panel: officers by unit × employment × shift pattern, FTE, unit minimums per block, closed days, planned leave by type, preferences on file, the seniority range, the staffing floor, every Generate option in words (unknown options too, so PR-N's options show without a change), and the generator's real fill order in plain words.
- `GET /api/v1/planner/inputs` (PLANNER; 401 without a token, 403 for every other role), built from the generator's own loaders (no second query for officers; the planned-leave loader now also reads the type). Each new draft keeps its own copy in `scorecard.inputs`; hand edits keep it; the card warns when the inputs have changed since. Generate options go in its `options` object, and `PlanInputs.fillOrder(ruleSetVersion, options)` is the one place the order is worded.
- **"Needed" is honest about its period:** the floor is the Staffing card's figure for the stretch between unit closures that needs the most officers, with its dates when a closure splits the quarter. A forced 8 h pattern groups the 8 h officers under that pattern. One `PlanGenerator.HISTORY_DAYS` (35) is used by the generator's history window and the panel.
- **16 h preference retired on My preferences**: 8 h and 12 h only; a 16 h wish saved earlier shows checked but "no longer offered" (screen-reader name "16 h, no longer offered"); `allowedLengths` is now `[8, 12]`, and the API still accepts a stored 16 back so saving other changes works.
- **Web container:** `POST /api/v1/planner/drafts` gets a 180 s proxy read timeout (other routes stay at 60 s). Generate on Dataset 150 measured 4.7–6.0 s warm and 5.9 s on a freshly restarted api, at host load about 20. A non-planner on `/planner` no longer fires planner requests that answer 403.

**No migration, no generator change.** Measured on the branch: Dataset 120 plan fingerprint `e8b29ce6…9d31` (38 gaps, 7 warnings), Dataset 150 `a1e093f7…b381` (100 gaps), checksums 120 `82b19cf8…32ca` and 150 `2e6cd938…d7f8`, all as before.

**Counts on the branch (at `421627a`, the review-fix tip, before main's PR-O was merged in; after the merge the web suite is **567** in 56 files, all green):** web unit tests **548** in 55 files, lint 4 warnings and 0 errors, `tsc -b` clean. API: `PlanInputsApiTest` (4 tests), `PlanInputsNeededTest` (3, the floor's stretch and its tie-break) plus `PlanDraftEditApiTest`, `PlannerApiTest`, `GeneratorCharacterizationTest`, `Demo150ResetApiTest` and the unit tests (27 tests) green locally, with the full `mvn verify` in CI on the PR. Playwright against the real API, a fresh stack per viewport: desktop **126 passed**; tablet **125 passed and 1 skipped**. That tablet run used `E2E_WORKERS=1`: a two-worker run on a host at load about 30 lost four supervisor-board tests to Chromium "Target crashed" and timeouts. Fixtures (all four projects): **45 passed, 159 skipped**, no failures. That run was the third: two earlier runs, made while this branch's own stack was still up, lost one or two different unrelated tests to crashes and timeouts.

**PR-N: plan options for the quarter plan.** The owner asked for "options to tailor the quarter plan. It really is a black box."

- **Plan options** (PR-N): **Generate draft** and **Generate again** offer three options, each with one plain sentence that says what it does and what it costs. **Staff to include**: full-time officers are always in; part-time and casual officers (below 1.0 FTE) can be left out. **Part-time fill**: *Fill gaps only (as before)*, or *Fill up to each officer's FTE*, which, after the gaps, gives each part-time officer shifts above the minimum in their home unit where cover is thinnest, up to FTE × 80 h per pay period, spread through the period. **Other units**: *Cover gaps from other units* offers each gap left after the home-unit fills to officers from another unit who hold the block's qualification and have hours left under FTE × 80 h, through the same rule check, before the up-to-FTE extras; the roster marks them **From** their unit and a scorecard line counts the gaps covered. The API validates the options (`400` problem detail naming the field), stores them on the draft (V14, V15) and returns `options` with every draft summary. The draft shows "Made with: …", Generate again is filled in from the last draft, and after a replace a line compares every figure with the previous draft.
- **Measured** (seed 20261001; the full table, with what stays short and why, is in the planner guide §1): Dataset 150: defaults 100 gaps / 39 warnings / 3,515 h unused; *Fill up to FTE* 100 / 51 / 496 h; *Cover gaps from other units* 72 / 59 / 3,337 h (28 gaps covered by 41 shifts from 26 officers); both 72 / 71 / 496 h; full-time only 687 / 5. Dataset 120: defaults 38 / 7 / 5,472 h; *Fill up to FTE* 38 / 17 / 260 h; *Cover gaps from other units* covers none, because all 38 gaps are Escort evenings and no free officer elsewhere holds Escort. Dataset 100 has no part-time officers.
- **Why gaps are still short** (round 3): under the gaps-covered line the scorecard says "Still short: 46 not qualified · 14 no hours left · 12 would break a rule. Most are Escort & transport evenings (16), Control evenings (14), Unit B evenings (11)." (Dataset 150), and when nothing could be covered, why: "No gap could be covered from another unit: no free officer in another unit holds the post's qualification." with "Still short: 38 not qualified. Most are Escort & transport evenings (38)." (Dataset 120). A borrowed 12 h shift needs the qualification of every block it covers; a gap no borrowed shift can cover is "no shift that fits", not "no hours left". The Plan inputs card follows the Generate form (`GET /planner/inputs` takes the options) and a full-time-only plan counts only full-time officers.
- **Not built, and why**: *units to plan* (the quarter commits once, so a partial-unit plan would lock the other units out); *honour preferences on/off* (built, measured, removed: no scorecard figure moved on any dataset, though Dataset 100's roster did change who works days or evenings); part-time and casual relief as separate choices (the data does not tell them apart). See `docs/process/ai-dev-log.md` #116, #118 and #119.

**Defaults unchanged:** with the options omitted or sent at their defaults, the 100/120/150 plan fingerprints, warning totals and row counts are identical (`GeneratorCharacterizationTest` generates both ways). Dataset checksums and the payroll golden are unchanged. Commit, the rules and payroll are untouched; the live planning board's payload is unchanged (the `homeUnit` marker is sent only on the draft roster).

**PR-N counts** (author run, 24 Nov 2026, round 3, with PR-O and PR-M merged in; reproduced exactly by the release walk below): API **503 = 127 rules + 28 infrastructure + 348 api** (GitHub CI `mvn verify`); web unit tests **583** in 57 files, lint 4 warnings and 0 errors, `tsc -b` clean; Playwright against the real API, a fresh stack per viewport (`E2E_WORKERS=1`): `desktop-datasets` **129 passed**, `tablet-datasets` **128 passed and 1 skipped** (the TV-size check is desktop-only), 0 failed.

**Release walk** (24 Nov 2026, `main` at `958209c`, installed with `install.sh` on its own stack): demo script §1–6 on a fresh stack and again after **Reset the demo data**, and §7 on its own reset stack, came out as written (every quote, figure, status code, DB row and audit row; the payroll CSV's sha equals the golden file; no names on the wall display; 0 console, CSP or 5xx errors). The quarter plan's headline, Plan inputs, Generate options and the planning-board shift dialog matched SQL on Datasets 120 and 150. All four suites reproduced the PR-N counts above with 1 worker. One major defect blocked the tag (D1, below), with five smaller findings; PR-Q fixes all six.

**PR-Q: the walk's fixes.**
- **D1, staffing shortfall never shown** (since Release 3): the api's staffing rows and totals send `shortfall` and the web read `short`, so the Quarter plan's **Staffing by unit** panel and the **Needed (at least)** tile always said "Short 0" and "Every unit meets the floor", under a headline of "112 FTE against about 127 needed". The web now reads `shortfall` (the documented contract, `docs/07-api-spec.md`); the api is unchanged. Headline, panel and tile now agree: Dataset 120 "112 FTE against about 127 needed", tile **127 · Short · 120 on staff · short 7**, panel "Yes, at least 7 more: Admissions (1), Unit B (1), Unit C (2), Escort & transport (3)"; Dataset 150 "138 FTE against about 127 needed", tile **127 · Meets the floor · 150 on staff**; Dataset 100 "100 FTE against about 123 needed", tile **123 · Short · 100 on staff · short 23** (Unit A 7, Admissions 1, Unit B 7, Unit C 6, Escort & transport 2). A real `/planner/staffing` answer is now a contract sample (`contract-samples/planner-staffing.json`, Dataset 120), and `planner-inputs.spec.ts` checks the three against the live api on each dataset.
- **D2, release prep:** `install.sh` `DEFAULT_REF="v1.2"` and the README and INSTALL one-liners fetch the `v1.2` installer; a note in both says the course submission is `v1.1.2-submission`. Counts refreshed in the README and `web/README.md`.
- **D3:** the top bar shows the business clock's time with the demo day ("Thu 19 Nov 2026 · 12:00", the same noon the shift dialog and the api use), not the wall clock.
- **D4:** after a reset started from another session, the sign-in picker retries `/auth/demo-users` on its own after the `409` (1 s, 2 s, 4 s, then every 5 s, about 1.5 minutes), and offers **Retry** if the users still cannot be loaded.
- **D5:** after **Confirm** on the Overtime board the open shifts are fetched again; the confirmed card stays selected in its place and reads **Filled**, not "Offers sent".
- **D6:** the Time & attendance record panel's subtitle names the day in words ("Tue 17 Nov 2026 · N8 · scheduled 23:00 – 07:00"); the Move dialog's native date input is unchanged.

No api, migration, generator or rules change: dataset checksums, the payroll golden and the plan fingerprints are unchanged.

**Release step:** after merge, tag the merge commit `v1.2` and push the tag, then run `scripts/check-install-pin.sh --remote` and the README one-liner once from an empty directory (free port, own `SHIFTCIRCLE_PROJECT`).

**Counts at v1.2** (PR-Q's head, 24 Nov 2026): API **503 = 127 rules + 28 infrastructure + 348 api** (unchanged; PR-Q changes no api code; `UnitApiTest` and `PlanInputsApiTest` re-run green); web unit tests **591** in 58 files (+8: the staffing contract sample ×3, the top-bar clock, the sign-in retry ×2, the open-shift order ×2; the T&A subtitle and Overtime confirm assertions extend existing tests), lint 4 warnings and 0 errors, `tsc -b` clean; Playwright against the real API, a fresh stack per viewport (`E2E_WORKERS=1`): `desktop-datasets` **132 passed**, `tablet-datasets` **131 passed and 1 skipped**, 0 failed (+3 each: headline, panel and tile on Datasets 100, 120 and 150). The demo script §1–7 was walked again with the release walk's harness on PR-Q's stack: same results, apart from the harness's known misses (its expected commit hash, the §3 "no refresh" check Playwright cannot perform, and two §7 wording checks).

## Release v1.3: supervisors get their own rostered shifts

The owner approved the plan in `.factory/plans/v1.2-supervisors.md` (the plan file still says v1.2; the
release was split afterwards, so it is v1.3 here). The work is eight small pull requests, **S1 to S8**;
this entry covers **S1** to **S4**. The plan is not in the repository, so this section is the record of what
these pull requests did.

### S1 — Positions and the SUPERVISION kind (API, schema only)

**What it does.** An officer's **position** (rank) becomes a reference row instead of a free-text
column, and a **supervisor post** becomes a unit of its own kind. Nothing about the demo changes yet:
there are still no supervisor posts and no supervisors in the datasets, so the demo behaves exactly as
it did.

**The migration (`positions`).** The file is `__positions.sql`; its version number is the order it
merges in, so it takes the next free number when it merges.
- The `position` table (`code` PK, `name`, `rank_order`, `is_supervisory`) with two rows: `CO`
  Correctional officer (1, not supervisory) and `CS` Correctional supervisor (2, supervisory). A new
  rank is a **row**, and a code change with it: the api knows two ranks, and a rank it does not
  know is treated as the lowest, non-supervisory one.
- `employee.classification` keeps its name and becomes a foreign key to `position(code)`, so an
  unknown code is refused by the database (`23503`). Every existing officer is a `CO`, so no data
  moved.
- `employee.position_since` (date, null): **seniority within the rank**. It is null for an officer
  who is already in their rank, so seniority inside a rank is `coalesce(position_since,
  seniority_date)` and every officer ordering is unchanged. It cannot be earlier than
  `seniority_date`; "not in the future" is the writing service's job, because a check constraint
  cannot read the clock.
- `unit.kind` accepts `SUPERVISION`: a supervisor post is a unit with its own `unit_requirement`
  rows, so the board, coverage, gaps, publishing and payroll need no new code.
- `unit_supervision(supervision_unit_id, unit_id)`: which line units a post covers. A trigger
  refuses a row whose parent is not a `SUPERVISION` unit, and a row whose child is one, so a post
  cannot cover another post (`23514`). A second trigger refuses a change to a unit's `kind` while
  a link points at it, so a post cannot quietly stop being a post.
- The `ACTING_SUP` qualification row, on the existing `employee_qualification` table.

**The API.** The `Position` enum (`CO`/`CS`, with `isSupervisory()`) joins `shiftcircle-domain`.
`PlanGenerator.Employee` gains `position` and `rankSeniority`, `PlanGenerator.Unit` gains `kind` and
an `isSupervision()` helper; the older constructors are kept, so every existing call site still
compiles. `loadEmployees` reads the classification and `position_since`, `loadUnits` reads the kind,
`MyScheduleQuery` and `GET /me` name the position in words (`Correctional officer`, `Correctional
supervisor`). A rank the api does not know is looked up as nothing and falls back to the lowest,
non-supervisory rank, so a new rank in the table can never stop the planner or make it treat
someone as a supervisor by accident.

**No pin moves.** No unit and no employee row changes, so the dataset checksums (100, 120, 150), the
three plan fingerprints and the payroll golden are unchanged: `GeneratorCharacterizationTest` is
green with no edits, and the demo reset tests still read the same checksums.

**Counts at this gate:** API **517 = 127 rules + 36 infrastructure + 354 api** (`mvn verify` on the
pull request, `BUILD SUCCESS`, 0 failures, errors or skipped); web unit tests **591** in 58 files,
lint 0 errors, `tsc -b` clean, build clean; `check-ignored-sources.sh` OK and
`check-audit-codes.sh` still 50 codes. Playwright against the real API, a fresh stack per viewport:
desktop **132 passed**, tablet **131 passed and 1 skipped** (the TV-size check runs on desktop only).
The branch carries v1.2 (`main` at `f681ae7`), so the positions migration is **V16**, after the
quarter-plan options migrations V14 and V15.

**Two things later releases still owe:** the captured contract samples
(`web/src/api/contract-samples/`) do not carry the new `position` field yet — they are re-captured
in S7 with the rest of the samples — and this migration must merge **after** the quarter-plan
options migration (PR #24), which owns the versions before it.

### S2 — Who can work a post: the `POSTS` rule table, R-01/R-02 and rule set v4 (API + rules screen)

Stacked on S1 (#27). The owner approved the plan's cross-cover answer, and S2 makes it a rule a rules
admin can change, not a hard-coded check.

**What it does.**
- **R-01 — a supervisor post needs a supervisor.** An officer on a supervisor post is **blocked
  with no override** (the panel offers no override). An officer who holds the **Acting supervisor**
  qualification (`ACTING_SUP`) on the shift's date gets a **warning to acknowledge** instead.
- **R-02 — a supervisor on an officer post** is a **warning to acknowledge**; the shift counts
  toward the unit minimum.
- A supervisor on a supervisor post and an officer on an officer post are unaffected. Every other
  rule applies to supervisors as written.

**The migration (`V18__rule_set_v4_posts.sql`, the next free number when it merged, after P1's V17 proposals).** A ninth rule table,
`POSTS` "Who can work a post" (template `post-eligibility.drt`; columns `postKind` =
`SUPERVISION`/`LINE`, `allowedPositions`, `actingQualification`), and **rule set v4** by the same
baseline-seeding exception as v2 and v3: v3 becomes history, its 20 rows are copied unchanged, and
R-01 (Block, override NONE) and R-02 (Warn, ACKNOWLEDGE) are added, both marked placeholder with the
source "Owner item 17". The published v4 equals the code rows (`RuleRowsV1`, checked by
`ReferenceDataMatchesRuleRowsTest`).

**The engine.** `RuleTableCode.POSTS`, a `PostEligibilityFact` and its builder (built for the
proposed shift only, from the person's position, the qualifications they hold that day and the
unit's kind; `ShiftFact` and the other builders are untouched), the template columns (every value is
a checked code before it reaches the DRL), the publish-time validator (a known post kind, known
positions, not every position at once, a qualification code or nothing) and the plain-language
`RuleSentence`. R-01 and R-02 are Must rows from v4 on, so a draft cannot drop them or change their
override policy.

**Where it runs.** `RuleCheckService` looks up the position, qualifications and unit kind for every
board check (assign, move, overtime candidates) and passes them to the engine. The planner's
generator check, its regenerate check and its commit check pass the same from a lookup read once per
run; the planner's draft add/move check passes it too. There are no supervisors or supervisor posts
in the datasets yet, so neither rule fires on the demo data.

**The rules screen.** A ninth tab, **Who can work a post** (`/rules/{version}/posts`), with its own
columns: the post (fixed by the unit's kind), who can work it (Supervisors or Officers), and for a
supervisor post whether an acting supervisor may work it with a warning, then the result, override
and source. The sentence under the grid updates as the admin edits, word for word the api's. It is
edited through the existing draft → build → submit → approve → publish flow.

**API.** No new endpoint or request field. `GET /rule-sets/{v}/tables/posts` (or `POSTS`) returns
the table with the column headings `Post`, `Who can work it`, `If someone else`, `Override`, and a
rule check can now return results with `ruleTable: "POSTS"` (docs/07 §3, §4.7).

**No pin moves except the rule-set version.** The live rule set is now **v4** (v3 → SUPERSEDED);
the dataset checksums (100, 120, 150), the three plan fingerprints, rows and warnings and the payroll
golden are unchanged (`GeneratorCharacterizationTest` and the demo reset tests are green with no
edits). Tests that pinned "v3 is the published version" or used version numbers 4/5 for fixtures now
say v3 is history and use 5/6.

**Counts at this gate:** API **512 = 138 rules + 36 infrastructure + 338 api** (`mvn verify` through
the compose `api-test` stage, `BUILD SUCCESS`, 0 failures, errors or skipped); web unit tests **576**
in 56 files, lint 0 errors, `tsc -b` clean, build clean. Playwright: see the pull request.

**The review round (S2).** The code review asked for changes (1 must, 2 should, 4 nits), the
security review passed (3 low, 3 info) and the UI test found 1 major and 2 minor defects. All of
them are fixed in one push:
- **The dry run sees the posts table (UI test D1, major).** The build's dry run now builds the post
  fact (position, qualifications on the date, unit kind) for every shift on the published roster.
  Before, it reported "No rule result changes" for any POSTS edit, so an approver could publish
  "only supervisors on an officer post" and every officer then got an R-02 warning.
  `PostsMakerCheckerApiTest` proves that a POSTS edit's dry run reports the change (R-01 Warn → Block
  for an acting officer already on the post).
- **The build says why it failed, and the Must rows are locked (D2).** The checklist lists the
  build's `errors`. On every table, a Must rule's On, result and Override controls are locked (the
  rows carry `must`), and the build refuses a change to a Must rule's result or on/off as it already
  refused a change to its override policy (security info I2).
- **R-01 can only be softened by Acting supervisor (security L1).** `actingQualification` must be
  `ACTING_SUP` or empty: the validator and the column schema refuse any other code, so a maker and a
  checker cannot hand the warning to everyone with a common qualification.
- **The planner's post lookup fails closed (L2).** A person or unit it cannot resolve reads as an
  unknown position on a supervisor post, which R-01 blocks; the no-post overload is documented as a
  replay-only seam.
- **V18 builds on whichever version is published** instead of naming v3, and stops if there is not
  exactly one (info I1). A fresh database still gets v4 = v3 + R-01/R-02.
- **Tests.** The maker/checker flow has its own class and database, so no test depends on method
  order. `PlannerPostEligibilityApiTest` adds a test supervisor post and closes Unit C, so Unit C's
  officers form the relief pool. Generate places only the acting officer on the post and leaves the
  rest a gap; a draft-edit preview is R-01 Block for an officer and Warn for the acting one; the save
  is refused; a commit with an officer on the post fails with R-01 and writes nothing. A board save
  with an emergency reason is still refused for R-01 (L3).
- **Docs.** The demo script follows a fresh stack: §4 goes **v4 → v5** ("Version 5 is live now.",
  "Live v5 · no draft"), the rehearsal note says §4 publishes v5, and v4 joins the
  migration-published baselines. The README and INSTALL `/version` samples read v4. The "v4 seed"
  wording in docs/05 and the roadmap now says the next version after v4, and docs/ui lists 9 tables
  and the posts columns.
- **Counts after the round:** API **516 = 140 rules + 36 infrastructure + 340 api** (`mvn verify`
  through the compose `api-test` stage, `BUILD SUCCESS`); web unit tests **578** in 56 files, lint 0
  errors, `tsc -b` and build clean. Playwright: see the pull request.

### S3 — The rank-aware planner (API)

Stacked on S2 (#29), with main (the quarter-plan options, PR #24) merged in. The owner approved the
plan's answers: the planner never cross-covers, supervisors get their own scorecard card, and
seniority is counted inside the rank. There are still no supervisors or supervisor posts in the
datasets (S4 adds them), so **no pin moves**.

**What it does.**
- **The planner never cross-covers.** Every placement pass offers a supervisor only a supervisor
  post (a `SUPERVISION` unit) and an officer only an officer post: the home-unit fill, the casual
  pool, closed-unit relief, the cross-unit fill (*Cover gaps from other units*, PR-N) and the
  part-time top-up (*Fill up to FTE*). The guard sits before the rule check, so the engine is never
  even asked about a cross-rank proposal, and R-01/R-02 never fire on a generated row. Cross-cover
  stays a person's decision on the board or in a draft edit, where R-01/R-02 apply. S2's planner test
  changes with it: the acting officer is no longer placed on the test post by relief, so the whole
  post is a gap.
- **Seniority inside the rank.** The planner's seniority sort, the night order (volunteers most
  senior first, then the newest), the 8 h block choice, the casual, relief, cross-unit and top-up
  orders and the night-fairness card read `rankSeniority` = `coalesce(position_since,
  seniority_date)`. For an officer that is the service date, so every officer ordering is unchanged.
- **The scorecard.** Every existing card counts the officers and the officer units only. A new
  `supervisors` card (only when there is a supervisor or a supervisor post) gives the posts covered
  *x* of *y* block-days, gaps, warnings, preferences, nights by rank seniority, overtime, hours by
  FTE band and leave. `totals` counts everyone with the split ("5,103 officer + 1,170 supervisor
  shifts"): shifts and people by rank, warnings by the post they were raised on.
- **Generate, compare and commit views.** The commit preview adds `supervisors`, `officerShifts`
  and `supervisorShifts` (`officers` is now officers only); the commit result adds the two shift
  counts and the `commit_plan` audit adds `supervisors`; compare counts officers only and, once a
  supervisor or a post exists, adds Officer shifts, Supervisor shifts and Supervisors scheduled.
- **Plan inputs** gain the position dimension: `officers.byPosition` (CO and CS), `lineUnits`,
  `posts` and a `headline` ("150 officers + 12 supervisors in 6 units + 2 supervisor posts"); unit
  rows carry `kind`, groups carry `position`. The web card shows the split in S7.
- **A supervisor post can't be closed.** `UnitsService` answers 409 "Supervisor posts can't be
  closed; change the minimum instead" on the closure preview, add and change: closing one would
  send its supervisors into the relief pool.

**Tests.** `PlanGeneratorSupervisorTest` (6): a synthetic centre with two posts and ten supervisors
beside two officer units, an officer unit and a post each closed for a week, every option on: no
cross-rank placement or check in any pass; R-01/R-02 never fire; the officers' plan, gaps and every
officer card are identical with and without the supervisors; the supervisor card and totals are
exact (567 post block-days); a supervisor mis-homed on an officer unit is never placed there; and
seniority inside the rank orders the pool. A mutation run (guard removed) fails 5 of the 6.
`PlannerSupervisorApiTest` (3) adds a post and four supervisors to Dataset 100: plan inputs split,
the draft keeps each rank on its own posts, and the scorecard, commit preview, compare and commit
carry the split. `UnitApiTest` (+1): closing a supervisor post is a 409 and writes nothing.
`GeneratorCharacterizationTest` is green with no edits.

**The review round (S3).** The review approved (0 must, 2 should, 6 nits) and security passed (0
findings); fixed in one push:
- **The Audit log names the supervisors** a committed plan wrote ("6,273 shifts written · 107
  officers · 10 supervisors · …"), only when there are any, so today's line is unchanged.
- **The plan inputs fill order says each rank stays on its own posts**: officers fill officer
  posts and supervisors fill supervisor posts in every step, and the last step no longer calls a
  gap "a gap for a supervisor" but one left for a person to fill on the board.
- **The supervisor card counts only the blocks a post has a minimum for**, so a post with no night
  minimum is not "covered" on nights; the API test pins `coveredBlockDays`.
- **Tests:** the mis-homed-supervisor test also asserts they are placed (on the posts); the fixture's
  supervisors are promoted after they joined, as the schema requires; changing a closure that
  reached a supervisor post another way is a 409 and writes nothing.

**Counts at this gate** (GitHub CI on the pull request, with main's PR-Q merged in): API **549 = 140
rules + 36 infrastructure + 373 api** (`mvn verify`, 0 failures, errors or skipped); web unit tests
**602** in 58 files, lint, `tsc -b` and build clean; check scripts pass. No web change, so Playwright
was not re-run.

**Not in this release** (the rest of the plan):
the supervisor posts and the demo supervisors in the datasets with the
single re-pin (S4), the overtime pools and the self-edit guard (S5), and the board, My schedule,
display and reports work (S6, S7).

### S4 — Supervisor posts in the datasets, the demo supervisors linked, the single re-pin (API)

Stacked on S3 (#32). Owner answers Q2 (two area posts, 1 per block, 24/7; both demo supervisors get
both posts) and Q6 (Dataset 100 gets supervisors and is re-pinned once).

**What it does.**
- **V19 `supervision_posts`** (the next free number: V16 positions, V17 proposals, V18 the posts rule set): units **SUP-L**
  "Supervision · Living units" (covers A, B, C) and **SUP-O** "Supervision · Operations" (covers
  ADM, CTL, ESC), fixed ids `…-000000000007/8`, `allows_12h`; requirements 1/1/1 each from 1 Oct
  2026; the six `unit_supervision` links; scope rows giving m.ellis and j.chen both posts (their
  officer-unit scope is unchanged).
- **Dataset 100**: 10 supervisors `S-001…S-010` (`CS`, five per post, service 2004–2014,
  `position_since` 2018–2025) on 8 h D8/E8/N8 shifts from the same roster walk; 2% sick + 2%
  vacation; their sick calls become open shifts offered to the other supervisors only; their
  actuals and pay codes; SUP schedule periods. All of it comes **after** every officer row and from
  its own `Random(seed ^ 0x509)`, so no officer draw moves. M. Ellis = S-001 Morgan Ellis (SUP-L),
  J. Chen = S-006 Jamie Chen (SUP-O), both linked.
- **Datasets 120/150** (`DemoSupervisorCrews`): per post 2 D12 + 2 N12 4-on/4-off crew supervisors
  and one relief (N12 relief on SUP-L, D12 relief on SUP-O), numbered `120-S001…` with their own
  ids, names and history; 150 adds a D8 5-on/2-off day supervisor (SUP-L), a 0.6 FTE `CASUAL_12`
  part-timer (SUP-O), the 20% leave placement from `Random(150_2026 ^ 0x509)` and M. Ellis's
  vacation week 8–14 Feb 2027. Ellis and Chen are the first SUP-L/SUP-O day supervisors.
- **Self-checks**: the 100 self-check's overtime band, skew, PC-07 and PC-09 read the officers
  only, and a new supervisor check asserts 10 supervisors, no cross-rank shift, ≥ 97.5% of post
  hour-slots covered and both sign-ins linked; the 120/150 providers check the head count, no
  cross-rank shift, every post hour of the history covered and both links.
- **The overtime list stays inside the post's rank** (Q4's pool rule, the part S4 needs): with
  supervisors in scope, an officer post's ranked list would otherwise have led with supervisors
  (no overtime, senior service). An officer post lists officers and a supervisor post lists
  supervisors; the §3 list is unchanged (36: 18 / 10 / 8). S5 adds acting officers, rank seniority
  and the self-offer guard.
- **My schedule's overtime rank is counted inside the person's rank**, for the same reason: an
  officer's "Rank n of 100 on the overtime list" is unchanged, and a supervisor's reads "of 10".
- **The supervisors' self-edit guard (owner answer Q3), brought forward from S5** after the security
  gate showed j.chen recording 14 h on their own 8 h shift (`PUT /time-entries`, 200). Linking the
  two demo supervisors inside their own scope made it reachable. Every supervisor write path on a
  shift, time entry, absence, overtime offer or confirm and override now answers 403 "You can't
  change your own schedule; ask another supervisor." on the caller's own record
  (`SelfActionGuard.requireNotOwnSchedule`): `POST /assignments` (override included), `PATCH` and
  `DELETE /assignments/{id}` (the shift moved and the person it moves to), `PUT` and
  `DELETE /time-entries/{id}`, `POST /absences`, `POST /open-shifts/{id}/offers` (every listed
  employee, before anything is written), `POST /open-shifts/{id}/assign` and
  `POST /offers/{id}/confirm`. Accepting or declining one's own offer on My schedule is unchanged.
  Proposal decisions already used the same guard (P2). S5 is left with the overtime pools.
  The re-check round dropped "or the planner" from the message (a planner can't write the live
  board, so only another supervisor can do these), and docs/07 lists the 403 on each endpoint and
  its place in the order of checks (after the body, before `If-Match`; before the reason for a
  cancel).
- **Compare and the commit links name the posts** ("Supervision · Living units coverage gaps", not
  "SUP-L coverage gaps"); the cross-unit "still short" line keeps the posts' full names.
- **`DemoChecksum.officersOnly` / `officersOnlyWithNames`**: the checksum over the officers' shifts
  and the officer units' periods (with the officers' names for 120/150).

**Pins (moved once).** Checksums 100 `beb2e222…b7d1`, 120 `ca73467d…a64a`, 150 `353e2e62…91a5`;
plan fingerprints `94aeae1f…`, `5a3763c7…`, `7368ef13…`; rows 7,266 / 5,595 / 5,877; scorecard
(officer) warnings 135 / 7 / 39, all warnings 155 / 7 / 41; supervisor-post gaps 230 / 0 / 93 of
588 block-days; payroll golden 1,124 lines `b946ef1f…00e6`. **Officer-only proof**
(`GeneratorCharacterizationTest`): the officers' checksums, plan fingerprints, rows and warnings
equal the pre-S4 pins (`4156077d…`, `82b19cf8…`, `2e6cd938…`; `ec337014…`, `e8b29ce6…`,
`a1e093f7…`; 6,586 / 5,103 / 5,414; 135 / 7 / 39), and the golden's first 1,038 lines are the old
file byte for byte (`9f2d51b3…04ff`) with only `S-…` rows after them. Dataset 100's planner puts no
8 h staff on nights, so all 196 of its supervisor-post night block-days are short in the plan
quarter (230 short in all, the other ~34 days and evenings where leave is not backfilled), as the
8 h officers' nights are; giving some supervisors a 12 h preference was measured and left more short (286).

**Visible changes before S6/S7.** M. Ellis and J. Chen get **Employee view** with their own
supervisor schedule (header "Correctional supervisor"). The unit pickers, the reports and Compare
list SUP-L and SUP-O like any unit. The wall display keeps its six unit tiles (eight do not fit a
TV); the posts get their own counts-only strip in S7. The Plan inputs headline counts
everyone ("Planning 130 officers in 8 units" on 120) and the commit dialog says "5,595 shifts for
107 officers" until S7 words the split; the audit line reads "5,595 shifts written · 107 officers ·
10 supervisors · 7 warnings accepted · across 8 units".

**Tests.** `GeneratorCharacterizationTest` re-pinned plus the officer-only invariance for all three
datasets and the payroll prefix; `DemoResetApiTest`, `Demo120ResetApiTest`, `Demo150ResetApiTest`,
`DemoResetFailureTest` re-pinned with per-classification counts and the supervisor composition;
new `SupervisorDatasetsApiTest` (3: My schedule 200 for both on 100/120/150, posts/links/scopes,
the rank-bound overtime list); `DemoDataGeneratorTest` (+2: officers unchanged, supervisors on
their posts on 8 h with offers inside the rank); `SchemaConstraintsTest` (V19 counts). e2e:
`reset*.spec.ts` (new 100 checksum), `session-and-nav.spec.ts` (Employee view for the supervisors),
`planner-inputs.spec.ts` (headline and staffing totals).

**Counts at this gate** (author run, `76fd79d`: S4 with origin/sc-s3 merged in, which brings main's
S1 #27 and P1 #26; own compose projects `sc-s4` and `sc-s4-e2e`): API **584 = 140 rules + 38
infrastructure + 406 api** (`docker compose --profile test run --rm --build api-test`, `mvn verify`,
BUILD SUCCESS, 0 failures, errors or skipped); web unit tests **603** in 58 files, lint 0 errors
(4 warnings), `tsc -b` and build clean; check scripts pass; Playwright against the real API, a fresh
stack per viewport: desktop-datasets **132 passed**, tablet-datasets **131 passed and 1 skipped**
(the TV-size check runs on desktop only). Demo §1–6 and §7 figures re-read on the real API (see
`docs/demo-script.md`); M. Ellis and J. Chen open Employee view → My schedule with their own shifts
in a browser.

**Counts after the review round** (`c4d3963`: the self-edit guard, the posts named in Compare, the
docs fixes, with main merged in, which brings S3 #32 and P3 #33): API **611 = 140 rules + 38
infrastructure + 433 api** (GitHub CI `mvn verify` on the pull request's merge with main, 0
failures, errors or skipped; `SelfEditGuardApiTest` +3); web unit tests **632** in 61 files, lint 0
errors (4 warnings), `tsc -b` and build clean; Playwright against the real API, a fresh stack per
viewport: desktop-datasets **134 passed**, tablet-datasets **133 passed and 1 skipped**.

### Shift proposals, P1: the officer API

The first of five proposal PRs (P1 to P5; plan `v1.2-proposals`, owner answers Q1 to Q5 approved). **P1 is the API for the officer side only; there is no screen yet.** An officer can preview a multi-item proposal (each item rule-checked with the earlier items as extra facts, so rest between two drafts shows), send it (a Block can't be sent, a Warn can), list their own proposals, and withdraw one while every item still waits. A waiting item expires when its shift starts, on every read and withdraw and by an hourly sweep. Nothing creates a shift: the inbox and the decision are P2, so until then a sent proposal stays Waiting and then Expires.

- **Migration V17** (the next free number when it merged, after S1's V16; the v1.3 rule is that a migration takes the next free number at the moment it merges) reshapes the unused V1 `proposal` and `proposal_item` tables in place (status and decision sets, decider, comment, snapshots, a note-length check, a decline-needs-a-comment check, an ADD-needs-the-whole-shift check, and a unique index so one officer can't have the same shift waiting twice). Within the same file, `proposal.seq` gives "newest first" a deterministic order under the frozen demo clock, `proposal_item.work_date` is `NOT NULL`, and `proposal_item (proposal_id)` is indexed.
- **Audit:** three new action codes, `submit_proposal`, `withdraw_proposal` and `expire_proposal_item`, and one entity type, `proposal`; the web labels and `check-audit-codes.sh` agree (**54** codes, was 50: the script counts actions and entity types together). `decide_proposal_item` follows in P2, which makes the release total **55**, not the plan's 54: P5 and the final README must quote 55.
- **`SelfActionGuard`** (`ca.shiftcircle.api.security`) is the shared "not your own record" predicate. P2's decision endpoint and the supervisors' S5 self-edit guard use it, so neither feature owns it. S5 must reuse `SelfActionGuard` (not add a second guard class) so the two cannot drift. P1 only adds it and its unit test.
- **`RuleCheckService`** gains `evaluateWithExtras(change, extraShifts, snapshot)` and `factOf(change, id)`; the existing overloads are unchanged. (The plan called this an `evaluate(change, extraFacts)` overload, but that signature is already the planner seam.)
- **Review fixes:** withdraw is atomic against expiry (items first, same order as expiry; fewer rows changed than the proposal has items rolls back as a 409, and the proposal update is conditional on status and version). Request paths expire only the caller's own items; the hourly sweep does the global pass in id order with `SKIP LOCKED`. `evaluateWithExtras` drops an extra that already matches a stored shift, so a decision that inserts earlier items before checking later ones can't count them twice. Per-officer limits per minute: 60 previews, 10 sends, 10 withdraws, then `429 rate-limited` (in memory, per API instance).
- Scope and limits: the proposer is always the caller (an `employeeId` in the body is a 400), at most 10 items per proposal and 20 waiting per officer, dates from now to 11 Apr 2027, any active unit.
- **Pins:** no dataset checksum, payroll golden or plan fingerprint reads the new columns; none moved.

Tests: +30 API (27 in `ProposalApiTest`, 3 in `SelfActionGuardTest`). Web: the audit labels only. Counts for the whole release are measured once at the end of v1.3.

### Shift proposals, P2: the decider API

The second proposal PR (stacked on P1, PR #26). **P2 is the API for the decider side; there is no screen yet** (the inbox is P4). A supervisor sees the proposals with an item on their units, and the planner sees all of them, so Unit C and a supervisor's own proposal always have a decider. The detail shows each item's rule result as sent and as of now, the overtime it would add in its pay period, and the open shift it matches with the officer's place in the overtime order. Approving re-runs the board's rule check at decision time and creates an `EXTRA` / `PROPOSAL` shift; declining needs a comment the officer then sees.

- **Endpoints** (`docs/07 §4.4`): `GET /proposals?status=WAITING|ALL&unitId=&from=&to=`, `GET /proposals/count`, `GET /proposals/{id}`, `POST /proposals/{id}/decision` (`If-Match`), all `SUPERVISOR` or `PLANNER`.
- **Decision rules:** every accepted item is checked again, in start order, with the items accepted earlier in the same send as extra facts and before any is saved (the `evaluateWithExtras` contract from the P1 review, so nothing is counted twice). A Block is `422` and nothing is saved, with no override (Q3). A Warn needs the current codes acknowledged. Approving someone who is not first in the O-01/O-02 overtime order for a matching open shift needs `acknowledgeOutOfOrder` and is stored and audited (Q1). A matched open shift is filled and its waiting (`OFFERED`) offers are withdrawn; an `ACCEPTED` offer is left for the confirm to refuse. A locked pay period, a closed unit, an expired, withdrawn or already-decided item are `409`.
- **Who decides:** `SelfActionGuard` (from P1) refuses your own proposal with `403`, and a supervisor needs the item's unit in scope (`403` for an item outside it in a proposal you can see, `404` for a proposal you can't). The planner decides any item; this is the first place `PLANNER` writes a `shift_assignment` outside a plan commit.
- **`AssignmentWriter`** (`ca.shiftcircle.api.assignments`) is the one write path for a new shift: the rule decision (Warn acknowledgement, Block override where allowed), the insert and the `assign_shift` audit row. `AssignmentService.assign` (the board and, through it, the overtime confirm and direct assign) and the proposal decision call it; `move` uses its `decide`. Board and overtime behaviour is unchanged: their existing test classes pass unchanged. Proposals call it with the override refused and `source = 'PROPOSAL'`.
- **`OvertimeService.orderPosition`** reuses the candidate ranking (extracted, not changed) for the officer's place in the order.
- **Audit:** one new action code, `decide_proposal_item` (entity `proposal`, one row per item, with the comment, acknowledged codes, `outOfOvertimeOrder`, the outcome now and the assignment id); the web label and `check-audit-codes.sh` agree (**55** codes).
- **Post rules (S2):** the decision re-check goes through `RuleCheckService.evaluateWithExtras`, which runs R-01/R-02 with the officer's post, so a proposal approval refuses an officer on a supervisor post (R-01 Block, no override) exactly as the board does.
- **No migration:** V17 (P1) already holds every column P2 writes. **Pins:** no dataset checksum, payroll golden or plan fingerprint moved.

- **Review fixes (round 1):** the decision is atomic against a concurrent expiry or withdraw: the item rows are locked (`FOR UPDATE`; the hourly sweep skips locked rows), every item update must change exactly one row, and the proposal's version update is conditional, so anything that changed underneath rolls the whole decision back (no orphan shift, fill or audit row). Filling an open shift withdraws only the offers still waiting (`OFFERED`), as the plan says; an `ACCEPTED` offer is left for the confirm to refuse with its "already filled" `409`. `AssignmentWriter.NewShift` can carry the rule result the caller already checked, so a proposal item is evaluated once and the stored/audited result is the enforced one; the overtime order uses the same rule snapshot. A shift type retired after the send is `409 shift-type-retired`, and a shift that starts while the decision runs is `409 shift-started` (the clock is read again at the write). `acknowledgeWarnings` lists at most 50 codes. docs/09 has the proposal rows and the planner exception.

Tests: +22 API in `ProposalDecisionApiTest` (inbox scope, count, filters, a 403 per endpoint for EMPLOYEE and AUDITOR; approve → `EXTRA`/`PROPOSAL` shift and audit; Block now → `422` nothing saved; a new Warn needs acknowledgement; same-send rest interaction without double counting; decline needs a comment; self-approval `403` for a supervisor proposer; the planner decides a supervisor's proposal; out-of-scope `403`; expired `409`; version, decided and withdrawn; locked period `409`; closed unit and retired shift type `409`; pay-period overtime hours; open-shift fill with only `OFFERED` offers withdrawn and the accepted one refused at confirm; out-of-order acknowledgement and audit; an item expiring underneath the decision rolls everything back, deterministic through a test trigger; a withdraw that holds the officer lock first wins with `409`, deterministic through a held advisory lock; a proposal row that changes underneath is `412 stale-version` with everything rolled back, deterministic through a test trigger; after S2, approving an officer for a supervisor post once the ACTING_SUP qualification is gone is `422` on R-01 with nothing saved) and +2 in `ProposalOvertimeTest` (the P-01 threshold and the P-04 minimum at 80 h, 80.25 h and 80.5 h, and a 70 h threshold from the policy). Run together with `ProposalDecisionApiTest`, `ProposalOvertimeTest`, `ProposalApiTest`, `SelfActionGuardTest`, `AssignmentApiTest`, `AssignmentInputApiTest`, `AssignmentMoveCancelApiTest`, `OvertimeApiTest`, `OvertimePayrollConcurrencyApiTest`, `AuthorizationMatrixTest` and `AuditApiTest` (the two P2 classes are 24 of them): **126 passed**, 0 failed (the first version of this note said 139 for the same set; the measured number then was 119). Web: the audit label only. Counts for the whole release are measured once at the end of v1.3.

### Shift proposals, P3: the officer screen

The third proposal PR (stacked on P2, PR #28). **P3 is the web for the officer side**, on My schedule, through the P1 endpoints; the supervisors' inbox screen is P4, so `/proposals` stays a placeholder.

- **Propose shifts card:** *Add a shift* takes a date (tomorrow to 11 Apr 2027), a unit (the home unit first, any active unit, owner Q4) and an active shift type (L16 is no longer listed). Every draft is checked **together with the others** in one `POST /proposals/preview`, so a draft that is fine alone but breaks rest or the weekly ceiling with another shows *Blocked* with the codes and the reason, and "Checked with your other drafts". Each draft has **Remove**. The drafts are kept in `sessionStorage` for the tab (a convenience: blocked storage is tolerated), never on the server until sent.
- **Send:** an optional note (500 characters, "Don't include medical details") and **Send to supervisor**, which is off, with the reason shown, while there are no drafts, a check is running or failed, any draft is Blocked or refused for another reason (locked period, closed unit, already waiting), or the note is too long (owner Q3). A refused send shows the api's words and checks again. After sending: "Sent to your supervisor. You'll see the answer under My proposals."
- **My proposals:** the last 90 days, newest first: sent time, item count, the note (as text only), the state pill (Waiting, Approved, Partly approved, Declined, Withdrawn, Expired), and per shift its outcome with the decider and comment ("Declined by M. Ellis: “…”", "Expired: the shift started before anyone answered."). **Withdraw** (with a confirm, `If-Match` on the version) while every shift waits; after a partial answer it says to ask the supervisor.
- **`/me/propose`** now redirects to `/me/schedule#propose` instead of a placeholder.
- **Accessibility:** the My schedule calendar's sideways scroll region at phone width takes focus and is labelled (a pre-existing axe `scrollable-region-focusable` finding at 390 px, met while checking this screen).
- The fixtures web has the same calls (seeded Approved, Declined-with-comment and Expired proposals for Sam Abara, and a simple rest check between drafts).

Tests: web **591** in 58 files on P2's base (was 567 in 56), **615** in 60 after merging `main` (PR-P/PR-Q): +17 in `ProposeShifts.test.tsx` (add/remove, combined check, Blocked disables Send, checking state, failed check, note limit, send and Waiting, refused send re-checks, note rendered as text, drafts survive a remount, blocked storage, unit picker and date floor, outcome lines with the comment, withdraw with confirm, refused withdraw, partly answered, empty and failed list), +9 in `proposalWords.test.ts`, +1 calendar focus, +1 `/me/propose` redirect; the three "not available" Propose tests and the `/me/propose` placeholder case are gone. Lint 0 errors (4 warnings, unchanged), `tsc -b` clean. Playwright: new `proposals-officer.spec.ts` (`@api`, serial): Tara drafts Sat 28 Nov and Tue 1 Dec evenings, Tuesday is Blocked by U-14 only with the Saturday draft and Send is off with the reason; she removes it, sends Saturday with a note and sees Waiting; she sends Fri 4 Dec and withdraws it; `/me/propose` lands on the card; at 390 px there is no sideways page scroll and Remove is reachable; axe on every state. The M1 "sends nothing" test in `not-built-states.spec.ts` and the `/me/propose` rows in the not-built route, axe and screenshot specs are removed. No API change, no migration; no pin moves.

Playwright on the branch (own stack `sc-sc-p3`, fresh per run, host load 12 to 29 from other stacks): `--project desktop` (the parallel specs) **110 passed, 2 failed**, both `board-views.spec.ts` (a 30 s test timeout under load; that spec only reads the planning board, which P3 does not touch, and the review gate re-ran it after a demo reset: 4/4); `proposals-officer` 3/3. Tablet: `proposals-officer`, `not-built-states` and `routes-and-errors` **9 passed** on a fresh stack. An earlier `desktop-datasets` run at load ~25 lost 17 tests to Chromium "Target crashed" and timeouts across unrelated specs, so the stack-wide specs were not re-measured here; the whole suite per viewport is measured once at the end of v1.3. Screenshots at 1440×900 and 390 px are the two `officer-*.png` crops in the officer guide and the full captures from `proposals-officer.spec.ts` (`SHOTS_DIR`).

**Gate fixes (review, security and UI test of PR #33).** `proposals-officer.spec.ts` finds this run's proposals by a token in their note and withdraws whatever Tara has waiting before **and after** the spec, so it passes on a reused stack and leaves nothing Waiting for the inbox specs (measured: desktop, desktop again and tablet on one stack, 3/3 each; afterwards Tara has only Withdrawn proposals). A failed check (a `429` "try again in N seconds", the api unreachable) now offers **Check again**; nothing retries by itself. The top of My schedule links to *Propose shifts* and *My proposals* ("On this page"), because the card sits below the offer history in the side column. Signing out (or an expired session) removes the `sc.propose.drafts.*` keys from the tab. docs/02 S-04, FR-30 and FR-31 and the docs/09 EMPLOYEE row now say what P1 to P3 built (the inbox side stays P4); docs/ui lists the endpoints the screen calls. Not changed: the calendar at 390 px still scrolls sideways for Friday to Sunday (its scroll region is focusable); fitting seven columns with the shift chips at that width is a redesign, not a fix. Web **619** in 60 files (+4: Partly approved with both outcomes, Check again after a 429, the in-page links, sign-out clears the drafts; the Withdrawn outcome line joined an existing test). Lint 0 errors (4 warnings), `tsc -b` clean. Playwright on the gate-fix head: `proposals-officer`, `not-built-states`, `routes-and-errors` and `a11y-every-screen` on desktop **25 passed**.

### Shift proposals, P4: the inbox screen

The fourth proposal PR (stacked on P3, PR #33). **P4 is the web for the decider side**, through the P2 endpoints. `/proposals` is no longer a placeholder.

- **Proposals (n)** in the nav: under Overtime for SUPERVISOR, under Quarter plan for PLANNER (the fallback decider). The count is text, from `GET /proposals/count?status=WAITING`, read again on every page change and after a decision.
- **Inbox** (`/proposals`): the Overtime board's two-pane pattern. Left: cards (officer, units, number of shifts, sent time, state pill, **Yours** on one's own), with **Waiting / All** and a **Unit** filter. Right: the selected proposal (`?proposal=<id>` keeps it in the link): the officer, pay-period hours with the overtime pill, the note quoted as plain text.
- **Per shift:** **Rules when sent** and **Rules now** side by side; a moved result is highlighted with "Changed since it was sent: Was …, now …" and the Warn and Block rows with their messages; "Would be overtime: N h · brings Tara to … of 80 h in this pay period" (owner Q5); the open-shift match with the officer's place in the overtime order, or "above minimum". With other shifts of the proposal still waiting, a line says "rules now" counts them as approved (docs/07 §4.4).
- **Decision:** an Approve / Decline radio pair per shift and a comment (required to decline, 500 characters, shown to the officer as text). Approving a shift with warnings needs **I acknowledge the warnings (codes) and approve anyway**; approving someone who isn't first in the overtime order needs its own **I'm approving outside the overtime order** (owner Q1). **Send decision (n accepted, m declined)** stays off, with the reason, until every shift has a choice and its needs are met.
- **Refusals inline:** a `422` (Block now, a new Warn, out of order) replaces each approved shift's "rules now" with the fresh result from the problem's `items`; "Not sent … Nothing was saved." A Blocked shift's **Approve** is off and it says to decline, or decline and use the board's own override. **There is no Emergency override in the inbox** (owner Q3; docs/ui build-notes §2.3 is superseded here). A `409`/`412` (answered elsewhere, withdrawn, started, stale) says so and reloads.
- **Own proposal** read-only: "Yours: waiting for another supervisor or the planner. You can't approve your own proposal." (SelfActionGuard on the API.)
- **Board chip:** a shift created from a proposal keeps the `extra` chip; its tooltip and accessible name end "· from an approved proposal". The API adds `fromProposal: true` to such `SHIFT` items on the live board (`source = 'PROPOSAL'`; left out otherwise, so other payloads are unchanged; docs/07 §4.2).
- The fixtures web has the same calls (Tara waiting with an out-of-order open-shift match and a was/now warning, M. Ellis's own proposal, Omar declined).
- Docs: supervisor guide (Proposals, with two screenshots), planner guide, docs/02 S-06 and FR-31, docs/07 §4.2 and §4.4, docs/09, docs/10 §8, docs/ui/README, README.

Tests: web **640** in 62 files (**652** after merging `origin/sc-p3`): +17 in `ProposalsPage.test.tsx` (nav count for supervisor and planner, list and first card, note as text, Waiting/All and unit filter, empty state, was/now, overtime and open-shift lines, Send off until choices and decline comments, separate warning and overtime-order acknowledgements then send and the count drops, decline comment rendered as text, a Block `422` inline with Approve off, no acknowledgement and no override, a new Warn from a `422` needs a new tick, own proposal read-only, `409` reloads, the `?proposal=` link, the chip tooltip and name, the http calls with `If-Match`), +5 in `inboxWords.test.ts`; the `/proposals` placeholder case and the planner nav lists are updated. Lint 0 errors (4 warnings, unchanged), `tsc -b` clean. API: +1 assertion block in `ProposalDecisionApiTest` (the approved shift carries `fromProposal`, no other shift does); `mvn verify` through the `api-test` stage: **570 = 127 rules + 36 infrastructure + 407 api** on the P3 base, and **603 = 140 + 36 + 427** after merging `origin/sc-p3` (with S2/S3 and P2's R-01 test), 0 failures/errors/skipped. Playwright: new `proposals-inbox.spec.ts` (`@api`, stack-wide, serial, a per-run token, cleans up before and after: withdraws Tara's waiting proposals, declines what is left and cancels shifts created from proposals): Tara sends Sat 28 Nov + Fri 4 Dec and Sun 29 Nov; M. Ellis approves Saturday (warnings acknowledged) and declines Friday with a comment, the nav count drops by one; in a second window Sunday was a Warning when sent and, after Saturday's approval, the send is refused inline (Blocked U-08, U-14; Approve off; no override) and a reload shows the same was/now; he declines it; the board chip says "from an approved proposal"; Tara sees Partly approved and Declined with the comments; J. Chen's inbox is empty. The not-built route, axe and screenshot specs drop `/proposals`; the nav lists in `session-and-nav` and `planner.spec` include Proposals. Measured on own stack `sc-p4`, fresh per viewport. At `6e087b2`: `--project desktop-datasets` 135 passed, 1 failed (the planner spec's exact nav list, then fixed), `--project tablet-datasets` 135 passed, 1 skipped; `proposals-inbox` passed twice in a row on one stack. After merging `origin/sc-p3` (rule set v4, R-01/R-02 live), at `5138c38`: desktop **136 passed**, tablet **135 passed, 1 skipped**, 0 failed. Screenshots at 1440×900 and 768×1024 from `proposals-inbox.spec.ts` (`SHOTS_DIR`); two are in the supervisor guide. The out-of-order acknowledgement and the own-proposal view are covered by the web and API tests, not Playwright: the demo has no open shift Tara can take that E2 does not, and the demo supervisors are not linked to officers before S4.

**Gate fixes (review, security and UI test of PR #36).** Inbox cards list their shifts ("Sat 28 Nov · E8 15:00 – 23:00 · Unit B", up to three, then "and N more"), so several proposals from one officer can be told apart: `GET /proposals` cards gain `shifts` (the items on the caller's units). Each approved shift has **Open the board for the week of …** whenever the proposal is open, not only right after sending. After a `422`, a shift that is Blocked now has its Approve choice cleared; a fresh refusal is authoritative for the open-shift match too (no order in it: no "outside the overtime order" tick). The filters sit above both panes, so on a tablet they come before the open proposal. `encodeURIComponent` on the proposal id in the detail and decision paths (security low 1). The decision carries the warning codes the decider ticked, and a missing choice is never sent as an approval. The "rules now" note shows only on a shift with an earlier waiting one. The comment-length check counts the trimmed text, as the button does. Fixture: a mix of expired and declined with nothing approved reads Expired (plan §1.1). The e2e clean-up touches only this spec's own proposals (note prefix `e2e-inbox`), skips one it can't see, and cancels only their shifts. Docs: the officer guide no longer says the inbox is being built; build-notes §2.3 marked superseded (no override flow, `status=WAITING|ALL`); docs/01, HANDOFF, traceability FR-30/31, roadmap and docs/07 (card `shifts`) brought up to date.
