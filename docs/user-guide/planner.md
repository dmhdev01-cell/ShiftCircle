# Planner guide

[← User guide](../../USER-GUIDE.md)

You plan the whole quarter for every unit.

Your menu has these screens:
- **Quarter plan**
- **Preferences**
- **Units**
- **Planning board** (read-only for you)

You work in a **draft**. Nobody else sees it until you commit it.

## 1. Generate a draft

1. Open **Quarter plan**.
2. Optionally enter a seed (a whole number). The same seed always gives the same plan.
3. Press **Generate draft**. It takes a few seconds.

The draft opens with four tabs: **Scorecard**, **Gaps (n)**, **Roster** and **Compare**.

A note on the draft reminds you that it isn't on the planning board yet. Officers and supervisors can't see it until it's committed.

<!-- No screenshot yet: desktop__planner__planner__no-draft (no clean capture from the gated build) -->

## 2. Read the scorecard

The tiles sum up the draft. **What this means** under each tile explains it in a sentence or two.

| Tile | What it tells you |
|---|---|
| **Coverage gaps** | Block-days short of the unit minimum, out of all block-days |
| **Rule warnings** | Shifts that pass the rules but carry a warning; no draft shift is ever blocked |
| **Preferences met** | Share of officers' wishes met |
| **Night fairness** | Whether night shifts go to newer officers first (or to those who asked) |
| **Overtime built in** | Overtime hours the roster needs, and how many officers go over the pay-period threshold |
| **Generated in** | How long the draft took, and its seed |
| **Needed (at least)** | The least staff the unit minimums need, after leave; "Short" or "Meets the floor" |
| **Qualified staff** | Block-days with fewer qualified officers on duty than the unit's minimum |

Below the tiles, these cards give the detail:
- **Hours against target by FTE band**
- **Qualified staff by unit**
- **Night shifts by seniority**
- **Preferences by kind**
- **Staffing by unit**

Two of them need a note:
- **Qualified staff:** this is a warning only. The planner does not enforce qualifications. Qualification start dates are not checked: an officer with a qualification counts as qualified for the whole quarter.
- **Needed (at least):** a floor. Part-time and casual officers work fewer shifts, so a plan can still have gaps when the floor is met. The draft's own gaps are the real test.

Under the tiles, a yellow **Unused part-time capacity** line says how many part-time hours the plan leaves unused, for example "Unused part-time capacity: 5,472 h. Part-time officers are planned 1,248 h of their 6,720 h target this quarter, while 38 block-days stay short." Part-time hours are not guaranteed: a part-time officer is planned only into shifts still open in their home unit, up to their FTE target.

![Quarter plan scorecard on Dataset 120 with the yellow Unused part-time capacity line under the tiles](img/planner-scorecard-part-time.png)

![Quarter plan scorecard for a 120-officer draft: eight tiles, including Coverage gaps 39, Rule warnings 7 and Qualified staff 0 (All met)](img/planner-scorecard.png)

<!-- No screenshot yet: tablet__planner__scorecard (no clean capture from the gated build) -->

![Qualified staff by unit card for the 100-officer dataset: 346 block-days below the qualified minimum, listed by unit and block](img/planner-qualified-staff-card.png)

## 3. Gaps and warnings

**Gaps (n)** says how many block-days are short and shows them two ways.

- **Gaps by week and unit** is a strip with a row per unit and a column per week. Each cell counts that unit's short block-days that week, and a red number opens that week on the Roster tab.
- Below it, The runs table joins block-days that are the same unit and block on days in a row, for example "Escort & transport · Wed 13 – Sun 17 Jan · Evenings 15–23 · staffed 2–3 of 4 · short by 1–2". A line above says "38 short block-days in 7 runs". Narrow them with **Unit** and **Block**. **Show week** opens the first week of the run on the Roster tab.

The **Why** column says what happened. The usual answer is "No eligible officer was free without breaking a blocking rule. A supervisor fills it on the planning board."

![Gaps tab: the weeks by units strip with the Escort and transport row in red, then the first runs with their Show week buttons](img/planner-gaps-runs.png)

Some gaps can't be filled without breaking a rule, so the draft leaves them open rather than hiding them.

## 4. The draft roster

**Roster** shows one unit and one week of the draft.
- Choose the unit with **Unit**. Each option says how many gaps that unit has this week, and in the quarter.
- Jump to a week with **Go to week**: each of the 14 weeks says its number, its dates and how many gaps it has in all units (for example "Week 5 · 1 – 7 Feb 2027 · no gaps in all units"). **Previous week**, **Next week** and **First week** also work.
- **All units** shows the week's figures for every unit in one table. It starts closed: press **Show all units** to open it.
- A small **⚠** on a shift means a rule warning names it. Hover or focus it to read the warning, for example "Fewer than 2 days off in 7: Fewer than 2 consecutive days off in 7 days."
- Leave shows as **Vac**, **Sick** or **Other** instead of Off (section 8).

![Roster tab: Go to week, the unit list with gap counts, the collapsed All units table and the draft grid](img/planner-roster-week-picker.png)

![A draft shift with the warning marker and its message](img/planner-roster-warning.png)

If a unit is closed from a date, a note says so. From that date the unit has no roster and needs no staff, and its officers appear as relief in other units.


## 5. Change shifts in the draft

You can change single shifts in a draft before you commit it. The planning board isn't touched. Every change is checked against the same rules a supervisor's change is.

