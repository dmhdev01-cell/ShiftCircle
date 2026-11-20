# ShiftCircle — Scope and Plan

**Status:** Draft v0.3 · 2026-11-19 · for iteration
**Changes:** v0.2 widened scope to a full scheduling prototype, removed AI from runtime, and set up three containers. v0.3 moves trades and notifications to future work, and sizes the simulation at 100 officers over 90 days.

---

## 1. Problem

Saskatchewan's Ministry of Corrections, Policing and Public Safety runs adult secure-custody correctional centres 24/7, staffed by correctional officers and managers working rotating shifts. Supervisors build and adjust rosters of 8, 12 and 16-hour shifts while juggling:

- **Legal minimums** under *The Saskatchewan Employment Act*: at least 8 consecutive hours of rest in any 24-hour period, and no more than 16 hours of work in any 24-hour period, except in an emergency.
- **Collective-agreement rules:** notice of schedule changes, overtime distribution, consecutive-shift limits.
- **Operational minimums:** officers per post, per block, with the right qualifications.
- **Overtime:** who's already in overtime, who's next in line, and what it costs.
- **Downstream systems:** the hours scheduled and worked have to reach payroll accurately.

Today this is a mix of spreadsheets, phone calls and memory. Mistakes put fatigued officers on posts, pay overtime unfairly, or produce payroll corrections. Staff have little visibility into their own hours or how many trades they have left.

## 2. Solution summary

