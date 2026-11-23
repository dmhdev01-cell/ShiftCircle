# Release notes

What each release added, and the test counts at the time. These paragraphs used to sit in the README; the README now keeps only the current numbers. The author and review rounds behind each release are in [review-rounds.md](review-rounds.md), and the AI-assisted work in [ai-dev-log.md](ai-dev-log.md).

Each release was built on its own branch, gated by dev-qa on the exact tip (web, API in two class orders, Playwright per viewport on a fresh stack, dataset checksums, payroll golden and plan fingerprints), and only then pushed to `main` by the operator.

## Phase 3 final (before release 3)

The first independently verified tip was `5d0f810` (R61). API: **422 = 123 rules + 27 infrastructure + 272 api tests**, green in the default order and with random seed 20261121, 0 failures/errors/skipped. Web unit tests: **277**. Playwright against the real API, whole suite, a fresh stack per viewport: desktop **101 passed / 0 failed**, tablet **100 passed and 1 skipped** (the TV-size check is desktop-only) **/ 0 failed**; fixtures: **22 / 21**, as recorded at the time. The static counts agreed (123 + 27 + 272 `@Test` methods, one per line, no parameterised tests).

Two branches followed on top of it:
- **Security fixes** (R62) added three API tests: an author run was **425 = 123 + 27 + 275** in both orders.
- **Preferences and patterns** added 19 API tests: an author run was **444 = 123 + 27 + 294**, web **290**. The 120 and 100 drafts stayed shift-for-shift sha256-identical to `c9ac073`, and the checksums and payroll golden were unchanged.

Both are on `main` and are covered by every later gate.

**Fresh-clone check at `f1d696d` (2026-11-20, macOS, Docker Desktop).** Setup sections 1, 2 and 4 of the README were run from a fresh clone. Both Playwright viewports on one stack gave 21 passed, 1 skipped and 4 failed, all 4 on tablet after desktop had changed the data; tablet alone on a fresh stack gave 12 passed, 1 skipped (the TV-size check runs on desktop only). That is why the README asks for one viewport per fresh stack. The `--add-host` line was run on macOS; on Linux it was not run (`--network host` with `BASE_URL=http://localhost:8080` is the alternative). Not run in that clone: the `api-test` service (the builders and QA ran the same Maven build) and the web unit tests (the same command passed in the branch worktrees).

## Release 3: unit closures, relief and the staffing estimate

Adds dated unit closures, closed-unit relief and the staffing estimate, then Dataset 150. Authored as **450 = 123 + 27 + 300** in a clean default run before Dataset 150; its two 150 tests were green, web **313**. With no closure rows the 120/100 plan fingerprints and all checksums stayed identical, and 150 has its own pinned checksum and plan. dev-qa's first gate found a wall-display defect at `a0d4f6f`; the release passed at `09ed7ba` (R65, R66).

## Release 4: preference headline, Not rostered, demo lock, U-16

Adds the #20 Block + ACKNOWLEDGE pin, #14 `Not rostered` status and the corrected preference headline (Dataset 120: 196 of 214, 92%, scorecard = Compare), the #17 owner-token demo lock, the #10 U-16 Warn/acknowledge rule (rule set v3, V12) for an 8 h officer on a night shift, and the #16 48/60 wording. Author run: **460 = 127 rules + 27 infrastructure + 306 api**, 0 failures/errors/skipped; web **316**; audit codes **49**. The gate found a pre-existing route shadow that made the Rules Shift types table (with U-16) unreachable; it was fixed red-first and the router test pins `/rules/7/shift-types`. The 100/120/150 checksums, the three plan fingerprints and the payroll golden stayed exact; Dataset 120 stays 38 gaps / 7 warnings / 5,103 shifts / 107 officers. Passed at `f1883c4` (R67, R68).

## Release 5: L16 retired

The Dataset 100 seed has no 16 h rows, V13 sets the template inactive without deleting old history, and new assignments or open shifts naming it get a plain 400. PC-03 is rebuilt as a P12 + 5 h actual (17 h). New Dataset 100 pins: checksum **`4156077d…da6b`**, payroll golden **`9f2d51b3…04ff`** (1,037 rows, 8,197.60 h). The 100 plan fingerprint is unchanged (`ec337014…409e1b`, 6,586 rows, 727 gaps) and its warnings move **117 → 135**, because removing L16 history exposed 18 real U-14 plan warnings that the old baseline subtracted. The gate's seed repair restored PC-01 (U-01/U-05/U-08/U-14 at 64 h) and Tara's block-free Sun 29 pick-up; the golden and plan stayed exact. 120/150 checksums and fingerprints are exact. Author run: **462 = 127 rules + 28 infrastructure + 307 api**; web **318**. Passed at `731b722` after the repair (R69, R70).

## Release 6: Qualified staff card

Adds a read-only **Qualified staff** card to the quarter plan: failing and checked block-days per unit and block, with the sentence "N block-days are below the qualified minimum. The planner does not enforce this." Measured with no closures: Dataset 100 **346 of 1,470**, Dataset 120 **0 of 1,470**, Dataset 150 **103 of 1,470**. Closed unit-days are not checked; relief counts where placed; qualification start dates are not checked. Checksums, golden and plan fingerprints unchanged. Author run **462 = 127 + 28 + 307**; web **325**, build clean, lint 4 pre-existing warnings, audit codes 49. Passed at `dae3fac` (R71).

## Release 7: planner hand edits in a draft, and the docs bundle

A planner can add, move (time or unit), give to another officer, or remove one shift in an uncommitted draft. Every save goes through the same rules engine: a Block saves nothing, a Warn needs a second, acknowledged save, and there is no emergency override in a draft. Each save re-scores the whole draft; edited shifts read "· edited" and the audit log records each edit as "Draft shift edited". Generate and discard drop hand edits after a confirm; commit re-checks every shift. No migration; all checksums, the golden and the plan fingerprints stay exact. The same release added the licence, the user guide, the install guide and the move of the process records to `docs/process/`. Gate: web **341**, API **464 = 127 + 28 + 309** in both orders, Playwright desktop **105 / 0 failed**, tablet **104 passed and 1 skipped / 0 failed**, fixtures **43 / 0 failed**, audit codes **50**. Passed at `871375d` (R72).

## Release 8: public repository (docs only)

Screenshots from the gated build in the user guide, the repository made public (and renamed `ShiftCircle`), and small documentation corrections: the closure arithmetic behind 1,302, the `acknowledgeWarnings` types, ADR-030's note on `EXTRA` and the re-score, and comment-only path fixes.
