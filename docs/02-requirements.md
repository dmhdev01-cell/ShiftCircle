# ShiftCircle — Requirements

**Status:** Draft v0.3 · 2026-11-19 · IDs are stable; edit the text freely. Priorities: M = Must, S = Should, C = Could.

## 1. Screens

| ID | Screen | Role | Priority |
|---|---|---|---|
| S-01 | Sign-in (mock user/role picker) | All | M |
| S-02 | **Planning board**: grid of 1 or 2 weeks; rows = officers (or switch to posts); cells = shift blocks; coverage bar per post and block (required / scheduled / actual); overtime badges; violations panel | Supervisor | M |
| S-03 | **My Schedule**: calendar; hours this pay period, month and quarter; overtime status; upcoming overtime | Employee | M |
| S-04 | **Shift planner**: draft preferred shifts on a copy of the roster, check against the rules, submit as a recommendation with a note | Employee | S |
| S-05 | ~~Trades~~ | Employee | Future |
| S-06 | **Requests inbox**: proposals and overtime acceptances waiting for approval, each with its rule results | Supervisor | M |
| S-07 | **Overtime board**: open shifts, eligible officers in fair-distribution order, offers and responses | Supervisor (employees respond from S-03) | M |
| S-08 | **Time and attendance**: confirm actual vs. scheduled, absence codes, pay-period lock, payroll export | Supervisor | M |
| S-09 | **Reports**: date-range filters, tables and charts, CSV export | Both (employees see only their own data) | M |
| S-10 | **Rules configuration**: list, edit settings, turn on or off, set severity, effective dates, version history, dry-run against the current roster | Rules admin | M |
| S-11 | ~~Notification outbox~~ | All | Future |
| S-12 | **Wall display**: today's and tonight's coverage by post, large type, auto-refresh, read-only | Display | S |
| S-13 | Audit log viewer | Supervisor / admin | S |

## 2. Functional requirements

### Scheduling
| ID | Requirement | P |
|---|---|---|
| FR-01 | The supervisor can assign, unassign and move a shift (officer × post × block × date). Every change runs the rules engine before saving. | M |
| FR-02 | Shift templates are configurable (§8 of the scope doc: 8, 12 and 16-hour blocks). | M |
| FR-03 | Each post has a required staff count per block, and required qualifications. | M |
| FR-04 | The planning board shows **required vs. scheduled vs. actual** per post and block, with gaps and surpluses highlighted (not by colour alone). | M |
| FR-05 | Each officer's **overtime status** is shown live (under threshold / approaching / in overtime) for the current period. | M |
| FR-06 | The supervisor can **publish** a schedule period: the period is marked `PUBLISHED` (one-way, audited), and the planning board shows it as published. **Prototype scope:** publishing is a recorded state, not an access gate; employees' *My schedule* reads their assignments directly, so it is not filtered by period status. | M |
| FR-07 | Changes made after publishing are checked for notice (R-07) and flagged as "changed" on the affected officers' schedules. | M |

### Trades — future work
FR-10 to FR-13 (trade request, colleague acceptance, supervisor approval, monthly/quarterly limits) are reserved for a later phase.

### Overtime
| ID | Requirement | P |
|---|---|---|
| FR-20 | The supervisor creates an **open shift** (a gap, or extra coverage). | M |
| FR-21 | The system lists **eligible** officers, meaning those whose rules pass if assigned. They're ordered by the configured fair-distribution policy (default: fewest overtime hours this quarter, then a seniority placeholder). | M |
| FR-22 | The supervisor sends an **offer** to one or more officers (recorded in the app; the officer sees it on My Schedule). The first eligible acceptance, confirmed by the supervisor, gets the shift. | M |
| FR-23 | The supervisor can **directly assign** overtime. If a hard rule fails, an emergency override with a reason is required where the rule allows one; otherwise it can't be saved (ADR-023). | M |

### Employee proposals
| ID | Requirement | P |
|---|---|---|
| FR-30 | An employee drafts preferred shifts in a sandbox copy of the roster. Rule results show live. | S |
| FR-31 | The employee submits the draft as a recommendation. The supervisor sees the difference from the current roster and can accept all, accept some, or decline. | S |

