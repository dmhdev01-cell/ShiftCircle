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

## Release 12 (v1.2, in progress): the shift dialog says up front what it can't do; the quarter plan says what it uses

Not part of the submission tag. Changes merged after `v1.1.1-submission`, one pull request each.

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

## Release v1.3: supervisors get their own rostered shifts

The owner approved the plan in `.factory/plans/v1.2-supervisors.md` (the plan file still says v1.2; the
release was split afterwards, so it is v1.3 here). The work is eight small pull requests, **S1 to S8**;
this entry covers **S1** and **S2**. The plan is not in the repository, so this section is the record of what
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

**Counts at this gate:** API **494 = 127 rules + 36 infrastructure + 331 api** (`mvn verify` on the
pull request, `BUILD SUCCESS`, 0 failures, errors or skipped); web unit tests **567** in 56 files,
lint 0 errors, `tsc -b` clean, build clean; `check-ignored-sources.sh` OK and
`check-audit-codes.sh` still 50 codes. Playwright: see the pull request.

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

**The migration (`V17__rule_set_v4_posts.sql`, the next number after S1's V16).** A ninth rule table,
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
- **V17 builds on whichever version is published** instead of naming v3, and stops if there is not
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

**Not in this release** (the rest of the plan):
the rank-aware planner (S3), the supervisor posts and the demo supervisors in the datasets with the
single re-pin (S4), the overtime pools and the self-edit guard (S5), and the board, My schedule,
display and reports work (S6, S7).
