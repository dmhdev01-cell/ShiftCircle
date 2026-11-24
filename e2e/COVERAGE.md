# UI test coverage (Playwright, Chromium only)

What the end-to-end suite covers, screen by role by state, and what it cannot.
Written for the UI test plan, phase B (2026-11-20) and kept current since (24 Nov 2026: 42 spec files in the real-api run (43 in the folder; `keyboard.spec.ts` is fixtures-only); 110 parallel tests and 14 stack-wide tests (in 12 files) per viewport). Every row names the spec
that proves it. **Real api** means the compose stack; **fixtures** means the
fixtures-mode web (tag `@fixtures`). Run against the real api with
`--grep-invert @fixtures`, **one viewport per fresh stack** (the specs change
data). Browsers: **Chromium only** (`playwright.config.ts` refuses any other).

## Results at `5a3be22` (24 Nov 2026, fresh stack per viewport, real api)

| Project | Passed | Skipped | Failed | What it runs |
|---|---|---|---|---|
| `desktop-datasets` (1440×900) | 124 | 0 | 0 | the whole desktop suite: 110 parallel tests, then 14 stack-wide specs one at a time |
| `tablet-datasets` (768×1024) | 123 | 1 (TV-fit, desktop only) | 0 | the same at the tablet viewport |
| fixtures-mode web, `--grep-invert @api` | 23 | 79 (they need the real api) | 0 | the fixtures-only subset |

No spec carries a known-defect (`test.fail`) marker any more.

A known-defect test asserts the **correct** behaviour and is marked
`test.fail(...)` with the defect's reason. Playwright counts it as passed while
the defect exists and reports "expected to fail, but passed" as soon as the
defect is fixed, so the marker must then be removed. No assertion was weakened.

Screenshots: `screenshots.spec.ts` wrote 80 full-page captures (40 per viewport) in phase B; the board and quarter-plan specs have added captures since to the same `index.json`, written
to `SHOTS_DIR` (default `/private/tmp/sc-ui-shots/<RUN_ID>`, outside the repo).

## Defects found by these specs

All nine defects below (D1 to D6 and D8 to D10; there was no D7) were fixed on `main`: no spec carries a `test.fail` marker any more (`grep -rn "test.fail" e2e/tests` finds only a stale comment in `planning-override.spec.ts`). The file and line evidence is as it stood when each was found, so it no longer matches the code.

| ID | Severity | What happened | Evidence at the time | Spec | Now |
|---|---|---|---|---|---|
| D1 | Medium (every screen) | The top bar shows **Wed 18 Nov 2026** on the demo day, Thu 19 Nov: `asOf` is parsed as UTC midnight and formatted in Regina time | `web/src/shell/TopBar.tsx:47-53`; every capture | session-and-nav | **Fixed**: the spec asserts the correct behaviour and its `test.fail` marker is gone |
| D2 | Low | An empty Overrides report shows an empty table and no sentence | `web/src/reports/ReportsPage.tsx:353-372`; `desktop__supervisor__reports__overrides.png` | reports | **Fixed**: the spec asserts the correct behaviour and its `test.fail` marker is gone |
| D3 | Low | `/reports/hours` (any tab in the address) opens Coverage; the route parameter is ignored | `ReportsPage.tsx:75` | reports | **Fixed**: the spec asserts the correct behaviour and its `test.fail` marker is gone |
| D4 | Medium | If the reports fail to load, the screen stays empty with no message (no error handling) | `ReportsPage.tsx:85-96` | routes-and-errors | **Fixed**: the spec asserts the correct behaviour and its `test.fail` marker is gone |
| D5 | Medium (safeguard UX) | A **filled** open shift still shows **Confirm** on a leftover accepted offer; the api refuses (409 since F8) but the screen invites a second fill. Almost every seeded filled shift has one | `web/src/overtime/OvertimePage.tsx:500` | overtime-decline-filled | **Fixed**: the spec asserts the correct behaviour and its `test.fail` marker is gone |
| D6 | Low | The plain-language rule sentence reads "After **.\***, an officer needs … the change is **block**." (U-01, U-04; "is warn" elsewhere) | api `GET /rule-sets/1/tables/REST` field `sentence`; `desktop__rules-admin__rules__landing.png` | rules-refusals | **Fixed**: the spec asserts the correct behaviour and its `test.fail` marker is gone |
| D8 | Low | The sign-in screen (signed out) shows the full **supervisor** side navigation | `web/src/shell/nav.tsx:37,40`; `desktop__anonymous__login__normal.png` | session-and-nav | **Fixed**: the spec asserts the correct behaviour and its `test.fail` marker is gone |
| D9 | Medium | After Assign, Acknowledge and assign, or an emergency override, the board is **not reloaded**: the saved cell still reads "Off" until the person leaves the screen (and may try again) | `web/src/planning/PlanningPage.tsx` wires `reload` only at :330 (publish) and :519 (move/cancel) | planning-override | **Fixed**: the spec asserts the correct behaviour and its `test.fail` marker is gone |
| D10 | Serious (axe, tablet) | At 768 px the overtime candidate table and the Hours report scroll sideways with no keyboard access (`scrollable-region-focusable`) | `web/src/overtime/CandidateTable.tsx:50`, `ReportsPage.tsx:41` | a11y-every-screen | **Fixed**: the spec asserts the correct behaviour and its `test.fail` marker is gone |

