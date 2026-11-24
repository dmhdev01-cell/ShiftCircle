# ShiftCircle UI: facility planner screens

**Status:** v1.0 · 2026-11-21 · from `dev.design` for `dev.build2` (web) and `dev.build` (api).
**Read with:** `docs/ui/README.md` (tokens, shared layout, components) and `docs/ui/build-notes.md` (shift vocabulary, coverage cells, existing screens). Design basis: `PHASE3-PLAN.md` as changed by `P3-AMENDMENTS.md` (mission folder), and ADR-026 once written.
**Precedence:** an ADR wins over this file; this file wins over guesswork. If the api ships a different shape, keep the **meaning** of each field in §10 and tell `dev.design`.

Everything here uses the shared layout (README §4), the Saskatchewan tokens (README §3), Source Sans 3, chips that always carry text (README §3.2), **one yellow button per screen**, 44 px targets, the footer line, and **no logo**. No rule codes on screen: plain words come from the api (`message`, `ruleName`, `label`), as on the board.

**Build order:** §2 scorecard first (amendment 8), then §3 landing and generate, §6 commit, §4 gaps and roster, §5 compare, §7–8 preferences. Cut order from the bottom follows amendment 7: preference entry (§8) before compare depth (§5 "by unit").

---

## 1. Who, where, and the window

