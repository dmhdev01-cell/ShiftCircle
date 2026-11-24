# ShiftCircle user guide

ShiftCircle schedules 8- and 12-hour shifts (a 16 h day is a 12 h shift plus an extension) at a fictional 24/7 correctional centre. It checks every change against a rules engine and exports worked time to a simulated payroll file.

Every person, unit and figure in it is synthetic, and sign-in is mocked. There is no AI at runtime: the rules engine decides, and a person approves each change.

To install and start it, see [INSTALL.md](INSTALL.md). This guide is about using it.

## Find your role

| You are… | Your side menu | Read |
|---|---|---|
| An officer (Employee) | My schedule | [Officer guide](docs/user-guide/officer.md) |
| A unit supervisor | Planning board, Overtime, Reports, Rules, Audit log, Wall display, Employee view (only for an account linked to an officer; the demo supervisors are not), Time & attendance | [Supervisor guide](docs/user-guide/supervisor.md) |
| The facility planner | Quarter plan, Preferences, Units, Planning board | [Planner guide](docs/user-guide/planner.md) |
| An auditor | Planning board, Reports, Rules, Audit log, Wall display | [Auditor guide](docs/user-guide/auditor.md) |
| A rules admin or rules approver | Rules | [Rules admin and approver guide](docs/user-guide/admin.md) |

Everyone also has **About & version**. The unit office TV uses the **Wall display**, which is covered in the supervisor guide.

## Sign in

1. Open ShiftCircle. The **Sign in** page lists fictional users. It says "Mock sign-in · demo only": a pilot would use government single sign-on.
2. Pick a user. Your role decides your side menu, and your name shows in the top bar.

<!-- No screenshot yet: desktop__all__login (no clean capture from the gated build) -->

## Words used throughout

- **Block:** a rule says the change is not allowed. Nothing is saved.
  - A supervisor may override some Blocks in an emergency, with a written reason.
  - The planner can't override a Block.
- **Warn:** the change is allowed, but a rule wants you to know something (for example, few hours of rest). You see the warning before you keep the change.
- **Pass:** every rule is satisfied.
- **Override:** a supervisor's recorded decision to go ahead despite a Block. The reason goes to the audit log.
- **Gap:** a shift block (Day, Evening or Night) in a unit with fewer officers than its minimum.
- **Block-day:** one block on one day, for example "Unit A, Night, Tue 9 Feb".
- **Pay period:** two weeks.
  - A supervisor publishes a period: the publish is recorded (one-way, audited) and shown on the planning board. My schedule does not yet filter by period status (docs/02 FR-06, partial).
  - A supervisor locks a period after its time is recorded.
- **Draft and committed:**
  - The planner's quarter plan starts as a draft that only the planner sees.
  - Committing writes it to the planning board, where supervisors and officers see it.

## When something goes wrong

ShiftCircle says what happened in plain words and never saves half a change. The common messages:

| Message (or similar) | What it means | What to do |
|---|---|---|
| A rule list with **Block** | The change breaks a rule | Choose another officer, day or shift |
| "The shift changed. Reload the board and try again." | Someone else changed it first | **Reload the board**, then try again |
| "The draft changed since you opened it…" | The draft was edited or regenerated in another tab | Reload the roster |
| "This draft was committed or discarded, so it can't be changed." | The draft is gone | Reload the quarter plan |
| "The draft is busy…" | A demo reset, generate or commit is running | Wait a moment and try again |
| "Not committed: …" | The plan or the rules changed since the draft was made | Read the reason. Nothing was written. Generate again if needed |

## Reset the demo

**About & version** shows the build. For the planner, when the system runs in demo mode, it also shows **Reset the demo data**.

A reset:
- erases the synthetic roster, time entries and audit history, and generates the chosen dataset again;
- records one `demo_reset` line in the new audit history;
- removes any planner draft, including its hand edits.

<!-- No screenshot yet: desktop__all__about (no clean capture from the gated build) -->