Cosmetic, for the visual review: the planning board's "api unreachable" panel
shows the browser's raw "Failed to fetch"; the report export status names the
report ("The export overrides is downloaded.") rather than the file.

## Coverage matrix

Legend: **E** existing spec (before phase B) · **N** new in phase B · **F**
fixtures-only · **—** not coverable, with the reason.

### Sign-in, session, navigation, footer

| Flow / state | Roles | Spec | Status |
|---|---|---|---|
| Sign-in screen: mock banner, 7 demo users, footer, no government mark | anonymous | session-and-nav | N |
| Landing and exact nav per role (top bar "Role · Name (mock sign-in)") | all 7 users | session-and-nav | N |
| TV account: no navigation | display | session-and-nav | N |
| Sign out; a screen afterwards asks for sign-in; no "session ended" notice | supervisor | session-and-nav | N |
| 401 after token loss → sign-in with "Your session ended. Sign in again." | supervisor | session-and-nav | N |
| Signed-out visitor sees no supervisor nav | anonymous | session-and-nav (D8) | N (defect fixed) |
| About & version shows the stack's commit and live rule set | approver | session-and-nav | N |
| Top bar date is the demo day | supervisor | session-and-nav (D1) | N (defect fixed) |
| Footer line on every route incl. `/login` and `/display`; no coat of arms / logo / background image | supervisor, display | session-and-nav, e5-wall-display | N, E |

### Planning board

| Flow / state | Roles | Spec | Status |
|---|---|---|---|
| Board, KPI tiles, roster | supervisor | e1-blocked-assignment, layout, screenshots | E |
| Week / Pay period / Month, Comfortable / Compact, KPI chip strip, totals column and footer, badges; axe; no page scroll at 1440 and 390 | supervisor | board-views | N |
| Find, filter (overtime, rotation, works, qualification), sort; CSV download (BOM, formula guard, row count), copy as TSV, print media (shell hidden, full disclaimer, landscape PDF), pay period fits a landscape width, month print not offered; axe; 390 (needs the real api) | supervisor | board-filters | N |
| PC-01 Block with reasons, no save, no override | supervisor | e1-blocked-assignment (@api), keyboard-api | E, N |
| Fill a gap (A2): gap word or short cell opens the free-officer panel ranked by pay-period hours; rest as a fact; Check & assign → PC-01 Block with reasons, no assign; Escape; axe at 1440 and 390 | supervisor | gap-fill (@api) | N |
| Emergency-only Block → override dialog: empty, 9 chars, 10 spaces refused; valid reason saves; audited | supervisor | planning-override, audit | N, E |
| Warning only → "Acknowledge and assign" (no override, no plain save) → saved | supervisor | planning-override | N |
| Board refreshes after a save | supervisor | planning-override (D9) | N (defect fixed) |
| Move and cancel with reason (If-Match) | supervisor | move-cancel (@api) | E |
| Started shift (v1.2): no Move or Cancel, plain notice, link opens Time & attendance on that shift (period, unit, record panel); a future shift still moves and a start that has passed is refused before submit | supervisor | started-shift-dialog (@api) | N |
| Publish period, audit row | supervisor, auditor | publish-period (@api), screenshots | E |
| Read-only board | auditor | screenshots, a11y-every-screen | N |
| Wrong role (employee) → plain refusal, no blank page | employee | routes-and-errors | N |
| Api unreachable → "Could not load the schedule", Try again recovers | auditor, supervisor | routes-and-errors | N |
| Layout at 1280/1366, tablet sideways hint | supervisor | layout | E |