ShiftCircle is a web-based scheduling prototype with a **configurable rules engine** at its core. Every scheduling action (assigning a shift, a trade, an overtime offer, an employee's proposed schedule) is checked against the active rules before it can be saved, and the result is explained to the user. A supervisor stays accountable for every change.

## 3. Users

| User | Needs | Main screens |
|---|---|---|
| **Shift supervisor / scheduler** | Build and adjust the roster; see coverage and overtime at a glance; approve proposals; schedule overtime fairly | Planning board, requests inbox, overtime board, time and attendance, reports |
| **Correctional officer** (employee) | See their schedule and hours; propose shifts they'd like; respond to overtime offers | My schedule, shift planner (proposals), my reports |
| **Rules administrator** (HR / labour relations) | Change rule values to match the collective agreement without a code change | Rules configuration |
| **Wall display** (TV in the unit office) | Today's coverage at a glance | Display mode (read-only) |

## 4. Outcomes we want to improve

| Measure | Target in the prototype |
|---|---|
| Rule-breaking schedule changes saved | Zero without a logged supervisor override |
| Supervisor visibility of overtime | Each person's overtime status shown live on the planning board |
| Coverage gaps | Planned vs. scheduled vs. actual staff, shown for every post and block |
| Employee self-service | Own hours, overtime and proposals, all visible without asking a supervisor |
| Payroll handoff | A clean export of time by pay code for each pay period |

## 5. Feature priorities (seven-day build)

The assessment notes that extra features don't automatically earn higher marks, and the demo is capped at five minutes. So features are tiered: **Must** is the submission, **Should** gets built if time allows, **Could** is documented as future work.

| # | Feature | Priority |
|---|---|---|
| F1 | Supervisor **planning board**: roster grid, coverage bars, overtime badges, rule warnings | Must |
| F2 | **Configurable rules engine** with a rules admin screen | Must |
| F3 | Employee **My Schedule** view, with hours summary and overtime status | Must |
| F4 | ~~Shift trades with per-month/quarter limits~~ | **Future work** |
| F5 | **Overtime scheduling**: open shift → eligible list (fair-distribution order) → offer → accept → assign | Must |
| F6 | ~~Notifications and alerts (email / SMS)~~ | **Future work** |
| F7 | **Time tracking**: scheduled vs. actual, pay codes, pay-period lock, **payroll export (CSV)** | Must |
| F8 | **Reports**: hours scheduled vs. worked, overtime, coverage planned vs. actual, for any date range | Must |
| F9 | Employee **shift planner**: draft a preferred schedule, check it against the rules, send it to the supervisor | Should |
| F10 | **TV / wall display mode** for today's coverage | Should |
| F11 | Audit log viewer | Should (logging is a Must; the viewer is a Should) |
| F12 | Drag-and-drop on the planning board | Could |
| F13 | Leave management, seniority bidding, real SSO | Could, as future work |

**Future work (designed for, not built):** shift trades with monthly/quarterly limits (a `MaxCountInPeriod` rule type, a trade request workflow, and counters on My Schedule), and notifications/alerts (an outbox of email/SMS for schedule posted, shift changed, overtime offered, approaching overtime). The data model and rules engine leave room for both.

## 6. Approach to AI

- **Runtime:** no AI. Scheduling decisions affect employment rights, pay and facility safety, so they have to be **deterministic, explainable and auditable**. A configurable rules engine does that better than a language model. This is the "where conventional software is more appropriate" argument the assessment asks for.
- **Development:** the assessment *requires* AI tools during design or development. We use Claude for requirements, architecture, scaffolding, test generation and code review, and keep `docs/ai-dev-log.md` as we go, including AI suggestions we corrected or rejected.
- **Future option (documented, not built):** AI could later draft staff messages (once notifications exist) or summarize reports. It would never decide whether a change is allowed.

## 7. Assumptions

1. **Synthetic data only.** A fictional facility ("Prairie Provincial Correctional Centre"), with fictional staff, posts and staffing minimums.
2. **Domain knowledge vs. data:** your wife's insight into how scheduling really works shapes the *workflows and rules*. No real names, real post layouts, real staffing levels or non-public operational details go into the prototype. Staffing levels at a correctional facility are security-sensitive.
3. Hard rules R-01 and R-02 come from public employment-standards guidance. **All collective-agreement values are placeholders** (marked in the rules admin screen) and would be confirmed with the ministry and the union.
4. Shift block times are mocked (§8) and configurable.
5. Sign-on is simulated with a user/role picker. Payroll is a simulated integration (export file only).
6. A reviewer runs everything with `docker compose up`. No paid services or licences needed.

## 8. Mock shift blocks (configurable)

| Length | Block | Times |
|---|---|---|
| 8 h | Days / Evenings / Nights | 07:00–15:00 · 15:00–23:00 · 23:00–07:00 |
| 12 h | Days / Nights | 07:00–19:00 · 19:00–07:00 |
| 16 h | Double, day start / evening start | 07:00–23:00 · 15:00–07:00 |

## 9. Seven-day plan

This is tight for the Must list. If we slip, the Should items go first.

| Day | Work | Output |
|---|---|---|
| 1 | Finalize docs; scaffold three containers; DB schema and seed data | `docker compose up` shows an empty app |
| 2 | Rules engine and unit tests; rules config API | Engine passing its boundary tests |
| 3 | Planning board and My Schedule; assigning shifts with rule checks | Core loop working |
| 4 | Overtime workflow; employee shift planner | F5, F9 |
| 5 | Time and attendance, payroll export, reports | F7–F8 |
| 6 | Rules admin UI, wall display, polish; build record and README | Submission docs |
| 7 | Verification pass, demo script, ≤5-minute recording | Submission package |

## 10. Deliverables map

| Required by assessment | Where |
|---|---|
| Prototype, source, setup | Repo, `docker-compose.yml`, `README.md` |
| ≤5-minute demo | `docs/demo-script.md` |
| Build record (≤2 pages) | `BUILD_RECORD.md`, drawn from these docs |
| Architecture diagram | `docs/03-architecture.md` |
| Design decisions | `docs/decisions.md` |
| AI-assisted development | `docs/ai-dev-log.md` |
| 2–5 test cases | `docs/02-requirements.md` §6, plus automated tests |

## 11. Open questions

1. **Overtime order:** fewest overtime hours this quarter first, then seniority? Or a rotating list?
2. **Pay period:** biweekly? Which pay codes matter (regular, overtime 1.5×, overtime 2×, statutory holiday, shift premium)?
3. **Notice period** for supervisor-made schedule changes: placeholder of 48 h for a temporary change and 14 days for posting a schedule.
4. **Posts:** how does the centre actually think about coverage: by named posts, by unit, or by a headcount per shift? (See §12; the prototype can work at any of the three levels.)
5. **Rotations:** what shift patterns are common (e.g. 12-hour "2 days, 2 nights, 4 off"; 8-hour rotations)? Are 16-hour shifts only ever overtime doubles?

## 12. What "post" means (coverage level)

A **post** is a specific position that must have someone in it on every shift, no matter who that person is. Typical examples: a living unit (e.g. "Unit A, 2 officers"), the control room, admissions/intake, escort and transport, and perimeter or yard. Supervisors usually staff to posts: "Unit B nights needs 3, and one of them must be control-room trained."

Posts matter to the prototype because they're what **coverage** (required vs. scheduled vs. actual) and **qualification** checks (R-03, R-04) are measured against. The prototype can model coverage at any of three levels:

| Level | How coverage is defined | Trade-off |
|---|---|---|
| **A. Headcount per shift** | "Days need 26 officers, nights need 18" | Simplest; no qualification checks by location |
| **B. By unit / area** | "Unit A needs 4 on days, 3 on nights" | Middle ground; realistic without too much detail |
| **C. By named post** | "Unit A Floor Officer ×2, Unit A Control ×1" | Most realistic; most configuration |

**Proposed default: B (by unit/area), with about 8 fictional units** and a qualification requirement on a few (e.g. Control, Escort). It's easy to roll up to A or extend to C later. Confirm with real-world practice; we won't use any real unit names or staffing numbers.

## 13. Simulation dataset

| Item | Value |
|---|---|
| Facility | "Prairie Provincial Correctional Centre" (fictional) |
| Officers | **100**, fictional names, mixed qualifications (control-room, escort/transport, first aid), mock seniority dates |
| Window | **90 days**: 1 October – 29 December 2026 (one quarter). Days before "today" have actuals; later days are planned only. "Today" can be configured for the demo. |
| Rotations | About 60 officers on 12-hour rotations (2 days, 2 nights, 4 off) and about 40 on 8-hour rotations (days / evenings / nights). 16-hour shifts appear only as overtime doubles. |
| Absences | About 8% of shifts become sick or vacation absences in the past portion, which creates the gaps that overtime fills |
| Coverage sizing | Required staffing is set slightly above what 100 officers can cover once absences are counted, so overtime appears naturally (roughly 24 officers on at any given hour, against ~23 available on average) |
| Planted cases | A few deliberate edge cases for the demo and tests: a short-rest violation, an exactly-8-hour boundary, a 17-hour emergency override, and an officer running long on consecutive nights |
| Reproducibility | The generator uses a fixed random seed, so every `docker compose up` produces the same data, and tests can rely on it |
