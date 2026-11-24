# ShiftCircle — UI Specification

**Status:** v1.0 · 2026-11-19 · design source: the "ShiftCircle UI Design" canvas (a private Claude design artifact owned by the project lead). The six screen files in `screens/` are exact copies of that canvas at version `1795140897-e19c`.

## 1. What's in this folder

| File | What it is |
|---|---|
| `screens/Main.dc.html` | Supervisor · Planning board |
| `screens/MySchedule.dc.html` | Employee · My schedule (with overtime offer and shift planner) |
| `screens/Overtime.dc.html` | Supervisor · Overtime board |
| `screens/Rules.dc.html` | Rules admin · Decision table and publish checks |
| `screens/Reports.dc.html` | Reports · Planned vs actual, overtime, hours by pay code |
| `screens/WallDisplay.dc.html` | TV wall display · Today's coverage (1920×1080) |
| `screens/canvas.json` | Canvas layout index (artboard sizes and order) |

**About the file format:** each `.dc.html` is a "Design Component": plain HTML markup plus a small `class Component extends DCLogic` script whose `renderVals()` returns the sample data. They're meant for the design canvas runtime (`support.js`, not included), so **they won't render on their own** in a browser. Treat them as an exact, readable reference for layout, copy, colours, sample data and interactions. Build the real screens in React (§7). Reading tips: `<sc-for list="{{x}}">` = a loop, `<sc-if value="{{x}}">` = a condition, `{{x}}` = a value from `renderVals()`, `<helmet><style>` = the screen's CSS.

**Shift times changed after the mockups were drawn:** the mockups show 12 h shifts as 07–19 / 19–07 (`D12` / `N12`); the defaults are now 00–12 / 12–24 (`A12` / `P12`) and 16 h shifts (20:00–12:00) are regular shifts (ADR-015). Overtime is a pay-period status, not a shift type (ADR-016), so the mockups' "OT" chips should read "extra". Use the new times and chip codes when building. The sample data in these screens is **illustrative**. Where it differs from the generator configuration in `docs/10-testing.md` (e.g. unit staffing numbers), the generator configuration wins.

## 2. Design basis: Government of Saskatchewan digital standard

Colours, font and button conventions follow the Government of Saskatchewan's published digital design standard for saskatchewan.ca ("Saskatchewan.ca Elements" v4.0, 2021). **No government logo, wheat sheaf or coat of arms is used**, because those would present the prototype as an official service. Every screen's footer says "Not an official Government of Saskatchewan service · fictional, synthetic data only". A pilot would get the approved header and logo from the ministry's digital team.

## 3. Design tokens

### 3.1 Colour