| Item | Value |
|---|---|
| Role | New `PLANNER`: facility-wide, all six units. Supervisors stay unit-scoped. The planner's nav is Quarter plan, Preferences, Units, Planning board (no Reports: the reports api is supervisor/auditor only, docs/09 §2). |
| Nav (PLANNER) | **Quarter plan** (`/planner`) · **Preferences** (`/planner/preferences`) · **Units** (`/planner/units`) · **Planning board** (`/planning`, read-only, §11 Q1) · About & version |
| Nav (EMPLOYEE, and supervisors' Employee view) | no new item: preferences are a card on **My schedule** (§8) |
| Sign-in landing | PLANNER → `/planner` (add to the build-notes §2.1 list) |
| Role chip | "Planner · <name> (mock sign-in)" |
| Routes | `/planner?tab=scorecard\|gaps\|roster\|compare&unit=<id>&week=<YYYY-MM-DD Monday>` · `/planner/preferences?unit=<id>` |
| Window | **The next quarter**: whole two-week pay periods from **Mon 4 Jan 2027** (amendment 2). dev-build picks 6 periods (4 Jan – 28 Mar 2027) or 7 (4 Jan – 11 Apr 2027). The UI never hard-codes it: it shows `window.from`, `window.to` and `window.periods` from the api. Copy below uses the 7-period window as the example. |

The tab, unit and week live in the URL so Back, reload (ADR-025 return path) and "Show week" all work.

**Words used on screen** (same everywhere; never codes):
- **Night shift** = N8, A12 or L16 (amendment 4; L16 is retired, so it appears only on old history). Tile notes and explanations say "night shifts (8 h nights, 12 h 00–12 and 16 h shifts)" the first time on a screen, then "night shifts".
- **Patterns:** "Rotating 5 on, 2 off (weekends rotate)" (8 h default) · "Fixed 5 on, 2 off" · "7 on, 3 off" · "4 on, 4 off" (12 h) · "1 on, 2 off" (16 h). Shown in the roster grid's officer column, the same place as the board's rotation line.

---

## 2. Scorecard (first tab of a draft; build this first)

The scorecard answers one question: **is this draft good enough to commit, and what will a supervisor still have to fix?** It sits at the top of the Draft state (§3.3), above the tabs' other content, and is the default tab.

### 2.1 Layout

```
┌ Quarter plan ─────────────────────────────── [Seed] [Generate again] [Discard draft…] [Commit plan…] ┐
│ all 6 units · 4 Jan – 11 Apr 2027 · 7 pay periods     [Draft] Generated 21 Nov 09:14 · seed 20261001 · 2.4 s │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Scorecard │ Gaps (37) │ Roster │ Compare                                                             │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Coverage gaps] [Rule warnings] [Preferences met] [Night fairness] [Overtime built in] [Generated in] │  ← 6 tiles
│ (explanation panel for the open "What this means")                                                   │
├──────────────────────────────┬───────────────────────────────────────────────────────────────────────┤
│ Night shifts by seniority    │ Preferences by kind                                                   │
│  bars + newest-first check   │  table with bars                                                      │
│  + nights against a wish     │                                                                       │
├──────────────────────────────┴───────────────────────────────────────────────────────────────────────┤
│ Rule warnings by kind (collapsed: "Show 112 warnings")                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Desktop: tiles in one row of six (wrap at min ~200 px); the two panels side by side (each `flex: 1 1 420px`); warnings full width. Tablet 768 px: tiles two per row, panels stacked, nothing scrolls sideways at page level.

### 2.2 Tiles

Reuse `KpiTile`. Each tile: label (12 px semibold), big figure (tabular numerals), a one-line note, and a **"What this means"** text button (`aria-expanded`, `aria-controls`) that opens the explanation in one panel under the tile row (one open at a time; pressing it again or Esc closes it and keeps focus on the button).

| # | Label | Figure | Note | "What this means" (exact copy) |
|---|---|---|---|---|
| 1 | **Coverage gaps** | `37` | "block-days short, of 1,764" | "A block (Day 07–15, Evening 15–23, Night 23–07) is short when any hour in it has fewer officers than the unit needs. The planner never breaks a blocking rule to fill a gap, so the gap stays visible for overtime or a supervisor to fill. See the Gaps tab." |
| 2 | **Rule warnings** | `112` | "no blocked shifts" | "Every shift in the draft passed the same rule check as the planning board. Shifts a rule blocks are never placed; they become gaps. Warnings don't stop a plan, but you'll be asked to accept the list when you commit." |
| 3 | **Preferences met** | `78%` | "412 of 530 wishes" | "Officers can ask for a shift length, any mix of times of day and days off. These are wishes, not guarantees: the planner meets them where staffing and the rules allow." |
| 4 | **Night fairness** | `Held` / `Not held` | "night shifts by seniority, below" | "Night shifts are 8 h nights, 12 h 00–12 shifts and 16 h shifts. In each unit, officers who asked for nights get them first, most senior first. The rest go to the newest officers first. A senior officer works nights they didn't ask for only when no newer officer in the unit can take the shift." |
| 5 | **Overtime built in** | `640 h` | "18 officers over 80 h in a pay period" | "Hours over 80 in a two-week pay period are paid as overtime. 8-hour officers work 5 on, 2 off: exactly 80 hours. 12-hour patterns give 72 to 96 hours a pay period and 16-hour patterns 64 to 80, so some overtime is built in before anyone picks up an extra shift." |
| 6 | **Generated in** | `2.4 s` | "seed 20261001" | "The planner follows fixed steps; it isn't AI. The same seed and the same data always give the same plan, so a plan can be checked and repeated." |

Tile tone (4 px left border and a text pill in the note, never colour alone): Coverage gaps `warn` above 0, `pass` at 0 ("Fully covered"). Rule warnings `warn` above 0, `pass` at 0. Night fairness `pass` "Held" / `warn` "Not held". The others `info`.

### 2.3 Night shifts by seniority (panel)

H2 **"Night shifts by seniority"**. One row per band from the api (thirds by seniority date, labels from the api):

- "Newest third · hired 2020–2025 · 33 officers" — bar + **"61% of night shifts"**
- "Middle third · hired 2013–2019 · 33 officers" — bar + **"29%"**
- "Most senior third · hired 2006–2012 · 34 officers" — bar + **"10%"**

Bars Midnight Sky (the nights colour). Under the bars:

- **The check**, pill + the api's sentence: `pass` "Newest first held in all 6 units." or `warn` "Not held in Control: R. Okafor (since 2009) has 6 night shifts not asked for while D. Clarke (since 2024) could have taken them." The api writes the sentence (amendment 4 property); the UI doesn't compose it.
- **Nights against a wish** (amendment 4), a small table: band · "officers who asked to avoid nights" · "of them, given night shifts" · "night shifts given", e.g. "Newest third · 14 · 9 · 41". One line under it: "Newest officers take nights first, so their wish to avoid nights is met least often."

`aria-label` summary on the bar group plus a visually hidden table (as `CoverageChart` does).

### 2.4 Preferences by kind (panel)

H2 **"Preferences by kind"**, table with header cells:

| Kind | Asked | Met | Not met | Met |
|---|---|---|---|---|
| Shift length | 100 | 88 | 12 | 88% |
| Time of day | 230 | 162 | 68 | 70% |
| Days off | 200 | 162 | 38 | 81% |

The last cell has a bar (Flax track, Football Green fill) **and** the percentage text. Link under the table: **"See everyone's preferences"** → `/planner/preferences`.

### 2.5 Rule warnings by kind (panel)

Collapsed: a white button **"Show 112 warnings"** (`aria-expanded`). Expanded: one group per plain rule name with its count ("Fewer than 12 hours between shifts · 74"; "Week over 48 hours · 38"). A group expands to up to 20 lines, "Unit B · Sat 9 Jan · K. Lindqvist · 9 h between shifts" with **Show week** (§4.1 behaviour), then "and 54 more". This is the same list the commit dialog asks the planner to accept (§6.2), so it's worth reading here first.

With per-officer patterns and every 8 h officer on the default rotating pattern there should be no week-hours warnings for 8-hour officers (amendment 1). If an officer is set to 7 on, 3 off on Preferences, its warnings show here honestly.

---

## 3. Planner landing: `/planner`

### 3.1 Header (all states)

- H1 **"Quarter plan"**.
- Line under it (`text.secondary`, 14 px): **"Prairie Provincial Correctional Centre · all 6 units · 4 Jan – 11 Apr 2027 · 7 pay periods"** (window from the api; build-notes §1.2 format).
- **Status pill** and its line:

| State | Pill | Line beside it |
|---|---|---|
| No draft | `No draft` (info) | "Nothing generated for this quarter yet." If a plan was committed earlier: "Last committed 21 Nov 09:40 by R. Planner." |
| Draft | `Draft` (warn) | "Generated 21 Nov 09:14 by R. Planner · seed 20261001 · took 2.4 s" |
| Committed | `Committed` (pass) | "Committed 21 Nov 09:40 by R. Planner · 4,212 shifts written" |

A discarded draft shows as No draft; the discard is in the audit log, not here.

### 3.2 Actions (right of the header; wrap below on tablet, yellow last)

| State | Yellow (one) | White |
|---|---|---|
| No draft | **Generate draft** | — |
| Draft | **Commit plan…** (§6) | Generate again · Discard draft… |
| Committed | none (nothing waiting) | Generate a new draft |

- **Seed** number input left of Generate, labelled "Seed", prefilled with the api's `defaultSeed` (20261001), helper **"Same seed, same plan."** Whole numbers only; otherwise Generate is disabled with the helper "Enter a whole number".
- **No facility pattern picker.** Every officer has their own shift pattern (option C): an 8-hour officer's pattern is set by the planner on the Preferences page (rotating 5/2 default, fixed 5/2, or 7/3); 12-hour officers keep the crew's 4 on, 4 off. **Generate draft** uses each officer's own pattern and sends only the seed. The api still accepts `pattern8h` for one release, but the screen never sends it.
- **While generating:** the button shows a spinner and "Generating…", disabled; `role="status"`: **"Building a plan for 100 officers and checking every shift against the rules. This usually takes a few seconds."** When done, focus moves to the status line and the Scorecard tab opens.
- **Generate again / Generate a new draft** when a draft exists: dialog **"Replace this draft?"** · "The current draft and its scorecard are replaced. Nothing on the planning board changes." · Cancel (white) · **Replace draft** (yellow inside the dialog).
- **Discard draft…**: dialog **"Discard this draft?"** · "The draft is removed. Nothing on the planning board changes. The discard is recorded in the audit log." · Cancel · **Discard draft** (white; the danger outline is reserved for emergency override, README §3.4).

### 3.3 Body by state

- **No draft (empty):** one white card, max 640 px: **"No plan for this quarter yet."** · "Generate a draft to see coverage, rule warnings, preferences and fairness before anything changes. A draft never reaches the planning board until you commit it."
- **Draft:** tabs **Scorecard** (default, §2) · **Gaps (37)** (§4.1) · **Roster** (§4.2) · **Compare** (§5). MUI `Tabs`; arrow keys move; the tab writes `?tab=`.
- **Committed:** the success banner (§6.4), then the same tabs **read-only** for the committed plan. Compare is hidden with the line "Comparison is shown while a plan is a draft."

---

## 4. Draft review: Gaps and Roster

### 4.1 Gaps tab

- Intro: **"37 block-days are short. The planner left them open rather than break a blocking rule."**
- **Gaps by week and unit** (H2, fit-gap i-6 / planux A7): a strip with weeks across (the 14 Mondays, "4 Jan" … "5 Apr") and units down. Each cell is the unit's short block-days that week. It always shows the number, with the colour as a second cue: 0 subtle, 1–2 warn tint, 3+ block tint. A cell with gaps is a button (`aria-label="Escort & transport, week of 11 Jan: 5 gaps. Show week"`) that opens that unit and week on the Roster tab. The strip follows the Unit and Block filters and scrolls sideways inside the card on tablet.
- Filters: Unit (All + six) · Block (All, Days, Evenings, Nights). Local state. They filter the strip and the runs.
- A summary line: "38 short block-days in 7 runs: the same unit and block on days in a row."
- **Runs table** (`aria-label="Gaps grouped into runs"`): one row per run of the same unit and block on consecutive days.

| Column | Example | Notes |
|---|---|---|
| Unit | Escort & transport | |
| Days | Wed 13 – Sun 17 Jan · "5 days" | one day reads "Sat 16 Jan" |
| Block | Evenings 15–23 | |
| Staffed / needed | `2–3 / 4` | a range when the run's days differ |
| Short by | `1–2` | needed − staffed, as a range |
| Why | "No eligible officer was free without breaking a blocking rule. A supervisor fills it on the planning board." | The api's one generic reason ("No eligible officer left without a Block rule…") in plain words. It claims no cause the api did not record. Any other reason is shown as sent; "—" if none |
| | **Show week** | white button on the run's first day, `aria-label="Show week of 2027-01-13 for Escort & transport"` |

- Sort: the run's first date, then unit, then block (Day, Evening, Night).
- **Show week** opens the Roster tab with `unit` and `week` (that date's Monday) in the URL, scrolls to the grid, moves focus to the roster heading, and outlines that day's coverage cell for 3 s (2 px Midnight Sky; no animation under `prefers-reduced-motion`).
- Empty: **"No coverage gaps. Every hour of every block meets its staffing."** (pass tint).

### 4.2 Roster tab

The draft week by week, all units, read-only. Reuse `RosterGrid` and the board's week navigation (dev-build2, `98e6788`).

- **Controls:** Unit select (default: the first unit with a gap in the shown week, else Unit A). Its options read "Escort & transport · 5 gaps this week, 38 in the quarter", or "· no gaps this week" for a unit with none in the quarter. Then **Go to week**: a select of the 14 weeks, "Week 2 · 11 – 17 Jan 2027 · 5 gaps in all units". Then **Previous week** · "4 – 10 Jan 2027" · **Next week** · **First week** (in place of "Today", which is outside the window). A week across two months names both ("29 Mar – 4 Apr 2027"). Previous is disabled on the first week ("Start of the plan"), Next on the last ("End of the plan").
- **All-units coverage strip** (H2 "All units · 4 – 10 Jan 2027" with a **Show all units** / **Hide all units** text button, `aria-expanded`). The table is **collapsed by default** (planux Q3). When open: rows = 6 units × 3 blocks (unit name spans its rows), columns = 7 days, cells = `CoverageCell` (lowest/required, "short 15–17", tooltip with hourly counts). Each unit name is a button that sets the Unit select.
- **Note above the grid** (`role="note"`, info tint): **"Draft · not on the planning board yet. Officers and supervisors can't see it until it's committed."**
- **Grid:** `RosterGrid` with the draft payload (§10.4), read-only (no `onEmptyCell`, no `onPickChip`; chips keep their time tooltip). A chip whose officer, date and shift code appear in `/planner/drafts/{id}/warnings` has a **⚠** after it (planux A8): `role="img"`, named "Rule warning: Week over 48 hours: 62 hours this week". It takes focus, and its tooltip opens on focus and on hover. The api keeps one warning per officer per rule, so only that shift is marked. Officer column shows the officer's own pattern in words (§1), not one facility pattern. Pay-period column shows the draft's hours and the overtime pill. Day tags read **"Plan"**.
- **Look-back days:** the first week's rest and consecutive-day checks read the committed days before 4 Jan (amendment 2), but the grid shows only window days. Under the grid: "Rest and consecutive days at the start of the plan count the shifts already committed for late December."
- **Legend** (the board's key): `D` Day 8 h · `E` Evening 8 h · `N` Night 8 h · `A12` 12 h 00–12 · `P12` 12 h 12–24 · `L16` 16 h 20:00–12:00 · `Off` · "Night shifts: N, A12, L16" · coverage "4 / 5 short 15–17 = fewest officers in any hour / needed" · "Overtime = pay-period hours over 80 h (status pill)". No extra, offer, sick or vac chips: a draft has none.

---

## 5. Compare: draft vs committed

Purpose: **"What changes if I commit?"** For the same window. Because the window is a future quarter, the first time there is usually **nothing committed** in it.

- **Nothing committed** (`committed: null`), the usual first case: the tab shows one card: **"Nothing is on the planning board for 4 Jan – 11 Apr 2027 yet. Committing writes the whole draft."** and the draft's own figures in a single column (same rows as below).
- **An earlier plan was committed** (e.g. the second run in a demo): intro **"The draft against the plan already on the board for 4 Jan – 11 Apr 2027."** and the table:

| Measure | On the board now | Draft | Change |
|---|---|---|---|
| Shifts | 4,190 | 4,212 | +22 |
| Scheduled hours | 42,880 h | 43,104 h | +224 h |
| Block-days short | 52 | 37 | **15 fewer** · `better` |
| Rule warnings | 140 | 112 | **28 fewer** · `better` |
| Officers over 80 h in a pay period | 21 | 18 | **3 fewer** · `better` |
| Overtime hours built in | 702 h | 640 h | **62 h less** · `better` |
| Preferences met | 74% | 78% | **+4 points** · `better` |
| Night shifts to the newest third | 58% | 61% | +3 points |

- Highlighting: the Change cell of a better or worse row gets a pill with the **word** (`pass` "better", `warn` "worse"); neutral rows get none; unchanged rows read "same" in `text.secondary`. Direction comes from the api (`direction`, §10.5), not the UI.
- Supervisors' edits since the commit count as "on the board now" (the api reads current state).
- **By unit** (Should, collapsed "Show by unit"): unit × shifts and block-days short, now vs draft.

---

## 6. Commit flow (amendment 5)

### 6.1 Before

**Commit plan…** (yellow) is enabled in Draft state. Disabled, with the reason beside it, while the draft is generating ("Wait for the draft to finish"). Gaps and warnings don't disable it: gaps are filled later, warnings are accepted in the dialog.

### 6.2 Confirm dialog: one decision over the listed warnings

Title **"Commit the quarter plan?"** Width 720 px (full width minus 16 px on tablet). Body, figures from the api's commit preview (§10.6):

> This writes **4,212 shifts** for **100 officers**, **4 Jan – 11 Apr 2027**, to the planning board. *(If an earlier plan is committed: "It replaces the 4,190 shifts of the plan committed on 21 Nov.")*
> Every shift is checked by the rules again as it's written. If any shift is blocked, **nothing is written**.
> **37 block-days stay short.** Fill them from the Overtime board after committing.

Then H3 **"Rule warnings in this plan (112)"** and a scrolling list (max-height 280 px, `tabindex="0"`, `aria-label="Rule warnings in this plan"`), grouped by plain rule name with counts, each group listing its lines ("Unit B · Sat 9 Jan · K. Lindqvist · 9 h between shifts"). The whole list is there; nothing is hidden behind "and n more".

Then one checkbox, required: **"I've read these 112 warnings and accept them for this plan."** Under it (`text.secondary`): "This is recorded once in the audit log with the list. It isn't an override: no blocked shift is in the plan."

With **zero warnings** the list and checkbox are replaced by the line "No rule warnings in this plan." and nothing needs ticking.

Buttons: Cancel (white, initial focus) · **Commit plan** (yellow), disabled until the box is ticked (helper "Accept the warnings to commit"). While posting: "Committing…", both buttons disabled, Esc does nothing.

The checkbox state is sent with the draft's version (§10.6). If the warning count the api returns differs from the one shown (the draft changed), the commit is refused as stale (§6.3).

### 6.3 Refusals

The dialog closes; an alert card (block tint, `role="alert"`) appears above the tabs; the draft stays.

| api result | Title | Body | Action |
|---|---|---|---|
| **Stale**: 412, the draft's version no longer matches, or the committed state changed since generation | **"Not committed: things changed since this draft was made."** | "Someone committed or changed shifts in this window, or the rules changed, after the draft was generated. Nothing was written." Plus the api's reason in a second line if given ("Rules v9 went live at 10:02"). | **Generate again** (white) |
| **Blocked**: 422 with a failure list | **"Not committed: 3 shifts are now blocked."** | "Nothing was written." Then `RuleResultList` (compact), one row per failing shift: "Unit B · Sat 9 Jan · N. Thompson · D8 07:00–15:00" and the api's plain message. All failures listed (scrolling box if over 10). | **Generate again** (white) |
| **Locked**: 409 `LOCKED_PERIOD` (unlikely for a future window; kept for safety) | **"Not committed: part of the window is locked."** | "Pay period 4 – 17 Jan 2027 is locked, so its shifts can't change. Nothing was written." | Generate again |
| 409 already committed / replaced | **"This draft was already committed by R. Planner at 09:40."** (or "…was replaced by a newer draft.") | — | **Reload** (white) |
| 403 / 500 / network | as §9 | always ends "Nothing was written.": the commit is all-or-nothing | Try again |

There is no override here. Emergency overrides stay one shift at a time on the planning board (ADR-021, ADR-023).

### 6.4 Success

- Pill → **Committed**; `role="status"`: **"Committed. 4,212 shifts are on the planning board."**
- Banner (pass tint card, H2 **"Plan committed"**, focus moves to it): "Supervisors can now change shifts on the planning board. 37 block-days are still short: fill them from the Overtime board. 112 accepted warnings are recorded in the audit log."
- One link per unit, a wrapping row of white buttons: **"Open Unit A on the planning board"** … **"Open Escort & transport on the planning board"**, each to `/planning?unit=<id>&week=2027-01-04` (§10.8).

---

## 7. Planner edits patterns on `/planner/preferences`

- H1 **"Officer preferences"**; line: "What officers asked for, and whether the current draft meets it. The pattern is the planner's setting; officers change their wishes on My schedule."
- Filters: Unit (All + six) · "Find an officer" (name, client-side) · **Not met only** checkbox.
- Summary: "100 officers · 84 gave preferences · 16 gave none".
- Table (sticky header and first column, scrolls inside the card):

| Officer | Unit | Seniority | Shift length | Time of day | Days off | Pattern | In the draft |
|---|---|---|---|---|---|---|---|
| Ruth Okafor | Unit B | since 2009 | 12 h | Days | Sat, Sun | 4 on, 4 off (read-only) | `Met` (pass) |
| Devon Clarke | Unit A | since 2024 | 8 h | Days | — | **Pattern select** | `Partly met` (warn) · "time of day: 9 night shifts" |
| Sam Abara | Control | since 2016 | No preference | Nights | Wed | **Pattern select** | `Met` |

- **Pattern** (8 h officers): a select with the three patterns in words — "Rotating 5 on, 2 off (weekends rotate)" (default) · "Fixed 5 on, 2 off" · "7 on, 3 off". Saving uses `PUT /planner/preferences/{employeeId}/pattern`; success says **"Pattern saved. The next plan will use it."** and the row updates in place. The change does not touch an existing draft, exactly like a preference change.
- **Pattern** (12 h officers): plain words **"4 on, 4 off"**, no select, helper "A 12-hour officer keeps the crew's pattern."
- "In the draft" reads `No draft` (info) when there is none; "—" when the officer gave none.
- Sort: unit order, then seniority (oldest first). No sortable headers.
- Empty filter: "No officers match."
- Who: PLANNER only; others 403 (§11 Q2).
- **Add planned leave** (PR-D, fit-gap A9): an outlined button by the H1 opens a dialog: Officer (select, "Name · Unit", sorted by name), First day and Last day (date inputs bounded by the plan quarter), Type (radios Vacation · Sick · Other, each with its chip), the line "Type only: no reason or medical detail is recorded (privacy)" and a live summary ("Vacation for Nia Thompson: Mon 8 Feb 2027 – Sun 14 Feb 2027 (7 days)"). Checks before any call: an officer, both days, last ≥ first, inside the quarter, at most 31 days. Save sends one `POST /planner/absences` per day in order ("Saving day 3 of 7…"). All saved: the dialog closes and a pass status line says what was recorded, that each day is in the audit log as "Absence recorded", and to generate again. A day already recorded as another type (409) is skipped and listed ("Saved 6 of 7 days. Not saved: …"); a server failure stops and says how many days were saved. The draft roster then shows Vac, Sick or Other chips on those days.

---

## 8. Employee preferences on My schedule

A new card on `/me/schedule`, below the calendar and above Propose shifts. H2 **"My preferences"** (17 px bold, as the other cards).

- Intro (14 px, `text.secondary`): **"Tell the planner what you'd like. These are wishes, not guarantees: the planner meets them where staffing and the rules allow. Officers who ask for nights get them first; other night shifts go to newer officers first."**
- **Shift length** (`fieldset`/`legend`, radios): `8 h` · `12 h` · `16 h` · `No preference` (default). A length the officer's home unit doesn't use (`allowedLengths`, §10.7; Admissions and Escort are 8 h only) is disabled with **"Your unit uses 8-hour shifts only."**
- **Time of day** (checkboxes, any mix): `Days` · `Evenings` · `Nights` · `No preference`. No preference is the empty set (default): ticking a part clears it, unticking the last part returns to it. The api field is `timesOfDay` (an array); the single `timeOfDay` is legacy input only. Helper under Nights: "Only 12-hour night crews work nights (19:00–07:00). If you work 8-hour shifts, a nights wish can't be met." An edit after a save clears the green confirmation."
- **Days off I'd like** (checkboxes Mon–Sun, 44 px each, legend "Days off I'd like (up to 2)"). A third tick is refused: the box stays clear and the helper says "Pick up to 2 days." (Limit from the api if given, §11 Q4.)
- Last saved: "Saved 21 Nov 08:55" or "Not set yet".
- Buttons: **Save preferences** (white; the screen's yellow stays the offer Accept) · **Clear preferences** (white, only when something is saved).
  - Save: disabled until something changed; success `role="status"` **"Saved. The next plan will use these."**; error: `role="alert"` with the api's message, values kept.
  - Clear: dialog **"Clear your preferences?"** · "The planner will treat you as having no preference." · Cancel · **Clear** (yellow inside the dialog). Success: **"Cleared."**; the form resets.
- A supervisor in **Employee view** edits only their own. Nobody sees a colleague's preferences here (README §5.2).
- Fixtures mode works like the rest of My schedule.

---

## 9. Shared states, keyboard and accessibility

### 9.1 States

| State | What shows |
|---|---|
| Loading (first) | H1, skeleton pill, three skeleton tiles; tabs hidden; `role="status"` "Loading the quarter plan…" |
| Loading (tab) | skeleton rows in the tab card; header stays |
| Signed out / expired | the existing return path (ADR-025): "Please sign in to continue", back to the same `/planner?…` |
| 403 | the not-allowed page: **"Only planners can use the quarter plan."** |
| 404 (draft gone) | **"This draft no longer exists. It may have been discarded or replaced."** · Reload |
| 409 on generate | under Generate: **"A plan is already being generated. Wait for it to finish, then reload."** |
| Generate fails (500, or 60 s timeout) | block tint: **"The plan couldn't be generated. Nothing changed."** + the api's message + Try again. Never a blank page or a raw 500 |
| Network | **"Can't reach the server. Check the connection and try again."** + Try again |

Success → `role="status"`; errors → `role="alert"`.

### 9.2 Keyboard path (automate this in e2e)

1. Tab from the nav to **Seed**, then **Generate draft**; Enter.
2. The status is announced and focus lands on the status line; Tab to the tiles; Enter on **What this means** for Night fairness; Esc.
3. Tab to the tab list; → to **Gaps**; Tab through the strip's cell buttons (only cells with gaps take focus), then the Unit and Block filters, then the runs table; Enter on a **Show week** → Roster, focus on its heading.
4. Tab to Unit, change it; Tab to **Go to week**, pick a week; Tab to Previous / Next / First week; Tab to **Show all units**, Enter; Tab into the grid, where each ⚠ takes focus and opens its tooltip.
5. Back to the tab list; → **Compare**.
6. Tab to **Commit plan…**; Enter → dialog, focus on Cancel; Tab into the warnings list (arrow keys scroll it), Tab to the checkbox, Space; Tab to **Commit plan**; Enter.
7. Focus on "Plan committed"; Tab to **Open Unit B on the planning board**; Enter.

Rules: real buttons and links; labelled inputs; dialogs trap focus and return it to the opener; Esc closes dialogs except while committing; tabs are a `tablist` with `aria-selected`; tables use `th scope`; every pill and bar carries text; visible focus; axe clean on each `/planner` tab, `/planner/preferences` and `/me/schedule` at 1440 and 768 px.

---

## 10. Data the screens need (proposal for `dev.build`)

Names are a proposal; `dev.build` owns the contract (docs/07). The UI needs these **meanings**.

### 10.1 `GET /planner/plan`
`{ window: {from, to, periods}, defaultSeed, patterns8h: ["ROTATING_5_2","5_ON_2_OFF","7_ON_3_OFF"]|null, state: "NONE"|"DRAFT"|"COMMITTED", draft: DraftSummary|null, lastCommitted: {draftId, at, by, shiftsWritten}|null }`. `patterns8h` is the legacy override list; the Generate box no longer shows it.

### 10.2 `POST /planner/drafts {seed, pattern8h?}` → `DraftSummary`
`DraftSummary = { id, version, seed, pattern8h, status, createdAt, createdBy, generatedMs, scorecard }`. With no `pattern8h`, each 8 h officer uses their own pattern and `pattern8h` is `null`; a sent value is the one-release facility override. Replaces an open draft (the UI has asked). 409 while another is generating.

### 10.3 Scorecard
```
coverage:    { shortBlockDays, totalBlockDays }
warnings:    { total, byRule: [{ ruleName, count }] }                 // plain names
preferences: { asked, met, byKind: [{ kind: "SHIFT_LENGTH"|"TIME_OF_DAY"|"DAYS_OFF", asked, met }] }
nights:      { bands: [{ label, hiredFrom, hiredTo, officers, nightShare,
                         avoidNightsAsked, avoidNightsGivenNights, nightShiftsAgainstWish }],
               newestFirstHeld, check: "plain sentence" }
overtime:    { officersOver, hoursOver, thresholdHours }
patterns:    { officers: [{ employeeNo, name, unitCode, pattern, words }], note }
generatedMs
```

### 10.4 Draft roster
`GET /planner/drafts/{id}/schedule?unitId&from&to` in the **same shape as `SchedulePayload`** (`web/src/api/types.ts`) so `RosterGrid` and `CoverageCell` render it unchanged; officer `rotation` carries that officer's own pattern words of §1. `GET /planner/drafts/{id}/coverage?from&to` → `[{ unitId, unitName, coverage: BlockCoverage[] }]` for the strip.

### 10.5 Gaps, warnings, compare
- `GET /planner/drafts/{id}/gaps` → `[{ unitId, unitName, date, block, lowest, required, shortHours: ["15–17"], reason|null }]`
- `GET /planner/drafts/{id}/warnings` → `[{ ruleName, items: [{ unitName, date, officerName, shift, message }] }]` (full list: the commit dialog shows all of it)
- `GET /planner/drafts/{id}/compare` → `{ committed: {...}|null, rows: [{ key, label, board, draft, unit: "count"|"hours"|"percent", direction: "LOWER_IS_BETTER"|"HIGHER_IS_BETTER"|"NEUTRAL" }], byUnit: [...] }`

### 10.6 Commit and discard
- `GET /planner/drafts/{id}/commit-preview` → `{ version, shiftsToWrite, officers, replaces: {shifts, committedAt}|null, from, to, shortBlockDays, warningCount }`
- `POST /planner/drafts/{id}/commit` with `If-Match: <version>` and body `{ acceptedWarningCount }` → 200 `{ shiftsWritten, committedAt, auditEventId, units: [{id, name}], firstWeek }` · **412** stale `{ reason: "plain words" }` · **422** `{ failures: [{ unitName, date, officerName, shift, ruleResults }] }` · 409 `{ reason: "LOCKED_PERIOD", period }` or `{ reason: "ALREADY_COMMITTED"|"REPLACED", by, at }`.
- `POST /planner/drafts/{id}/discard` → 204.

### 10.7 Preferences
- `GET /me/preferences` → `{ shiftLength: 8|12|16|null, timesOfDay: ["DAY"|"EVENING"|"NIGHT"], daysOff: ["SAT","SUN"], maxDaysOff: 2, updatedAt|null, allowedLengths: [8,12,16] }`; `PUT` same body (the old single `timeOfDay` is accepted for one release); `DELETE` clears. The token's own employee only.
- `GET /planner/preferences?unitId` → `[{ employeeId, name, unitName, seniorityDate, shiftLength, timesOfDay, daysOff, maxDaysOff, pattern, patternWords, patternEditable, inDraft: "MET"|"PARTLY"|"NOT_MET"|"NO_DRAFT"|"NONE" (or the api's status field), unmet: ["plain words"], updatedAt }]`
- `PUT /planner/preferences/{employeeId}/pattern` body `{ pattern }` → the updated row; 400 for a 12 h officer, a 12 h code on an 8 h officer or an unknown code.

### 10.8 Planning board link (web, dev-build2)
The board must open on `?unit=<id>&week=<Monday>` (README §5.1 already names the route). Since `98e6788` the week is component state; read it from the URL so the commit links land on the right unit and week, including weeks in 2027.

---

## 11. Open questions (recommendation first)

1. **Can a PLANNER read the planning board?** The commit links go there. **Recommend:** read-only, facility-wide, like the auditor. Otherwise only supervisors can follow the links (the demo switches to M. Ellis anyway, §12 step 8).
2. **Who sees others' preferences?** **Recommend:** PLANNER only for the prototype; supervisors for their units is a pilot privacy question (docs/09 §6).
3. **Board URL parameters** (§10.8): a small web change for dev-build2, needed for the commit links.
4. **Days-off limit:** 2 is my proposal; the UI takes `maxDaysOff` from the api.
5. **Shift pattern** (§3.2): decided - option C, a per-officer setting (planner sets it on Preferences); the facility select is gone and every screen shows the officer's pattern in words.

---

## 12. Demo walkthrough (for `docs/demo-script.md`; add once built and verified)

**Planner: next quarter in seconds, checked by the same rules (about 3 minutes)**

| Step | Do | The audience should see |
|---|---|---|
| 1 | Sign in as **T. Nakamura** (employee). On My schedule, open **My preferences**: 8 h, Days, Sat + Sun off; **Save preferences**. | "Saved. The next plan will use these." Wishes, not guarantees, in plain words. |
| 2 | Sign out; sign in as the **planner**. | **Quarter plan**: "No draft", the next quarter "4 Jan – 11 Apr 2027 · 7 pay periods", seed 20261001. |
| 3 | **Generate draft.** | "Generating…", then the scorecard in seconds: "seed 20261001 · took 2.4 s". Open "What this means" on **Coverage gaps**: gaps are left open, never filled by breaking a rule. |
| 4 | Point at **Night fairness** and **Night shifts by seniority**. | "Held": volunteers first, then newest first, with bars by seniority and the nights-against-a-wish table. |
| 5 | **See everyone's preferences**, find Tara Nakamura; back; **Gaps** → **Show week** on one gap. | Tara's row says whether her wish was met. The roster opens on that unit and week with the short cell outlined, and all six units' coverage above it. |
| 6 | **Generate again** with the same seed. | Identical figures: repeatable, not AI. |
| 7 | **Commit plan…**: read the dialog, tick "I've read these 112 warnings…", **Commit plan**. | What will be written, that nothing is written if any shift is blocked, the full warning list accepted as one decision. "Committed. 4,212 shifts are on the planning board." |
| 8 | **Open Unit B on the planning board**; sign in as **M. Ellis**, go to the week of 4 Jan, change one shift. | The committed plan on the normal board; the supervisor edits it with the usual live rule check. The commit, with its warning list, is in the audit log. |

Figures are examples; use the measured ones from the verified tip.

---

## 13. What I'll check when reviewing the built screens

Scorecard tiles, explanations and panels as §2 · one yellow per screen in every state · status in words, not colour · tabs in the URL · "Show week" lands on the right unit and week with focus · Roster read-only with the "not on the planning board yet" note and each officer's pattern words · each officer's pattern visible in words (Preferences select for 8 h, read-only 4 on/4 off for 12 h; no pattern select beside Generate) · Compare uses the api's direction · commit dialog lists every warning and needs the one checkbox · stale (412), blocked (422) and locked (409) refusals say "Nothing was written" and keep the draft · success links open the board on the right unit and week · preferences save and clear with confirmation, pattern save with its own confirmation, disabled lengths explained · no rule codes anywhere · states as §9.1 · keyboard path §9.2 end to end · axe clean at 1440 and 768 px · footer line, no logo.

- The Roster tab's unit picker shows each unit's gaps for the visible week and the quarter (`no gaps this week`, `1 gap this week, 5 in the quarter`), and the selected unit's name heads its grid. The Go to week picker lists 14 weeks with their gaps in all units. The All-units table starts collapsed and its unit names stay clickable once it is open.

- Preferences (planner): the **Pattern** column is a picker for 8-hour officers (Rotating 5 on 2 off / Fixed 5 on 2 off / 7 on 3 off) and read-only words for 12-hour officers ('4 on, 4 off'). A change applies to the next generate.
- Scorecard **Shift patterns**: the note plus a scrollable table of every officer's pattern in words (officer, unit, pattern).

## 14. Units and staffing (release 3, observation 34)

- **Units** (`/planner/units`, PLANNER only): a table of the units with today's status (Open / Closed + note / Switched off), each dated closure (closed from, reopens or no reopening date, reason, who and when), Change…/Remove… for a future closure and Set/Change reopening date… for a current one, the allocated headcount with Edit, and the on-staff count. Close from a date… opens the close dialog; every dialog asks for a reason of at least 5 characters. A defect: a unit that is open-ended closed cannot get another closure (and cannot be reopened in this release if no update path were available).
- **Staffing**: the 7th scorecard tile (`Short N` warn / `Enough` pass, "N needed · N on staff") and the full-width **Staffing by unit** panel - the api's periods with Needed/Short per period, a closed unit reading `0 closed`, totals as row sums, the leave allowance line and dialog, the per-unit **How** lines from the api breakdown, and the five formula sentences. The panel also shows before a draft. The web computes no staffing number.
- **Shifts in closed units**: a card on `/planner` in every state, listing published shifts on or after a closure with a Show on board link; nothing is deleted silently; a supervisor moves or cancels each shift.
- **Closed-from notes** on the planner roster (picker option, note above the grid, `Closed` cells in the all-units strip), the planning board (same note; `Closed` cells), Reports → Coverage (closure notes under the chart) and the wall display (`Unit C is closed today` + the api's note).
- **Demo** (docs/demo-script.md): reset 120, commit, Units → Unit C → Close from a date… 15 Feb 2027, reason "Renovation (demo)"; the Quarter plan lists C's published shifts, a new draft plans without C and the staffing panel splits; Set reopening date… or Remove… puts the demo back.
