# Auditor guide

[← User guide](../../USER-GUIDE.md)

You check what happened and who did it. Everything you see is read-only.

Your menu has these screens:
- **Planning board**
- **Reports**
- **Rules**
- **Audit log**
- **Wall display**

## Audit log

The **Audit log** lists every change, newest first. Each entry shows who made the change, what they did, to what, and when.

To narrow the list:
1. Choose **Anyone** (a person), **Any action** and **All entities**.
2. Press **Apply**. **Clear** resets the filters.
3. **Load more** shows older entries.

An entry marked **Not allowed** is a refused attempt, for example a role trying something it may not do. Refused attempts are logged too.

<!-- screenshot: desktop__auditor__audit-log -->

## Follow a change from start to end

- **An emergency override:**
  - The supervisor's assignment and override reason appear in the Audit log.
  - The same override is listed in **Reports → Overrides**.
- **A rules change:**
  - The rules admin's draft, build and submit appear in the log.
  - So do the approver's approve and publish.
  - The approver can't be the person who wrote the version.
- **A quarter plan:**
  - The planner's hand changes to the draft appear as "Draft shift edited". Each says what kind of change it was: Changed, Given to another officer, Removed, or Added.
  - Then one commit writes the plan to the board.
  - You don't see the draft itself; only the planner does, until it is committed.
- **A demo reset:** it erases the earlier history and leaves one `demo_reset` line.

<!-- screenshot: desktop__auditor__audit-log__draft-edits -->

## Planning board, Reports, Rules, Wall display

- **Planning board:** see any unit's week.
- **Reports:** Coverage, Hours, Overtime and Overrides.
- **Rules:** the published rules.
- **Wall display:** what the unit office TV shows.

These screens work as they do for a supervisor (see the [supervisor guide](supervisor.md)), without the buttons that change anything.

## What you can't do here

Change anything: shifts, plans, rules or time records.
