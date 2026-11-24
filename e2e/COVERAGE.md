# UI test coverage (Playwright, Chromium only)

What the end-to-end suite covers, screen by role by state, and what it cannot.
Written for the UI test plan, phase B (2026-11-20). Every row names the spec
that proves it. **Real api** means the compose stack; **fixtures** means the
fixtures-mode web (tag `@fixtures`). Run against the real api with
`--grep-invert @fixtures`, **one viewport per fresh stack** (the specs change
data). Browsers: **Chromium only** (`playwright.config.ts` refuses any other).

## Results at `ac7e1cd` (this author's runs, fresh stack per viewport)

| Viewport | Passed | Skipped | Failed | Of which known-defect tests (`test.fail`, pass while the defect is there) |
|---|---|---|---|---|
| desktop 1440×900 | 83 | 0 | 0 | 8: D1, D2, D3, D4, D5, D6, D8, D9 |
| tablet 768×1024 | 82 | 1 (TV-fit, desktop only) | 0 | 10: the 8 above + D10 on Overtime and Reports > Hours |

A known-defect test asserts the **correct** behaviour and is marked
`test.fail(...)` with the defect's reason. Playwright counts it as passed while
the defect exists and reports "expected to fail, but passed" as soon as the
defect is fixed, so the marker must then be removed. No assertion was weakened.

Screenshots: 80 full-page captures (40 per viewport) with `index.json`, written
to `SHOTS_DIR` (default `/private/tmp/sc-ui-shots/<RUN_ID>`, outside the repo).

## Defects found by these specs

| ID | Severity | What happens | Evidence | Spec |
|---|---|---|---|---|
| D1 | Medium (every screen) | The top bar shows **Wed 18 Nov 2026** on the demo day, Thu 19 Nov: `asOf` is parsed as UTC midnight and formatted in Regina time | `web/src/shell/TopBar.tsx:47-53`; every capture | session-and-nav |
| D2 | Low | An empty Overrides report shows an empty table and no sentence | `web/src/reports/ReportsPage.tsx:353-372`; `desktop__supervisor__reports__overrides.png` | reports |
| D3 | Low | `/reports/hours` (any tab in the address) opens Coverage; the route parameter is ignored | `ReportsPage.tsx:75` | reports |
| D4 | Medium | If the reports fail to load, the screen stays empty with no message (no error handling) | `ReportsPage.tsx:85-96` | routes-and-errors |
| D5 | Medium (safeguard UX) | A **filled** open shift still shows **Confirm** on a leftover accepted offer; the api refuses (409 since F8) but the screen invites a second fill. Almost every seeded filled shift has one | `web/src/overtime/OvertimePage.tsx:500` | overtime-decline-filled |
| D6 | Low | The plain-language rule sentence reads "After **.\***, an officer needs … the change is **block**." (U-01, U-04; "is warn" elsewhere) | api `GET /rule-sets/1/tables/REST` field `sentence`; `desktop__rules-admin__rules__landing.png` | rules-refusals |
| D8 | Low | The sign-in screen (signed out) shows the full **supervisor** side navigation | `web/src/shell/nav.tsx:37,40`; `desktop__anonymous__login__normal.png` | session-and-nav |
| D9 | Medium | After Assign, Acknowledge and assign, or an emergency override, the board is **not reloaded**: the saved cell still reads "Off" until the person leaves the screen (and may try again) | `web/src/planning/PlanningPage.tsx` wires `reload` only at :330 (publish) and :519 (move/cancel) | planning-override |
| D10 | Serious (axe, tablet) | At 768 px the overtime candidate table and the Hours report scroll sideways with no keyboard access (`scrollable-region-focusable`) | `web/src/overtime/CandidateTable.tsx:50`, `ReportsPage.tsx:41` | a11y-every-screen |

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
| Signed-out visitor sees no supervisor nav | anonymous | session-and-nav (D8) | N, known defect |
| About & version shows the stack's commit and live rule set | approver | session-and-nav | N |
| Top bar date is the demo day | supervisor | session-and-nav (D1) | N, known defect |
| Footer line on every route incl. `/login` and `/display`; no coat of arms / logo / background image | supervisor, display | session-and-nav, e5-wall-display | N, E |

### Planning board

| Flow / state | Roles | Spec | Status |
|---|---|---|---|
| Board, KPI tiles, roster | supervisor | e1-blocked-assignment, layout, screenshots | E |
| Week / Pay period / Month, Comfortable / Compact, KPI chip strip, totals column and footer, badges; axe; no page scroll at 1440 and 390 | supervisor | board-views | N |
| Find, filter (overtime, rotation, works, qualification), sort; CSV download (BOM, formula guard, row count), copy as TSV, print media (shell hidden, full disclaimer, landscape PDF), pay period fits a landscape width, month print not offered; axe; 390 (needs the real api) | supervisor | board-filters | N |
| PC-01 Block with reasons, no save, no override | supervisor | e1-blocked-assignment (@api), keyboard-api | E, N |
| Emergency-only Block → override dialog: empty, 9 chars, 10 spaces refused; valid reason saves; audited | supervisor | planning-override, audit | N, E |
| Warning only → "Acknowledge and assign" (no override, no plain save) → saved | supervisor | planning-override | N |
| Board refreshes after a save | supervisor | planning-override (D9) | N, known defect |
| Move and cancel with reason (If-Match) | supervisor | move-cancel (@api) | E |
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
| Filled shift: no Confirm on a leftover accepted offer | supervisor | overtime-decline-filled (D5) | N, known defect |
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
| Empty overrides report says so | supervisor | reports (D2) | N, known defect |
| Tab in the address opens that tab | auditor | reports (D3) | N, known defect |
| Data cannot be loaded → message | auditor | routes-and-errors (D4) | N, known defect |
| Broken data → error boundary panel, nav and footer alive | auditor | routes-and-errors, screenshots | N |

### Rules admin

| Flow / state | Roles | Spec | Status |
|---|---|---|---|
| Edit → build → submit → approve → publish; author cannot approve; approver cannot edit (submitted) | admin, approver | e3-rule-change (both api and fixtures) | E |
| Rest hours 7 and 25 refused in plain words, nothing stored (api checked) | admin | rules-refusals | N |
| Approver cannot edit a draft or start one | approver | rules-refusals | N |
| Supervisor reads only | supervisor | e3-rule-change | E |
| Plain-language sentence is words | admin | rules-refusals (D6) | N, known defect |
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
  mcr.microsoft.com/playwright:v1.65.1-noble npx playwright test --grep-invert @fixtures --project desktop
# then: docker compose down -v && docker compose up -d --wait, and --project tablet
```