**Tap a shift** on the draft roster, then choose one of:
- **Change time or unit…**: pick the date, shift and unit, then press **Check and save**.
- **Give to another officer…**: pick the officer, then press **Check and save**. This moves this one shift to them; it is not a two-way swap.
- **Remove from draft…**: the block may become a gap, and the scorecard will show it. No reason is needed.

**Tap an empty cell** to add a shift for that officer on that day. Choose the shift and unit, then press **Check and save**. You may add extra shifts.

After **Check and save**:
- **Pass:** the change is saved.
- **Warn:** nothing is saved yet. Read the warnings, then press **Keep the change with these warnings** if you want it. The shift then counts in **Rule warnings**.
- **Block:** nothing is saved. In a draft there is no emergency override. Choose another officer or time, or leave the gap.

After each save, the scorecard, gaps, warnings, Qualified staff and Staffing figures are worked out again for the whole draft. A shift you changed or added reads "· edited" on the roster, and the draft note counts your hand edits ("{n} hand edits so far").

If you see "The draft changed since you opened it" or "This draft was committed or discarded", reload and try again.

<!-- No screenshot yet: desktop__planner__draft-edit__dialog (no clean capture from the gated build) -->
<!-- No screenshot yet: tablet__planner__draft-edit__dialog (no clean capture from the gated build) -->

![Draft shift dialog refusing a change: four rule results, including U-01 minimum rest, then the sentence that a Block rule stops it going in the draft](img/planner-draft-edit-block.png)

![Draft shift dialog with two warnings, U-12 and U-14, and the button Keep the change with these warnings](img/planner-draft-edit-warn.png)

![Draft roster after one edit: the note says 1 hand edit so far, the status line says Draft changed, and the changed shift reads E · edited](img/planner-draft-roster-edited.png)

## 6. Compare

**Compare** puts the committed plan next to the board as it is now, so you can see what changed since the last commit.

## 7. Commit, generate again, or discard

- **Commit plan…** asks "Commit the quarter plan?". Then **Commit plan** writes the whole draft to the planning board, where supervisors and officers see it.
  - Commit checks every shift again, hand edits included.
  - If something changed since the draft was made, commit refuses with a reason ("Not committed: …"), and nothing is written.
- **Generate again** replaces the draft. Press **Replace draft** to confirm. **Your hand edits are lost**; the confirm text says how many.
- **Discard draft…** then **Discard draft** removes the draft and its hand edits. Nothing on the planning board changes.

![Quarter plan after commit: the Committed badge and a Plan committed box with a button to open each unit on the planning board](img/planner-committed.png)

<!-- No screenshot yet: desktop__planner__regenerate-confirm__edits (no clean capture from the gated build) -->

## 8. Preferences

**Preferences** lists every officer's wishes by unit. **Not met only** narrows the list to the wishes the current plan misses.

**Add planned leave** records leave for one officer: pick the officer, the first and last day (inside the plan quarter, up to 31 days) and the type (Vacation, Sick or Other). Only the type is kept, never a reason. Each day is saved and audited as "Absence recorded". The draft roster shows those days as **Vac**, **Sick** or **Other** instead of Off. **Generate** again so the plan rosters someone else on those days. A day that already has another type of leave is not changed; the dialog lists it.

![The Add planned leave dialog: officer, first and last day, the Vacation, Sick and Other types with their chips, and the sentence Vacation for Aiden Adeyemi: Tue 9 Feb 2027 – Thu 11 Feb 2027 (3 days)](img/planner-leave-dialog.png)

Dataset 150 already carries seeded leave (20% of each full-time officer's days), so its draft roster shows Vac and Sick chips from the start, and part-time officers fill the days the full-timers are away.

![Draft roster on Dataset 150, the bottom of a Unit B week: an officer on leave all week shows Vac chips, and the key explains Sick and Vac](img/planner-roster-leave.png)

## 9. Units

**Units** shows each unit:
- whether it is open today;
- its closures;
- allocated headcount;
- officers on staff.

To close a unit:
1. Press **Close from a date…**.
2. Enter **Closed from**, optionally **Reopens on**, and a **Reason**.
3. Save.

The dialog tells you how many officers are homed there and how many published shifts are affected.

A closure that hasn't started offers **Change…** and **Remove…**. One that has started offers **Set reopening date…** or **Change reopening date…**.

**Edit** changes allocated headcount.

**Shifts in closed units** lists draft shifts that fall in a closed unit, with **Show on board**.

<!-- No screenshot yet: desktop__planner__units (no clean capture from the gated build) -->

## 10. Staffing by unit

The **Staffing by unit** card shows, for each unit and period:
- needed (at least);
- on staff;
- short.

**How** shows the formula. **Change…** sets the leave allowance used in the sums. A closed unit needs no one while it is closed.

## 11. Planning board

You can read every unit's live roster on the planning board, but not change it: "Read-only: the facility planner sees every unit's roster. Supervisors change their own." Reports are for supervisors and auditors, so your menu has no Reports item.

## 12. Reset the demo

In demo mode, **About & version** has **Reset the demo data**. Pick a dataset and start the reset.

It erases the synthetic roster, time entries, audit history and your draft (with its hand edits), then generates the dataset again.

## What you can't do here

- Change the live planning board. Supervisors change their own unit's roster.
- Change a plan after commit. From then on, supervisors change shifts on the board.
- Use an emergency override.