### Overtime

| Flow / state | Roles | Spec | Status |
|---|---|---|---|
| Ranked candidates, skipped keep their place | supervisor | e1-blocked-assignment (F), e2 | E |
| Offer → accept → confirm, D · extra | supervisor, employee | e2-offer-accept-confirm | E |
| Offer → **decline** → supervisor sees Declined, no Confirm | supervisor, employee | overtime-decline-filled | N |
| Filled shift: no checkbox, Offer, Assign directly | supervisor | overtime-decline-filled | N |
| Filled shift: no Confirm on a leftover accepted offer | supervisor | overtime-decline-filled (D5) | N (defect fixed) |
| Employee sees no colleague hours | employee | e2-offer-accept-confirm | E |

### Time & attendance

| Flow / state | Roles | Spec | Status |
|---|---|---|---|
| Lock refused while actuals are missing (list shown) | supervisor | e4-lock-and-payroll | F only — the real dataset records every past shift, so no real-api period has a missing actual |
| Record actual: no default choice, Save disabled until chosen | supervisor | — on the real api, same reason; verified in a real browser on the fixtures web (review round R32) and by vitest | — |
| Lock the open period at the demo clock | supervisor | e4-lock-and-payroll | E |
| Locked period read-only; payroll CSV 8 columns, 2-decimal hours, period dates | supervisor | e4-lock-and-payroll | E |
| Unlock reason gate (≥ 10 characters) | supervisor | e4-lock-and-payroll | E |

### Reports

| Flow / state | Roles | Spec | Status |
|---|---|---|---|
| Coverage, Hours, Overtime, Overrides tabs; CSV export from each | supervisor | reports | N |
| Planted PC-03 override (reason, U-05, Unit C) in the table and CSV | auditor | reports | N |
| Range and unit picker: defaults, scope-limited units, refusals, ranged reports and CSV, reset | supervisor, auditor | reports (S1) | N |
| Empty overrides report says so | supervisor | reports (D2) | N (defect fixed) |
| Tab in the address opens that tab | auditor | reports (D3) | N (defect fixed) |
| Data cannot be loaded → message | auditor | routes-and-errors (D4) | N (defect fixed) |
| Broken data → error boundary panel, nav and footer alive | auditor | routes-and-errors, screenshots | N |

### Rules admin

| Flow / state | Roles | Spec | Status |
|---|---|---|---|
| Edit → build → submit → approve → publish; author cannot approve; approver cannot edit (submitted) | admin, approver | e3-rule-change (both api and fixtures) | E |
| Rest hours 7 and 25 refused in plain words, nothing stored (api checked) | admin | rules-refusals | N |
| Approver cannot edit a draft or start one | approver | rules-refusals | N |
| Supervisor reads only | supervisor | e3-rule-change | E |
| Plain-language sentence is words | admin | rules-refusals (D6) | N (defect fixed) |
| Hostile shift-kind pattern | admin | — through the screen: the column is a select of named kinds, so no pattern can be typed; the api refusal is pinned by `RuleRowEditApiTest` and review rounds R39/R40 | — |

