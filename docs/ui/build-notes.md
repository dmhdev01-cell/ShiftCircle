# ShiftCircle UI: build notes

**Status:** v1.0 · 2026-11-20 · from `dev.design` for the builder.
**Read with:** `docs/ui/README.md` (UI spec) and `docs/ui/screens/*.dc.html` (mockups).
**Precedence:** where these notes and the mockups disagree, follow these notes. Where they disagree with an ADR, follow the ADR and tell `dev.design`.

These notes don't redesign anything. Section 1 lists the changes the mockups need for ADR-015/016. Section 2 sets out the screens that have no mockup yet, built from existing components (README §7).

---

## 1. Corrections to the mockups (ADR-015, ADR-016)

### 1.1 Shift vocabulary

| Template (`shift_template.code`) | Times | Chip text | Chip style (README §3.2) | Words in copy |
|---|---|---|---|---|
| `D8` | 07:00–15:00 | `D` | Day | "Day 8 h" |
| `E8` | 15:00–23:00 | `E` | Evening | "Evening 8 h" |
| `N8` | 23:00–07:00 | `N` | Night | "Night 8 h" |
| `A12` | 00:00–12:00 | `A12` | Night (blue fill, white text) | "12 h 00–12" |
| `P12` | 12:00–24:00 | `P12` | Evening (light blue) | "12 h 12–24" |
| `L16` | 20:00–12:00 | `L16` | 16 h (grey, bordered) | "16 h shift" |

- **`ShiftChip` takes the template code.** The three 8 h defaults show a single letter. Every other template, including new ones added on the Shift types table, shows its code. Keep that mapping in one place.
- **Retired:** the mockups' old `D12`/`N12` meaning (V6 brought `D12` 07–19 and `N12` 19–07 back as real crew templates, with their own chips: deeper yellow and dark indigo), `OT`, `16 h OT`, "12-hour night/day", "16-hour double", "Doubles".
- **Extra shifts** (`EXTRA`, picked up beyond the roster) show the template chip with `· extra`, for example `E · extra` or `L16 · extra`, styled `support.buffaloGrass`. Overtime is **never** a chip. It's the officer's pay-period status pill: Under, Approaching or In overtime (U-15, P-01).
- **A double** (a rostered shift plus an extra shift back to back) shows as two chips in the cell, for example `D` then `E · extra`. There is no combined "double" chip.

### 1.2 Times on screen

- Use 24-hour times with an en dash, for example `12:00 – 24:00`. Show a P12 end time as **24:00** on the same date, the way the API evidence does ("Fri 20 P12 12:00–24:00").
- A shift that ends the next day shows `+1`, for example `20:00 – 12:00 +1` and `23:00 – 07:00 +1`.
- In grids and calendars, a chip sits on the **start date** and its tooltip (`title`) gives the full times.
- 12 h rotation label: **"12 h · 2 × 00–12, 2 × 12–24, 4 off"** (short form `2A 2P 4 off`). 16 h rotation label: **"16 h · 1 on, 2 off"**.

### 1.3 Coverage cells (hourly coverage, ADR-013 revised)

Blocks stay Day 07–15, Evening 15–23 and Night 23–07, but a block now counts as covered only when **every hour** in it meets the requirement. An A12, P12 or L16 shift counts toward several blocks.

- The block cell shows **the lowest hourly headcount in the block / required**, for example `4 / 5`.
- If any hour falls short, the second line names the hours, for example "short 15–17". If every hour is over, it says "+1 over".
- The tooltip lists the hourly counts. Without this, `5 / 5` could hide a two-hour gap.
- **API need:** `GET /schedule` and `GET /display/today` must return each block's lowest hourly count and the hour ranges that fall short, not just one number. Agree this with whoever builds the endpoint.

### 1.4 Screen by screen