| Token | Hex | Standard name | Used for |
|---|---|---|---|
| `brand.primary` | `#046A38` | Football Green | Top bar, active nav item, pass/approved states (text) |
| `brand.accent` | `#FBDD40` | Canola | Primary (yellow) button, 4px rule under the top bar, logo ring, "short" state on wall display |
| `brand.link` | `#00558C` | Midnight Sky | Links, secondary button text/border, night shifts, "next shift" card, chart "actual" |
| `brand.linkHover` | `#003D66` | (darker Midnight Sky) | Link hover |
| `support.lentils` | `#64A70B` | Lentils | Overtime offer border/accent, overtime bars |
| `support.buffaloGrass` | `#A4D65E` | Buffalo Grass | Overtime shift chip |
| `support.flax` | `#B9D9EB` | Flax | Chart "scheduled" bars; evening tint base |
| `text.primary` | `#333333` | Graphite | Body text, headings |
| `text.secondary` | `#555B61` | (between Graphite and Smoke) | Labels, help text (≥ 4.5:1 on white and on Cloud) |
| `text.muted` | `#666666` | Smoke | Off-days, disabled-looking labels |
| `border` | `#E1E3E6` | Seagull | Card and table borders |
| `border.input` | `#8E959C` | — | Form control borders (≥ 3:1 non-text contrast) |
| `bg.page` | `#F5F5F5` | Cloud | Page background |
| `bg.surface` | `#FFFFFF` | — | Cards, tables, nav |
| `footer.bg` / `footer.text` | `#2C3136` / `#CCCCCC` | Short footer | Footer bar |
| `status.block` | bg `#FDE8E8`, text `#A30000` | — | Blocked (rule failure). **Deviation:** the standard's error red `#EE0000` is under 4.5:1 on white, so text uses `#A30000`. |
| `status.warn` | bg `#FDF1B0`, text `#5A4500` | Canola tint | Warning, "approaching overtime", coverage gap |
| `status.pass` | bg `#E3F0E8`, text `#046A38` | Green tint | Pass, eligible, locked/approved |
| `status.info` | bg `#EEF0F2`, text `#444A50` | — | Info, skipped (neutral), over-staffed |
| `status.under` | bg `#E8F1F8`, text `#00558C` | — | "Under" overtime threshold, coverage OK |
| `status.ot` | bg `#FDE2D4`, text `#8A2C00` | Overtime orange | "In overtime" (and the Overtime board's "Offers sent"). Orange since PR-A (A4): the old green read as "good". |

**Rule from the standard:** Living Skies `#41B6E6` and Canola can't be used together. Because Canola is the main button colour, Living Skies isn't used.

### 3.2 Shift chips (always labelled with text, never colour alone)

| Shift | Chip | Colours |
|---|---|---|
| Day 8 h (07–15) | `D` | bg `#FDF1B0`, text `#333333` |
| 12 h afternoon–evening (12–24) | `P12` | bg `#D5E8F3`, text `#00558C` |
| Evening 8 h (15–23) | `E` | bg `#D5E8F3`, text `#00558C` |
| Night 8 h (23–07) / 12 h overnight–morning (00–12) | `N` / `A12` | bg `#00558C`, text `#FFFFFF` |
| 16 h shift (20:00–12:00), historical only (L16 retired, ADR-029) | `L16` | bg `#E1E3E6`, text `#333333`, 1px border `#8E959C` |
| Extra shift picked up beyond the roster | `E · extra`, `L16 · extra` | bg `#A4D65E`, text `#1F2A0A` |
| Overtime offered (pending) | `E · offer` | white, 2px dashed `#64A70B`, text `#2F5206` |
| Proposed but blocked | `! D proposed` | white, 2px dashed `#C40000`, text `#A30000` |
| Sick | `Sick` | white, 1px dashed `#C2410C`, text `#9A3412` |
| Vacation | `Vac` | bg `#E3F0E8`, text `#046A38` |
| Other absence (FR-51) | `Other` | bg `#EEF0F2`, text `#444A50` |
| Off | `Off` | no fill, text `#666666` |
| Worked (actual recorded) | prefix `✓ ` | — |

**Overtime is shown per officer, not per shift:** the pay-period hours with the Under / Approaching / In overtime pill (threshold 80 h by default, P-01).

### 3.3 Typography, spacing, shape

- **Font:** Source Sans 3 (the current Google Fonts name of Source Sans Pro, the standard's only approved font), fallback `sans-serif`. Weights 300, 400, 600, 700.
- **Sizes:** page title (H1) 36px light (300); section titles 15–18px bold; body 13–14px in dense tables, 15px for prose; labels 12px semibold. Use tabular numerals (`font-variant-numeric: tabular-nums`) for all figures.
- **Spacing:** 4px base; page padding 24px; card padding 16px; gaps 8 / 12 / 16 / 20px.
- **Radius:** buttons **2px** (per standard); cards 10px; chips 6px; status pills 12px.
- **Touch targets:** at least 44×44px for every button, link, checkbox label and nav item.

### 3.4 Buttons (per the standard)

| Variant | Style | Rule |
|---|---|---|
| Primary (yellow) | bg `#FBDD40`, text `#00558C`; hover bg `#00558C`, text white | **One per screen**, for the main action |
| White | white bg, `#00558C` text and 1px border; hover bg `#E8F1F8` | Secondary actions |
| Danger outline | white bg, `#A30000` text, `#C40000` border | Emergency override only |

## 4. Shared layout

- **Top bar** (green `#046A38`, 4px Canola bottom border): ShiftCircle mark (Canola ring with a white dot; our own mark, not a government symbol) and name; facility line "Prairie Provincial Correctional Centre · prototype, fictional data"; the current date/time; a role chip, e.g. "Supervisor · M. Ellis (mock sign-in)".
- **Side navigation** (white, 220px): role-specific items; active item green with white text. The **supervisor** sees Planning board, Overtime, Reports, Rules, Wall display, Employee view, and Time & attendance (not yet designed). The **employee** sees My schedule, Propose shifts, My hours, and (demo only) Supervisor view.
- **Content:** fluid, page padding 24px, sections as white cards.
- **Footer** (`#2C3136`, text `#CCCCCC`): "ShiftCircle prototype · AI Solutions Architect assessment" and "Not an official Government of Saskatchewan service · fictional, synthetic data only".
- **Responsive:** side nav + content is a wrapping flex row (content `flex: 999 1 560px`), so on tablets and phones the nav stacks above the content. Wide tables sit in horizontally scrolling boxes. KPI tiles wrap (min ~170px). The wall display is a fixed 1920×1080 layout.

## 5. Screens

### 5.1 Planning board (supervisor) — `screens/Main.dc.html`
- **Route:** `/planning?unit=&week=&view=&density=` · **API:** `GET /schedule`, `POST /rule-checks`, `POST/PATCH/DELETE /assignments`, `POST /schedule-periods/{id}/publish`
- **Header:** title, unit and range, publish state ("Published, 3 unpublished changes"); unit select; Previous / Next / Today; Rules help; "Publish period" (yellow).
- **View and density (A1):** a **Week / Pay period / Month** toggle (`?view=period|month`; Week, the default, writes no param) and **Comfortable / Compact** (`?density=`; a week opens comfortable, a pay period or month compact). `?week=` (a Monday) stays the focus, so switching views keeps the dates and the planner's links still work; a malformed `?week=` falls back to the demo week. Pay periods are 14 days from 12 Oct 2026; a month is at most 31 days (the API limit).
- **Publishing is per roster period.** The publish state and the Publish button show only when the range on screen is one `schedule_period` (always in Week; in Pay period only where the data has 14-day periods, as a committed 2027 plan does). Otherwise the header says "Spans two roster weeks" / "Spans several roster periods: open the Week view to see and publish each one" instead of a state.
- **KPI tiles:** coverage gaps, officers in overtime, approaching overtime, rule warnings, overrides this period. Compact shows the same figures as one strip of chips; in Month the overtime note names the pay period of the first day, and overrides read "Overrides in view" (the API counts them over the range).
- **Roster grid:** columns = officer (name, rotation, qualification badges) · **Shifts · h this view** · pay-period hours with overtime status pill · one column per day (today highlighted; past days marked "Actual"; weekends shaded; a heavier line before each Monday). Top rows = coverage per block (Days / Evenings / Nights) showing `scheduled / required` plus actual or "short 07–12" / "+1 over", as heat: blue met, yellow 1 under, orange 2+ under, grey over (compact shows only `3/5`). Officer rows = shift chips (§3.2); an empty day reads "Off" (compact "·"). Footer row = **On duty · hours** per day (shifts by their start day; offers and blocked proposals not counted). Key/legend below. The quarter planner's Roster tab uses the same grid.
- **Rules help (button, top of the board):** opens a dialog with what Block / Warn / Info / Pass mean, how to use the rule check, and the main rules with their limits and results read live from the published rule tables (U-01 to U-14 and P-01, plus a link to the Rules screen for the roles that have one). The planner sees the outcomes and the usage line only.
- **Rule check panel:** shows the selected or proposed change, an overall result banner ("Blocked: 2 rules fail"), each rule result (outcome pill, rule code and name, plain message, source and evidence shift), "9 other rules passed · rule tables v7". Actions: "Find eligible officer" (→ Overtime), Cancel, "Emergency override…" (opens a reason dialog, min 10 characters).
- **Recent activity:** time-stamped audit lines.
- **States:** loading skeleton for the grid; empty unit ("No officers assigned to this unit"); preview pending; saved; 412 conflict ("Someone changed this shift. Reload to see the latest."); 403/404.
- **Interactions to build:** click an empty cell → choose a shift template → live rule preview → save; click a chip → move/cancel; drag and drop is a "could".

### 5.2 My schedule (employee) — `screens/MySchedule.dc.html`
- **Route:** `/me/schedule` · **API:** `GET /me/schedule`, `GET /me/offers`, `POST /offers/{id}/accept|decline`, `POST /rule-checks`, `POST /proposals`
- **Top cards:** next shift (blue card), pay-period hours with a progress bar (worked vs still scheduled), overtime this quarter and place on the overtime list.
- **Month calendar:** Mon–Sun grid, 6 weeks; out-of-month days dimmed; today outlined in blue; chips as §3.2; ‹ Oct / Dec › navigation.
- **Overtime offer card** (green border): shift, unit, who offered and when; "Rules OK for you" with rest and hours facts; Accept (yellow) / Decline (white) → confirmation message ("Accepted. Your supervisor will confirm the assignment.").
- **Propose shifts:** draft items, each with a live rule result (Passes / Warning + reason); note to supervisor; "Send to supervisor" and "Add a shift".
- **Privacy:** employees never see colleagues' hours, absences or overtime totals.

### 5.3 Overtime board (supervisor) — `screens/Overtime.dc.html`
- **Route:** `/overtime?shift=` · **API:** `GET /open-shifts`, `GET /open-shifts/{id}/candidates`, `POST /open-shifts/{id}/offers`, `POST /open-shifts/{id}/assign`
- **Left:** open-shift cards (when, unit, status pill, reason), selectable; "+ Create open shift".
- **Right:** selected shift; a box explaining the fair-distribution order (rule O-02, version shown); a **ranked table**: rank, officer and qualifications, overtime hours this quarter, seniority, rule check for this shift (Eligible / Eligible · warning / Skipped · rule code / Not available / Already scheduled, with a one-line reason), and a "Select" checkbox only for eligible rows. Skipped officers "keep their place".
- **Footer actions:** note on ordered overtime (O-04); "Assign directly…" (white); "Offer to selected (n)" (yellow).
- **Offer history:** time, who, status pill.

### 5.4 Rules (rules admin / approver) — `screens/Rules.dc.html`
- **Route:** `/rules/{version}/{table}` · **API:** `GET /rule-sets…`, `PUT …/rows`, `POST …/build|submit|approve|publish`
- **Header:** live version and draft version. The design file also shows "Download as Excel" and "Upload Excel…": **future work, not built**; the built screen leaves them out rather than show dead buttons (docs/10 §8).
- **Left:** list of the 8 rule tables with row counts; active table highlighted.
- **Decision table:** one row = one rule: On checkbox · rule code · "After this kind of shift…" select · "…needs at least [n] h off" number input (min enforced, e.g. U-01 ≥ 8) · "If not" select (Block/Warn/Info) · Override select · Source pill (Employment Act = green, Placeholder = amber). Changed rows tinted yellow; selected row tinted blue.
- **Plain-language panel:** the generated sentence for the selected row, updating as values change, plus "Changed in draft: live v7 says 12 h".
- **Publish checklist:** Edited ✓ → Values checked ✓ → Built by the rules engine ✓ → Test scenarios ✓ → Impact on published roster (!) → Second approver → Go live, each with detail. "Submit for approval" (yellow). Note on maker/checker.
- **Version history** and "Roll back to an earlier version…".
- **Not yet designed:** the approver's review screen (before/after diff, impact, Approve/Reject). Reuse the same table read-only with change highlighting.

### 5.5 Reports — `screens/Reports.dc.html`
- **Route:** `/reports/{coverage|hours|overtime}` · **API:** `GET /reports/*`, `GET /pay-periods/{id}/payroll-export`
- **Tabs:** Coverage / Hours / Overtime. **Filters:** from, to, unit, officer; "Export CSV".
- **KPI tiles:** scheduled hours, worked hours, overtime hours, blocks fully covered, emergency overrides.
- **Coverage chart:** weekly grouped bars (scheduled = Flax, actual = Midnight Sky) as % of required, with a dashed 100% line; **the axis starts at 94% and says so**; future week marked planned. Needs an accessible text alternative (the mock has an `aria-label` summary; the build should also offer the data table).
- **Overtime by officer:** top 8 horizontal bars with hours; facility average.
- **Hours by officer** for a locked pay period: scheduled, worked, regular, OT 1.5×, OT 2×, sick, vacation, worked − scheduled; "Locked" pill; "Payroll export (CSV)" (yellow).
- **Employee version:** same screen, own data only, no officer filter.

### 5.6 Wall display (TV) — `screens/WallDisplay.dc.html`
- **Route:** `/display` (signed in as the DISPLAY device account) · **API:** `GET /display/today` every 60 s
- **Fixed 1920×1080, dark theme:** bg `#1E2327`, cards `#2C3136`. Large clock and date; title "Today's coverage" with the current block.
- **Six unit cards:** unit name, status pill (Covered = green, Short = Canola with dark text, +1 extra = Buffalo Grass), on-duty count `n / required` at 112px, next block's count.
- **Side panels:** open shifts in the next 48 h; facility totals (on duty, on overtime, gaps tonight).
- **Privacy:** counts only, **no names**, because it's a shared screen (stated in the footer line).

## 6. Screens not yet designed (build from the patterns above)

| Screen | Route | Notes |
|---|---|---|
| Shift types (setup) | `/rules/{version}/shift-types` | Grid of shift templates (code, label, start, length, regular/overtime-only, chip style, active, effective date). Edited in a rule-set draft and published through the same build → approve flow (ADR-015). Shows a warning if a change would alter rest outcomes on the published roster (dry run). |
| Sign-in (mock) | `/login` | List of demo users with roles; clear "mock sign-in, demo only" banner |
| Time & attendance | `/time?period=` | Pay-period picker; table of scheduled vs actual per officer per day; mark worked / adjust times / absence type; "Lock pay period" (yellow) with confirmation; unlock needs a reason |
| Proposals inbox | `/proposals` | Supervisor list of employee proposals; per-item accept/decline with rule results |
| Rule version review | `/rules/{version}/review` | Approver's before/after diff, build and dry-run report, Approve / Reject with comment |
| Tablet layouts | — | Same screens; nav stacks; verify roster scroll and 44px targets at 768px |

## 7. Implementation guidance (React + TypeScript + MUI)

- **Theme:** build one MUI theme from §3 (palette, typography with Source Sans 3, `shape.borderRadius` 2 for buttons via component overrides, chip and pill variants). Don't hard-code hex values in components.
- **Components to create:** `AppShell` (top bar, nav, footer), `ShiftChip`, `StatusPill`, `RuleResultList`, `CoverageCell`, `KpiTile`, `RosterGrid`, `RankedCandidateTable`, `DecisionTableEditor`, `PublishChecklist`, `CoverageChart`.
- **Data:** TanStack Query per endpoint in `docs/07-api-spec.md` §5; the preview → save → 422 → acknowledge/override flow should be one reusable hook (`useRuleCheckedMutation`).
- **Copy:** keep the plain, specific wording from the mockups (e.g. "Only 7 hours' rest after the 12 h shift ending Fri 24:00"). Messages come from the API's rule results, not hard-coded in the UI.
- **Accessibility:** real buttons, links and labelled inputs; status never shown by colour alone; focus visible; tables have header cells; target WCAG 2.1 AA. Run axe in tests (see `docs/10-testing.md`).

- **Release 3 notes:** a unit can be closed from a date (Units, planner only). The board and the planner roster show a plain note for a closed unit and read `Closed` on its closed days; Reports → Coverage lists the closure under the chart; the wall display says `<unit> is closed today` with the api's reopening line; the Quarter plan shows Shifts in closed units and a Staffing tile/panel. No shift or history is deleted by a closure.