### Audit log

| Flow / state | Roles | Spec | Status |
|---|---|---|---|
| Override row with actor and rules, read-only | auditor | audit (@api) | E |
| Filters (actor, entity), empty result sentence, Load more, Clear | auditor | audit-viewer | N |
| Supervisor sees no rule-change events | supervisor | audit-viewer | N |
| Employee: no nav entry, "Not allowed", api 403 | employee | audit, routes-and-errors | E, N |

### Wall display

| Flow / state | Roles | Spec | Status |
|---|---|---|---|
| Counts only, no names or employee numbers in the DOM | display | e5-wall-display | E |
| Refresh every 60 s, "updated hh:mm" | display | e5-wall-display | E |
| Not live → banner, last known, fits; recovery | display | e5-wall-display (@api) | E |
| Short-staffed: words + icon, facility count, others still covered | display | display-short (payload reshaped: the dataset is covered today) | N |
| Supervisor sees own units only | supervisor | e5-wall-display | E |
| Fits 1920×1080 and 1366×768 | display | e5-wall-display (desktop) | E |

### Not built, not found, keyboard, accessibility

| Flow / state | Roles | Spec | Status |
|---|---|---|---|
| `/proposals`, `/me/propose`, `/me/hours`, `/rules/1/review` say "Not built yet" and what is planned | supervisor | routes-and-errors | N |
| Unknown route → "Page not found", nav still works | supervisor | routes-and-errors | N |
| Keyboard only, real api: E1 (unit select, cell, template, verdict focus, Close returns focus to the cell) | supervisor | keyboard-api | N |
| Keyboard only, real api: audit filters in reading order, Enter applies, Clear | auditor | keyboard-api | N |
| Keyboard only, fixtures: E1 chip, skip link, E3 | supervisor, admin, approver | keyboard | E (F) |
| axe WCAG 2.1 AA (serious/critical fail) on every screen per role, both viewports | all | a11y-every-screen (+ flow specs on dialogs and panels) | N |

### Quarter planner, preferences, datasets and units (added after phase B)