| File:line | Mockup shows | Build as |
|---|---|---|
| `Main.dc.html:150` | legend `D12 / N12 12 h 07–19 / 19–07` | `A12` "12 h 00–12", `P12` "12 h 12–24", `L16` "16 h 20:00–12:00" |
| `Main.dc.html:151` | legend `OT Overtime` | `E · extra` "extra shift beyond the roster", then the text "Overtime = pay-period hours over 80 h (status pill)" |
| `Main.dc.html:220-221` | "✓ 5 (1 OT)", "OT filled" | "✓ 5 (1 extra)", "extra filled" |
| `Main.dc.html:224-227` | `OT16` "16 h OT, double 07:00–23:00"; `EOT` "E · OT" | two chips `D` + `E · extra`; `E · extra` |
| `Main.dc.html:235-243` | officer rows built from `D12`/`N12`; patterns "12 h · 2D 2N 4 off" | demo data from the generator (`10-testing.md` §6); patterns as in §1.2 |
| `Main.dc.html:163, 254` | Nia's case: "No rest after the 12 h night ending Sat 07:00", evidence "Fri 20 N12 19:00 – 07:00" | PC-01: Nia works **P12 Fri 20 Nov 12:00–24:00** and the proposal is **D8 Sat 21 Nov 07:00–15:00**. U-01 blocks (7 h rest) and U-05 blocks (17 h in 24 h). Messages come from the API's `ruleResults`; don't copy them from the mockup |
| `Main.dc.html:24`, `MySchedule.dc.html:24` | CSS class `k-OT` | `k-EXTRA` (same colours) |
| `MySchedule.dc.html:71` | "12-hour rotation (2 days, 2 nights, 4 off)" | "12-hour rotation (2 × 00–12, 2 × 12–24, 4 off)" |
| `MySchedule.dc.html:77-78` | next shift "Tonight · 19:00 – 07:00 · Night 12 h" | from `GET /me/schedule`, for example "Tomorrow · 00:00 – 12:00 · 12 h 00–12 · Unit B" |
| `MySchedule.dc.html:170-178` | calendar cycle `D12 D12 N12 N12`; "E · OT" | cycle `A12 A12 P12 P12 Off ×4`; `E · extra` |
| `MySchedule.dc.html:188` | proposal "Night 12 h → Day 12 h"; "Evening 8 h (overtime)" | "P12 → A12"; "Evening 8 h (extra)". If the day before is a P12, an A12 gives zero rest, so the live rule check must show it blocked (U-01) |
| `Overtime.dc.html:170-172` | "Working Day 12 h on Sat"; "16 h double with his Sat evening"; "Night 12 h starts Sat 19:00" | candidate reasons come from `GET /open-shifts/{id}/candidates` (PC-08); don't hard-code them |
| `Overtime.dc.html:102` | column "OT this quarter" | keep: this is overtime **hours**, still the ranking basis (ADR-016) |
| `Rules.dc.html:109` | shift-kind options "12-hour night", "16-hour double" | "12 h 00–12", "12 h 12–24", "16 h shift", from the active shift templates |
| `Rules.dc.html:170, 186` | U-03 "After a 16-hour double" | "After a 16-hour shift" (`05-union-rules.md` U-03) |
| `Rules.dc.html:192` | table name "Doubles" | "16-hour shifts". Also add a **"Shift types"** entry (§2.6) |
| `Reports.dc.html:148` | "OT 1.5×", "OT 2×" | keep: these are pay codes (P-01b; the 2× band is off by default, so hide that column when it's empty) |
| `WallDisplay.dc.html:29, 104-106` | "Day shift 07:00 – 15:00" | "Day block 07:00 – 15:00": blocks are about coverage, not shifts. Counts are hourly (§1.3) |
| All sample staffing numbers | e.g. Unit B 5 / 4 / 3 | `10-testing.md` §6.2 (Unit B 5 / 5 / 4) |

---

## 2. Screens with no mockup

All of these use the shared layout (README §4), the tokens (§3), **one yellow button per screen**, the footer line, and 44 px targets. "Reuse" names components from README §7.

### 2.1 Sign-in (mock): `/login`

- **Who:** anyone, on the `demo` profile only. **API:** `GET /auth/demo-users`, `POST /auth/mock-login`.
- **Layout:** top bar without a role chip. One centred white card (max 560 px) on the page background, titled "Sign in" (H1 36 px light).
- **Banner** (`status.warn`, `role="note"`): "**Mock sign-in · demo only.** Pick a fictional user. A pilot would use government single sign-on."
- **User list:** one full-width row button per user (≥ 56 px tall). Bold name; roles in plain words ("Supervisor · Employee"); scope line ("Units A, B"). Use the order in `09-access-control.md` §4. There's no yellow button on this screen: each row is the action.
- **After sign-in, go to:** Supervisor → `/planning`; Employee only → `/me/schedule`; Rules admin → `/rules/draft/rest` (or live if there's no draft); Rules approver → `/rules/{v}/review` when a version is waiting, otherwise `/rules`; Auditor → `/reports/coverage`; Display → `/display`.
- **Role chip** (every other screen): "Supervisor · M. Ellis (mock sign-in)" opens a menu with **Sign out**, which clears the token and returns to `/login`.
- **States:**
  - Loading: three skeleton rows.
  - Endpoint missing (prod-like): "Mock sign-in is turned off in this environment." in `status.block`, with no fallback.
  - Expired or invalid token: back to `/login` with "Your session ended. Sign in again."

### 2.2 Time & attendance: `/time?period=`

- **Who:** Supervisor, own units; Auditor reads. **API:** `GET /pay-periods/{id}/time-entries`, `PUT /time-entries/{id}`, `POST /pay-periods/{id}/lock|unlock`, `GET /pay-periods/{id}/payroll-export`.
- **Header:**
  - Title "Time & attendance".
  - Pay-period select ("9 – 22 Nov 2026") and unit select.
  - Period `StatusPill`: `Open` (info) or `Locked · M. Ellis · 9 Nov 08:12` (pass).
- **KPI tiles (`KpiTile`):** scheduled h · worked h · overtime h (P-01) · **shifts needing actuals** · unpaid extensions under 30 min (P-04).
- **Grid:** reuse `RosterGrid` (14 day columns, horizontal scroll, sticky officer column).
  - Pay-period column: the officer's period hours with the overtime pill, as on the board.
  - Cell states, always with text and never colour alone:
    - `✓ D`: worked as scheduled.
    - `✓ D 07:00–16:30`: adjusted, with the difference "+1.5 h".
    - `Sick` / `Vac`: absence types from the API.
    - `D · needs actual`: a past shift with nothing recorded, `status.warn`.
    - Plain chip: a future shift, read-only.
- **Record actual:** clicking a past cell opens a side panel where the rule-check panel sits on the board (below the grid on tablet).
  - Radio group: **Worked as scheduled** · **Adjusted times** (start and end inputs in 15-minute steps) · **Absent** (type select).
  - "Save" (white).
  - After saving, show the recalculated pay codes for that officer's period from the response, for example "Now 82.5 h: 2.5 h at 1.5×".
- **Lock:** "Lock pay period" is the yellow button.
  - It's disabled while any shift needs an actual, with the reason next to it: "Record 3 missing actuals first". Exporting a period with unrecorded shifts would put wrong figures into payroll.
  - The confirmation dialog repeats the totals ("100 officers · 8,012 worked h · 312 overtime h") and says actuals become read-only.
- **When locked:**
  - Cells are read-only.
  - **"Payroll export (CSV)"** becomes the yellow button. Show the last export's time and file hash under it.
  - "Unlock…" (white) opens a dialog that asks for a reason (at least 10 characters, the same component as the override dialog). The reason is recorded in the audit log, and the dialog says: "Unlocking recalculates pay codes. The earlier export stays on record."
- **Errors:**
  - `409` locked: "This pay period is locked. Unlock it with a reason to make changes."
  - `412`: the board's conflict message.
  - Out of scope: `404` page.

### 2.3 Proposals inbox: `/proposals`

- **Who:** Supervisor, own units. **API:** `GET /proposals?unitId=&status=SUBMITTED`, `POST /proposals/{id}/decision`.
- **Nav:** add "Proposals" under Overtime, with a count in text ("Proposals (2)").
- **Layout:** the same two-pane pattern as the Overtime board.
  - **Left:** proposal cards with officer, unit, "3 shifts", submitted time, and a status pill (`Waiting` warn · `Partly accepted` info · `Decided` pass). Filter: Waiting / All.
  - **Right:** the selected proposal.
    - Header: officer name, pay-period hours with the overtime pill, and the employee's note quoted.
    - Item table: what ("Sat 28 Nov · add E8 15:00–23:00 · extra"), rule result (`RuleResultList` in compact form, "Checked when submitted · rules v7"), and a per-item **Accept / Decline** radio pair (not a checkbox, so "not yet decided" stays visible).
- **Action:** "Send decision (2 accepted, 1 declined)" is the yellow button, disabled until every item has a choice.
  - Rules re-run when the decision is saved. If an accepted item now gets a `422`, show its fresh `RuleResultList` inline under that row, with the same acknowledge and override flow as the board (`useRuleCheckedMutation`). Nothing auto-approves.
  - Then: "Sent. Accepted shifts are on the planning board."
- **Empty:** "No proposals waiting. When officers propose shifts, they appear here."

### 2.4 Rule version review: `/rules/{version}/review`

- **Who:** Rules approver (can't review their own draft); Auditor and Rules admin read. **API:** `GET /rule-sets`, `GET /rule-sets/{v}/tables/{code}`, the build report, `POST …/approve|reject|publish`.
- **Layout:** the Rules screen with editing off.
  - **Header:** "Review v8" · "Submitted by L. Fraser · 20 Nov 14:22" · their reason · "Live: v7".
  - **Left:** the table list, each with a changed count in text ("Rest between shifts · 1 change"). Unchanged tables stay openable, in `text.secondary`.
  - **Centre:** `DecisionTableEditor` with `readOnly` and `diff` set.
    - A changed cell shows the old value struck through, then the new one: ~~12~~ **14**. The row is tinted yellow and carries a "Changed" pill.
    - A new row gets a "New" pill (pass tint). A removed row is struck through with a "Removed" pill.
  - **Plain-language panel:** **Before** (live v7) and **After** (v8) sentences for the selected row.
  - **Build report:** `PublishChecklist` read-only, covering values checked, compiled, scenarios ("13 / 13 passed") and dry-run impact.
- **Dry-run impact, privacy:** the approver role can't see the roster (`09-access-control.md` §2). Show **counts by rule, unit and result** ("3 officers in Unit C go from Pass to Block under U-03"), **no names**.
- **Decision:**
  - Comment box: required to reject, optional to approve.
  - "Approve" is the yellow button; "Reject…" is white.
  - After approval, "Publish" becomes the yellow button, with an effective date (default today) and the note "The live rules switch on this date."
- **Self-review:** if the viewer created the draft, hide Approve and say: "You created this version. Another approver must review it." The API enforces this too (`approved_by ≠ created_by`).
- **States:** a draft not yet submitted says "Not submitted yet." A failed build shows its errors and has no Approve button.

### 2.5 Tablet layouts (768 and 1024 px)

- **Nav:** stacks above the content (README §4). Lay it out as a wrapping row of 44 px nav buttons, not a 220 px column, so content starts above the fold.
- **Planning board and Time & attendance:** sticky officer column, days scroll horizontally inside the card, coverage rows stay on top. The rule-check or record-actual panel wraps below the grid. When a cell is chosen, scroll the panel into view and move focus to its heading.
- **Overtime and Proposals:** the list stacks above the detail. The ranked or item table scrolls horizontally; the decision column stays visible (sticky right).
- **Rules and review:** the table list becomes a `<select>` above the grid. The checklist moves below.
- **Dialogs:** full width minus 16 px. Buttons stack with the primary last.
- **Verify** with Playwright viewports 768×1024 and 1024×768 (E1–E5): no page-level horizontal scroll, every target ≥ 44×44, axe clean.

### 2.6 Shift types: `/rules/{version}/shift-types`

README §6 already specifies this screen. It's in the Must list (step 11).

- Build it as one more `DecisionTableEditor` table: code · label · start · length (8 / 12 / 16 h) · regular allowed · chip style (choice of the §1.1 styles, with a live chip preview) · active · effective from.
- Its plain-language sentence reads, for example: "P12 runs 12:00 – 24:00 (12 h). Regular shift."
- If the dry run finds a change would alter rest outcomes on the published roster, the checklist's impact step says so, as in §2.4.
- Existing assignments keep their times. Put that note under the table.

---

## 3. Decisions in these notes (confirmed by the lead 2026-11-20, recorded as ADR-017)

1. The coverage cell shows the lowest hourly count plus the short hours (§1.3). This needs the API to return them.
2. A period can't be locked while past shifts have no actual (§2.2).
3. Rule version review shows dry-run impact as counts without names, because of the approver's permissions (§2.4).
4. Proposals use explicit Accept/Decline per item, and the whole decision is sent once (§2.3).