### Notifications — future work
FR-40 and FR-41 (email/SMS outbox, message templates) are reserved for a later phase. Until then, changes and offers are visible in the app only.

### Time tracking and payroll handoff
| ID | Requirement | P |
|---|---|---|
| FR-50 | Each scheduled shift creates a **scheduled time entry**. | M |
| FR-51 | The supervisor records **actuals**: worked as scheduled, adjusted start/end, or an absence code (sick, vacation, other). | M |
| FR-52 | Hours are classified into **pay codes** (regular, OT 1.5×, OT 2×, statutory holiday, all placeholders) by the time rules. | M |
| FR-53 | The supervisor **locks** a pay period. Locked entries can't be edited without an unlock reason, which is audited. | M |
| FR-54 | **Payroll export**: a CSV per locked pay period (employee ID, date, pay code, hours, cost centre). The receiving payroll system is simulated. | M |

### Reports
| ID | Requirement | P |
|---|---|---|
| FR-60 | Hours **scheduled vs. worked** by employee, for any date range. | M |
| FR-61 | **Overtime** hours by employee and by post, for any range, plus fair-distribution standings. | M |
| FR-62 | **Coverage** required vs. scheduled vs. actual by post and block, for any range. | M |
| FR-64 | Every report can be exported as CSV. Employees see only their own data. | M |

### Rules and audit
| ID | Requirement | P |
|---|---|---|
| FR-70 | Rules are **Drools decision-table rows** that a non-technical admin edits in a friendly grid with plain-language previews (see `04-rules-engine.md`). | M |
| FR-74 | Rule tables can be **downloaded and uploaded as Excel** (.xlsx); uploads go through the same validation and approval. **Not built in the prototype (future work, docs/10 §8).** | S |
| FR-75 | **Maker/checker:** the person who edits a rule change can't publish it; a second approver reviews the impact and publishes. | M |
| FR-76 | Before publishing, the **regression scenarios** run automatically against the staged rules; a failing scenario blocks publication. | M |
| FR-71 | Every rule change is versioned, with who changed it, when, why, and an effective date. | M |
| FR-72 | **Dry run:** before saving a rule change, show how many current-roster violations it would create or clear. | S |
| FR-73 | An **append-only audit log** records every schedule change, approval, override, rule change, pay-period lock/unlock and export. | M |

## 3. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | Runs as **three containers** (web, api, db) with `docker compose up`. No paid services or licences needed. |
| NFR-02 | **Responsive**: usable on a desktop (1280 px and up), tablet (768 px and up, touch-friendly) and TV (1080p/4K, wall mode with large type, viewed from about 3 m). |
| NFR-03 | Professional, consistent look: one design system, a light theme, plus a high-contrast theme for wall display. |
| NFR-04 | Accessible: keyboard navigation, labelled controls, status never shown by colour alone (aiming toward WCAG 2.1 AA). |
| NFR-05 | Fast: planning board for 100 officers × 14 days loads in under 1 s locally; 90-day reports in under 2 s; a rule check returns in under 200 ms. |
| NFR-06 | Rules engine is deterministic and unit-tested, with boundary tests for each rule type. |
| NFR-07 | **No secrets in the repo.** `.env.example` with local-only defaults; real values come from the environment. |
| NFR-08 | Synthetic data only, clearly labelled as fictional in the UI footer. |
| NFR-09 | The API is documented with OpenAPI (Swagger UI in dev). |
| NFR-10 | Role-based access is enforced in the API, not just hidden in the UI (simulated identity, real authorization checks). |

## 4. Rules catalogue (initial values; collective-agreement values are placeholders)

> **The detailed rule set is now in [`05-union-rules.md`](05-union-rules.md)** (IDs U-, P-, S-, O-, L-). The R- IDs below are kept as a summary and map onto it: R-01→U-01 · R-02→U-05 · R-03/R-04→staffing and qualification checks · R-05→U-15, P-01 · R-06→U-09, U-10, U-11 · R-07→P-05, S-01 · R-09→U-12 · R-10→O-01 to O-03.

