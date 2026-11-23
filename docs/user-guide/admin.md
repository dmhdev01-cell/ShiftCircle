# Rules admin and rules approver guide

[← User guide](../../USER-GUIDE.md)

ShiftCircle has no separate user-administration role: the demo users are fixed. "Admin" here means the two people who look after the **rules**.

A rules admin edits, builds and submits a draft. A rules approver reviews it, approves it and publishes it.

## How rules work

Every shift change, assignment, proposal and draft plan is checked against the published rule set. The answer is one of three:
- **Pass:** every rule is satisfied.
- **Warn:** the change is allowed, but a rule wants you to know something.
- **Block:** the change is not allowed.

The rules are kept as tables:
- **Rest between shifts**
- **Maximum hours**
- **Consecutive work**
- **Pay classification**
- **Overtime ranking**
- **Shift types**

Each table row is also shown as a plain sentence.

<!-- No screenshot yet: desktop__rules_admin__rules (no clean capture from the gated build) -->

## Rules admin: change a rule

1. Open **Rules** and press **Start a draft**.
2. Edit the table values. Answer **Why is this change needed?**
3. Press **Save the draft** at any time.
4. Press **Build and check**. The checklist "Before draft v{n} goes live" then shows:
   - whether the values are valid and the rules compile;
   - how many test scenarios passed;
   - a dry run: which published shifts, in which units and dates, would now break the rule.
5. Press **Submit for approval**. Unsaved edits are saved and built first.

## Rules approver: review and publish

1. Open the submitted version and read its checklist and dry run.
2. Press **Approve**. Then **Publish** makes it the rule set every check uses from now on.

You can't approve or publish a version you created; the screen says "You created this version. Another approver must review it." Every step is recorded in the audit log.

<!-- No screenshot yet: desktop__rules_approver__rules-review (no clean capture from the gated build) -->

## Who may do what

| | Rules admin | Rules approver | Everyone else |
|---|---|---|---|
| Read the rules | Yes | Yes | Supervisor, auditor |
| Start, edit, build, submit a draft | Yes | No | No |
| Approve, publish | No | Yes (not their own) | No |

See [docs/09-access-control.md](../09-access-control.md) for the full table.

## What you can't do here

Change schedules or plans. A published rule change applies to every later check, including the planner's draft edits and the commit re-check.