| Flow / state | Roles | Spec | Status |
|---|---|---|---|
| Generate, read, commit a quarter draft; a supervisor then changes one shift | planner, supervisor | planner | N |
| Draft hand edits: a Block refuses, a Warn needs acknowledging, remove a shift, then commit | planner | planner-draft-edit (runs on fixtures and the real api) | N |
| Landing, scorecard, gaps pass axe; the commit dialog works by keyboard | planner | planner-a11y | N |
| Committed plan keeps its tabs after a reload, with the FTE bands | planner | planner-committed | N |
| Planned absences skip the officer and are counted on the scorecard | planner | planner-absences | N |
| Plan inputs: the headline and the inputs panel before and after Generate, on Datasets 150 and 120, match GET /planner/inputs; axe on the open panel | planner | planner-inputs | N |
| Preferences after a commit: an N12 officer who asked for 12 h nights reads Met | planner | planner-preferences-committed | N |
| Officer preference card: a mix of day parts survives a reload | employee | preferences-multi | N |
| Officer pattern: an 8 h officer changes, a 12 h officer is read-only | planner | officer-pattern | N |
| Dataset 120: gaps, D12/N12 chips, fill one gap, a fifth 12 h day refused | planner, supervisor | dataset120 | N |
| Demo reset: 100 to 120 and back; a committed 2027 plan is erased | planner | reset-datasets, reset | N |
| Dataset notice on the Quarter plan when Dataset 100 is loaded, with a link to About & version (S6); the Other absence code (S8) | planner, supervisor | s6-s8-dataset-notice-other-absence | N |
| Close Unit C from a date, plan without it, reopen it | planner | unit-closure | N |
| Planning board week navigation, and a week and unit opened from the address | supervisor | week-navigation | N |
| Absence correction (sick to worked and back); clear a recorded actual back to "needs actual" | supervisor | absence-correction, clear-actual | N |
| Record-actual drawer: the grid keeps its place, closes with X or Escape, says Done | supervisor | time-grid-refresh | N |
| Not-built states say so: Propose shifts sends nothing (M1); Find eligible officer on a slot with no open shift (M3) | employee, supervisor | not-built-states | N |
| Demo session: a refresh keeps the person signed in on the same screen; sign-out and a `401` clear it (S11) | supervisor | session-and-nav | N |
| Reports date range and unit picker (S1) | supervisor, auditor | reports | N |
| Quarter plan readability on Dataset 120: the unused part-time capacity line, gaps grouped under a weeks-by-units strip, the week picker with gap counts, the all-units table collapsed, the ⚠ on a warned shift (tooltip by hover and keyboard), axe | planner | dataset120 (calls `quarterPlanChecks.ts`) | N |
| Planned leave (PR-D) on Dataset 150: seeded Vac and Sick chips on the draft roster, the scorecard's relief line, the Add planned leave dialog (validation, axe), three Sick days on the roster and three `record_absence` audit events; resets back to 100 | planner, auditor | planned-leave | N |
| A supervisor with no linked officer has no Employee view (PR #14); the planner's menu without Reports is asserted by the web unit tests (`roles.test.ts`) only, not in the browser | supervisor | session-and-nav | N |

**Not covered by Playwright:** the planner is refused every report by the API (`403`), and since PR #14 the menu has no Reports item for the planner; no spec asserts the absence of the item.

## Projects: parallel, then the stack-wide specs one at a time

`playwright.config.ts` defines four projects. `desktop` and `tablet` run every spec that leaves the shared data as it found it, in parallel (`E2E_WORKERS`). `desktop-datasets` and `tablet-datasets` run, **after** the matching parallel project and with one worker, the specs that change what the whole stack shares: they reset the demo database to Dataset 120 or 150 and back to 100, generate, commit or discard the one quarter plan, or lock the demo pay period. `--project desktop-datasets` is therefore the whole suite for a viewport; `--project desktop` alone skips the stack-wide specs (`e2e/README.md`, "Stack-wide specs run one at a time, last").

## Not coverable here, and why

- **Record actual / missing-actuals lock refusal on the real api:** the generated
  dataset records an actual for every past shift; covered on the fixtures web.
- **Hostile shift-kind pattern through the UI:** the screen offers a select, not
  free text; covered at the api.
- **Spreadsheet behaviour of the CSVs** (formula neutralisation as Excel sees it):
  the browser only downloads; covered by api tests and review R39.
- **Visual correctness** (palette, spacing, truncation): the screenshots are for
  the visual review (phase D), not asserted pixel by pixel.

## Order dependencies on one stack (why one viewport per fresh stack)

E4 locks the 9 - 22 Nov pay period. Specs that check or save a change in the
demo week (planning-override, keyboard-api, screenshots' planning captures,
move-cancel) unlock it first through the api (`openDemoWeekPeriod`). The older
`e1-blocked-assignment` `@api` test does not, so if it runs right after E4's
lock it sees "Unlock it with a reason to make changes" instead of the Block; it
passed in every run here, but the dependency is real. E2 is the only spec that
uses the demo data's one open shift Tara Nakamura can take; the decline spec
creates its own open shift.

## Commands

```sh
docker compose up -d --build --wait
docker run --rm -v "$PWD/e2e":/app -w /app node:24-alpine sh -c "corepack enable && pnpm install --frozen-lockfile"
mkdir -p /private/tmp/sc-ui-shots
docker run --rm --add-host=host.docker.internal:host-gateway \
  -v "$PWD/e2e":/work -v /private/tmp/sc-ui-shots:/private/tmp/sc-ui-shots -w /work \
  -e BASE_URL=http://host.docker.internal:8080 -e RUN_ID=my-run \
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --grep-invert @fixtures --project desktop-datasets
# then: docker compose down -v && docker compose up -d --wait, and --project tablet-datasets
```