| ID | Rule | Rule type | Default settings | Severity | Source |
|---|---|---|---|---|---|
| R-01 | Minimum rest | `MinRestInWindow` | 8 h in any 24 h | Block (emergency override) | SEA s. 2-13 |
| R-02 | Maximum hours in a window | `MaxHoursInWindow` | 16 h in any 24 h | Block (emergency override) | Sask. employment standards guidance |
| R-03 | Post minimum staffing | `MinStaffing` | per post/block config | Block for the supervisor; shown as a warning on proposals | Synthetic facility |
| R-04 | Required qualification | `RequiredQualification` | per post config | Block | Synthetic facility |
| R-05 | Overtime threshold | `HoursThreshold` | hours beyond **80 h per 2-week pay period** (weekly 40 h selectable) | Info (marks hours as overtime) | Lead's direction (period-based) |
| R-06 | Consecutive long shifts | `MaxConsecutive` | at most 4 consecutive 12 h overnight (00–12) shifts; at most 1 shift of 16 h in a row | Warn | Placeholder (CBA / fatigue policy) |
| R-07 | Change notice | `MinNotice` | 48 h (temporary change) | Warn | Placeholder (CBA) |
| R-08 | Trade limit | `MaxCountInPeriod` | — | — | Future (with trades) |
| R-09 | Days off | `MinDaysOffInPeriod` | 1 full day (24 h) off in every 7 days | Warn | Placeholder |
| R-10 | Overtime distribution order | `RankingPolicy` | fewest OT hours this quarter, then seniority | Info (orders the eligible list) | Placeholder (CBA) |

## 5. Data model (summary)

`employee` · `qualification` · `employee_qualification` · `post` · `post_requirement` (post × block → required count, qualifications) · `shift_template` · `shift_assignment` · `schedule_period` (draft/published) · `overtime_offer` · `proposal` + `proposal_item` · `time_entry` (scheduled/actual, pay code) · `pay_period` (open/locked) · `rule_definition` + `rule_version` · `rule_result` · `audit_event` (append-only).

## 6. Verification — candidate test cases (pick 2–5 for the build record)

| # | Scenario | Expected |
|---|---|---|
| T1 | Assign a day shift to a rested, qualified officer under the threshold | Saved; all rules pass |
| T2 | Night shift ends at 07:00, then a day shift starts at 11:00 the same day | Blocked by R-01, and the message names both shifts |
| T3 | **Boundary:** night shift ends at 07:00, then a shift starts at 15:00 (exactly 8 h) | Passes R-01 (the limit is inclusive) |
| T4 | A 16-hour shift, then any shift starting within 12 h | Blocked (rest after a 16-hour shift) |
| T5 | Assign a fifth consecutive 12-hour overnight (00–12) shift | Warning from R-06; can be saved once acknowledged |
| T6 | Overtime open shift: the eligible list excludes an officer who'd break R-01 and orders the rest by OT hours | List matches the expected order |
| T7 | A rules admin lowers R-06 from 4 to 3 consecutive nights; the dry run shows the existing 4-night runs that would now warn; after saving, they do | Behaviour changes **without a code change**; version is logged |
| T8 | Payroll export for a locked period with 2 h of overtime | CSV shows REG and OT1.5 lines adding up to the hours worked |
| T9 | **Human judgment:** lockdown, the supervisor needs an officer for 17 h | Blocked; override with reason → saved, flagged in audit and reports |

## 7. Where the system needs human judgment

- **Emergencies** (lockdown, mass sick calls): the law allows exceptions. The system records them but never decides them.
- **Personal circumstances** (childcare, medical accommodation, conflicts between colleagues) aren't modelled.
- **Rule accuracy:** results are only as correct as the configured values. Collective-agreement values need sign-off from labour relations.
- **Fair distribution** is a policy choice, not a calculation; the ranking supports the supervisor's decision rather than replacing it.

## 8. Simulation data requirements

| ID | Requirement | P |
|---|---|---|
| FR-80 | The seed generator creates **100 fictional officers** and a **90-day** roster (one quarter), with a fixed random seed. | M |
| FR-81 | Days before the configured "today" have actuals (worked, adjusted, sick, vacation) and overtime fills; later days are planned only. | M |
| FR-82 | Coverage requirements are defined at the level chosen in scope §12 (proposed: by unit/area). | M |
| FR-83 | Planted edge cases exist for each test case in §6, so the demo and automated tests can find them. | M |
| FR-84 | The UI footer and seed data clearly mark everything as fictional. | M |
