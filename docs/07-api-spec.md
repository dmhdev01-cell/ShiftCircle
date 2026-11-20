# ShiftCircle — API Specification

**Status:** Draft v1.0 · 2026-11-19 · REST + JSON · this document is the contract (no generated OpenAPI document exists in the prototype; docs/10 §8)

## 1. Conventions

| Topic | Convention |
|---|---|
| Base path | `/api/v1` (nginx proxies `/api/` to the api container) |
| Docs | Planned: OpenAPI 3 at `/api/v1/openapi.json` and Swagger UI (`demo` and `dev` profiles only). **Not built** (NFR-09, docs/10 §8): this document is the contract |
| Auth | `Authorization: Bearer <token>` from mock sign-in (see `09-access-control.md`) |
| IDs | UUID strings |
| Time | Instants as ISO-8601 with offset (`2026-11-21T07:00:00-06:00`); dates as `YYYY-MM-DD`; all in `America/Regina` |
| Lists | `?page=0&size=50`; response `{ "items": [...], "page": 0, "size": 50, "total": 123 }` |
| Concurrency | Editable resources return `ETag: "<version>"`; updates require `If-Match`. A stale version gets `412 Precondition Failed`. **In the prototype this is built for assignment move and cancel only (§4.2).** Rule-table drafts are protected by the build fingerprint and the maker/checker states instead. |
| Errors | RFC 9457 Problem Details (`application/problem+json`), with a `ruleResults` extension when rules decide (see §3) |
| CSV | Report and export endpoints also answer `Accept: text/csv` |
| Correlation | `X-Correlation-Id` is accepted or generated, echoed back, and written to logs and audit |

## 2. Status codes

| Code | When |
|---|---|
| `200` / `201` | Success; `201` with `Location` for creates |
| `400` | Malformed request or invalid values (field errors listed) |
| `401` / `403` | Not signed in / role or unit scope doesn't allow it |
| `404` | Not found, or outside the caller's scope (we don't reveal what exists) |
| `409` | State conflict (e.g. pay period locked, offer already answered, lock refused because past shifts lack actuals) |
| `412` | Stale `If-Match` version |
| `428` | `If-Match` missing where it is required (assignment move and cancel, §4.2) |
| `422` | **A rule blocked the change** (body includes `ruleResults`), or Warn results need acknowledgement |

### 2.1 Database conflicts (problem types)

A database constraint that fires under the api answers a problem document, never a raw 500 and never
a driver message. One place maps them (`ApiProblemAdvice`): two advices claiming the same
exception, with one of them rethrowing the SQLSTATEs it did not recognise, aborted the handler
resolution and answered a 500 (dev-qa, 2026-11-20).

| SQLSTATE | Problem type | Status | Title |
|---|---|---|---|
| `23P01` (exclusion) | `.../problems/shift-conflict` | `409` | This officer already has a shift at that time |
| `23505` (unique) | `.../problems/duplicate-record` | `409` | That record already exists |
| `23514` (check) | `.../problems/409` | `409` | State conflict (the locked-pay-period trigger is a check violation) |
| `22003` (numeric overflow) | `.../problems/invalid-hours` | `400` | The hours are out of range |
| maker/checker check | `.../problems/403` | `403` | The author of a rule version cannot approve it |

The body carries no SQLSTATE, no constraint name, no driver message and no stack trace. The
exclusion constraint is the one the api can meet: an emergency override lets the rule engine pass,
and the database still refuses the overlap. The overtime confirm path checks the overlap itself
and answers `422` (`.../problems/officer-unavailable`) before the database is asked. The unique and
numeric-overflow paths are not reachable through the current endpoints (the offer path upserts, and
the actual window is validated before the hours are computed); they are mapped for defence in
depth.

**Everything else answers a problem document too.** One advice owns the catch-all, and it is the
last one consulted (`@Order` 10 / 20 / 30 / 40 across the four advices), so it cannot shadow the
rule, assignment or payroll advice:

| Situation | Answer |
|---|---|
| A role or scope refusal from Spring Security | `403` with a problem body (before, it was an empty body) |
| Not signed in | `401` with a problem body (the token filter answers it) |
| Spring's own web failures (a wrong verb, a wrong media type) | Their own status (`405`, `415`) with a problem body |
| Anything unexpected | `500` with a problem body that says nothing about the internals, plus a `traceId`; the exception and stack are logged at `ERROR` under that same id |

A refusal also leaves a trace server-side, so hiding the cause from the caller does not hide it
from the operator. A database conflict is logged at `WARN` with its SQLSTATE and constraint name,
the rule-compile refusal at `WARN` with the compiler's detail, and a boot-validation refusal at
`ERROR` before the app stops. None of that detail is in the response body; the body keeps plain
words (and, for an unexpected `500`, the `traceId` to quote).

## 3. Rule checks: preview, save, override

Every schedule-changing endpoint runs the rules engine. Clients use the same body three ways:

1. **Preview:** `POST /rule-checks` with the proposed change → results, nothing saved.
2. **Save:** the real endpoint (e.g. `POST /assignments`) → `201` if every result is Pass or Info.
   - If any **Warn** results: `422` with `type: .../warnings-need-acknowledgement`; resend with `"acknowledgeWarnings": ["U-14"]`.
   - If any **Block**: `422` with `type: .../blocked-by-rules`.
3. **Override:** resend with `"override": { "reason": "Lockdown, no relief available" }` (supervisor only, and only for rules whose override policy is `EMERGENCY`). Creates an `override` row and an audit event. An override does **not** acknowledge warnings: the same request must also list every Warn code in `acknowledgeWarnings`, or it is refused with `422 warnings-need-acknowledgement`. Nothing auto-approves, including the warnings that accompany an emergency override.

**Locked pay periods are a wall, not a prompt.** A preview or save whose shift's work date falls in a `LOCKED` period is refused with `409 .../pay-period-locked` before any rule check (docs/07 E4, ADR-017). Otherwise a shift could be saved into a closed period and never get its actual.

**Preview request** (the same body is sent to `/assignments`; `type` is `ASSIGN` or `EXTRA`):
```json
POST /api/v1/rule-checks
{
  "change": {
    "type": "ASSIGN",
    "employeeId": "6f1c…",
    "unitId": "a2b9…",
    "shiftTemplate": "D8",
    "startAt": "2026-11-21T07:00:00-06:00"
  },
  "acknowledgeWarnings": ["U-14"],
  "override": { "reason": "Lockdown, relief unavailable" }
}
```

Each rule result carries `ruleCode`, `outcome`, `message`, `facts` (`{ "required", "actual", "unit" }`),
`evidence` (`[ { "label": "…" } ]`) and `overridePolicy` (`EMERGENCY`, `ACKNOWLEDGE`, `NONE`). The
outcome body has `outcome`, `ruleSetVersion` (number) and `overridable`. The browser contract in
`web/src/api/types.ts` is the implementation reference.

**Blocked response:**
```json
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://shiftcircle.local/problems/blocked-by-rules",
  "title": "This change breaks 2 rules",
  "status": 422,
  "outcome": "BLOCK",
  "ruleSetVersion": 7,
  "overridable": true,
  "ruleResults": [
    {
      "ruleCode": "U-01", "outcome": "BLOCK",
      "message": "Only 7 hours' rest after the 12 h shift ending Fri 24:00. The minimum is 8 consecutive hours in any 24 hours.",
      "facts": { "restHours": 7, "minHours": 8 },
      "evidence": [ { "assignmentId": "c41d…", "label": "Fri 20 P12 12:00–24:00" } ],
      "source": "Saskatchewan Employment Act"
    },
    { "ruleCode": "U-05", "outcome": "BLOCK", "message": "17 hours of work in 24 hours (Fri 12:00 – Sat 12:00).", "facts": { "hours": 17, "maxHours": 16 } },
    { "ruleCode": "U-14", "outcome": "WARN", "message": "52 hours this week, over the 48 h warning level." }
  ]
}
```

## 4. Endpoints

### 4.1 Session and reference data

| Method | Path | Purpose | Roles |
|---|---|---|---|
| GET | `/auth/demo-users` | List users for the mock sign-in picker | public (demo profile only) |
| POST | `/auth/mock-login` | `{ "userId" }` → `{ "token", "expiresAt", "user" }` | public (demo profile only) |
| GET | `/me` | Current user, roles, unit scope, linked employee (`employeeId` is an empty string when the account has no officer) | any |
| GET | `/units` | Units (filtered to scope for supervisors) | any |
| GET | `/units/{id}/requirements` | Required staff per block | SUPERVISOR, AUDITOR |
| GET | `/shift-templates` | 8, 12 and 16-hour templates | any |
| GET | `/qualifications` | Qualification list | any |
| GET | `/employees?unitId=` | Officers in scope | SUPERVISOR, AUDITOR |
| GET | `/employees/{id}` | Officer detail, qualifications, rotation | SUPERVISOR, AUDITOR, self |

### 4.2 Schedule (planning board and My schedule)

| Method | Path | Purpose | Roles |
|---|---|---|---|
| GET | `/schedule?unitId=&from=&to=` | **Planning board payload:** days, coverage per block (required / scheduled / actual, each with the lowest hourly count and the short hour ranges, see below), officer rows with assignments, overtime status per officer, warnings, `overridesThisPeriod`, `asOf` and `publishedState` (see below) | SUPERVISOR, AUDITOR |
| GET | `/me/schedule?from=&to=` | My shifts, hours this pay period, overtime this quarter, next shift, `asOf` (the server's "today", as on `GET /schedule`) | EMPLOYEE |
| POST | `/rule-checks` | Preview any change (§3) | SUPERVISOR; EMPLOYEE for own proposals |
| POST | `/assignments` | Assign a shift (§3 rules apply) | SUPERVISOR |
| PATCH | `/assignments/{id}` | Move or change a shift (`If-Match`) | SUPERVISOR |
| DELETE | `/assignments/{id}` | Cancel (sets `CANCELLED`; never hard-deletes) | SUPERVISOR |
| POST | `/schedule-periods/{id}/publish` | Publish a period | SUPERVISOR |
| POST | `/absences` | Record sick, vacation or other (type only) | SUPERVISOR |

Publishing is one-way in the prototype: it sets the period to `PUBLISHED`, records `published_at` and
`published_by`, writes a `publish_schedule_period` audit row and answers `{id, status, publishedAt}`.
A second publish answers `409`; an unknown period is `404`, and another unit's period is also `404`
so its existence is not revealed. The board's `publishedState.published` reads the same rows.

**A period is one roster week (Monday to Sunday) of one unit.** The demo dataset seeds one period
per unit and per week of the demo window: the weeks that ended before the demo day are `PUBLISHED`
(they are history), and the week the demo day falls in and the weeks after it are `DRAFT`, so a
supervisor has a period to publish on a fresh stack. `GET /schedule` returns the period it shows as
`period { id, label, status }` (see the board header below), and that id is what
`POST /schedule-periods/{id}/publish` takes. The status column is `DRAFT` or `PUBLISHED`; there is
no `UNPUBLISHED` status in the schema.

**Move and cancel (`PATCH` / `DELETE /assignments/{id}`): the exact contract** (decided 2026-11-20 so the builder doesn't have to guess):

| Topic | Rule |
|---|---|
| Version | `shift_assignment.version` is the version. `GET /schedule` shift items carry `version`; `POST`, `PATCH` and `DELETE` answers carry `ETag: "<version>"`. Each successful move or cancel increments it. |
| `If-Match` | **Required** on both. Missing: `428 Precondition Required` (`.../problems/if-match-required`). Stale: `412` (`.../problems/stale-version`). The `If-Match` check happens inside the per-officer lock (ADR-021), so two concurrent edits can't both pass it. |
| Cancel body | `DELETE` takes a JSON body `{ "reason": "…" }`. The reason is **required, at least 10 characters after trimming** (same rule as overrides and unlock), else `400`. It isn't stored on the assignment: it goes into the `cancel_assignment` audit event (`before` = the assignment, `after` = `{ status: CANCELLED, reason }`). |
| Cancel effect | Sets `status = CANCELLED`; never deletes. No rule check (removing a shift can't break a rest or hours rule; coverage shows any gap). Answers `200` with `{ id, status, version }`. A second cancel is `409` (`.../problems/already-cancelled`). |
| Move body | `PATCH` takes the same body as `POST /assignments`: `change` with **all four** of `employeeId`, `unitId`, `shiftTemplate` and `startAt` (the full target, not a partial patch), plus optional `acknowledgeWarnings` and `override`. `kind` and `source` don't change. A move needs no separate reason; an override carries its own. |
| Move rules | The full §3 pipeline runs on the target, with the assignment's **own current slot left out** of the officer's existing shifts, so it can't conflict with itself. `422` blocked or warnings, and overrides, exactly as §3. Updated in place: same `id`, new `version`, a `move_assignment` audit event with `before`/`after`. If the officer changes, both officers' locks are taken in id order. Answers `200` with the save outcome. |
| Locked period | `409 .../pay-period-locked` if the **current** work date is in a locked period (move and cancel), or the **target** work date is (move). |
| Started shifts | `409 .../shift-started` if the assignment has started by the server's "today" clock (the demo clock on the demo profile). Past shifts are corrected in Time & attendance, not on the schedule. |
| Recorded actual or absence | `DELETE` answers `409 .../actual-recorded` when a time entry already references the shift, and `409 .../absence-recorded` when an absence row does, even if the start time alone would not have refused it. Correct the record in Time & attendance instead. |
| Filled open shift | Cancelling an assignment that filled an open shift (`open_shift.filled_assignment_id`) puts that open shift back to `OPEN` with `filled_assignment_id` cleared, so the gap is visible and can be offered again. **Offer rows are left unchanged** (not set to `WITHDRAWN`): the confirmed offer stays as history, and the cancellation is in the audit trail. **Moving** such an assignment is refused with `409 .../fills-open-shift`: cancel it and assign again. |
| Offers | A pending offer (`offer: true` chip) is not an assignment, so these endpoints don't apply to it. Withdrawing an offer is **not built** (docs/10 §8). |
| Order of checks | role (`403`) → unknown or out of scope (`404`) → body (`400`) → `If-Match` (`428`, `412`) → state (`409`: locked, started, actual or absence recorded, already cancelled, fills open shift) → rules (`422`, move only). |
| Roles | SUPERVISOR, own units only. For a move, both the current and the target unit must be in scope. |

**Coverage per block (ADR-013 revised, ADR-017):** coverage is hourly, so one number per block can hide a short hour. `GET /schedule` returns a flat `coverage` array (one entry per block per day); `GET /display/today` uses the same block shape. Each entry carries:

```json
{ "block": "EVENING", "date": "2026-11-20", "required": 5,
  "scheduled": { "lowestHourly": 4, "shortHours": [ { "from": "15:00", "to": "17:00", "count": 4 } ], "maxHourly": 6 },
  "actual":    { "lowestHourly": 5, "shortHours": [], "maxHourly": 6 },
  "covered": false }
```

The payload also has `unit { id, name }`, `days` (ISO dates), `asOf` (the demo today), `officers`
(rows with day cells of `SHIFT` items), `warnings`, `overridesThisPeriod`,
`publishedState { published, unpublishedChanges }` and `period { id, label, status }`, matching
`web/src/api/types.ts`.

`lowestHourly` is the minimum headcount over the block's hours; `shortHours` lists merged hour ranges below `required` (`to` is exclusive); `covered` is true when `shortHours` is empty. `actual` is present for past hours only. The display version has the same shape and still **no names**.

**Board header fields:** four facts on the board are neither per-officer nor per-block, so `GET /schedule` returns them at the top level of the payload:

```json
{ "asOf": "2026-11-19",
  "overridesThisPeriod": 1,
  "publishedState": { "published": true, "unpublishedChanges": 3 },
  "period": { "id": "9f0a…", "label": "16 – 22 Nov 2026", "status": "PUBLISHED" } }
```

`asOf` is the server's "today" (`SC_DEMO_TODAY` on the demo profile), so the board marks the same days the api does instead of guessing from the browser clock. `overridesThisPeriod` counts the emergency overrides recorded in the pay period on the board.

`period` is the roster week the board shows: the `schedule_period` row whose dates **contain the board's range** (`from` and `to`). It is `null` when the range is not inside one period — a board that spans two weeks has no single period. `id` is what `POST /schedule-periods/{id}/publish` takes, `label` is the week for people ("16 – 22 Nov 2026") and `status` is `DRAFT` or `PUBLISHED`.

`publishedState.published` is true when that period is published. `publishedState.unpublishedChanges` counts the shifts of that period that were **assigned, moved or cancelled after it was published**; the source is the append-only audit trail (the `assign_shift`, `move_assignment` and `cancel_assignment` events of those shifts). It is `null` when the period is not published: there is no publication to compare against, and the board says "not published" instead of a change count.

### 4.3 Overtime

| Method | Path | Purpose | Roles |
|---|---|---|---|
| GET | `/open-shifts?unitId=&from=&to=&status=` | Open shifts | SUPERVISOR |
| POST | `/open-shifts` | Create an open shift | SUPERVISOR |
| GET | `/open-shifts/{id}/candidates` | **Ranked list:** order from the overtime-ranking rule table; each candidate has eligibility (`ELIGIBLE`, `WARN`, `SKIPPED`, `UNAVAILABLE`) and rule results | SUPERVISOR |
| POST | `/open-shifts/{id}/offers` | `{ "employeeIds": [...], "ordered": false }` → offers recorded in-app | SUPERVISOR |
| POST | `/open-shifts/{id}/assign` | Assign directly (§3 rules and overrides apply) | SUPERVISOR |
| GET | `/me/offers?status=OFFERED` | My pending offers | EMPLOYEE |
| POST | `/offers/{id}/accept` · `/offers/{id}/decline` | Respond. Accepting re-checks rules; the supervisor then confirms. | EMPLOYEE (own) |
| POST | `/offers/{id}/confirm` | Confirm an accepted offer → creates the assignment | SUPERVISOR |

**Who appears in the candidate list.** The list is the fair-distribution order for officers in the
caller's unit scope; a supervisor outside that scope gets `404` for the shift. The ranking is still
fewest overtime hours this quarter, ties by seniority (O-02); an officer a Block rule would stop is
`SKIPPED` in place, and an officer who cannot take the shift (unqualified for Control or Escort,
already scheduled) is `UNAVAILABLE` in place, so the fairest next person stays visible (O-03, PC-09).

**Offers and confirmation.** The supervisor makes offers only to officers the rules allow; a
`BLOCK` at offer time is refused with the rule results. The employee's accept re-checks the rules.
The confirmation re-checks again: a `BLOCK` refuses, a warning the supervisor already saw in the
offer-time snapshot does not need a second answer, but a **new** warning is refused with
`422 warnings-need-acknowledgement`. The assignment is created through the normal rules/override
path (`POST /assignments`), so S-04 and the audit event still hold.

### 4.4 Proposals (employee shift planner)

| Method | Path | Purpose | Roles |
|---|---|---|---|
| POST | `/proposals` | Submit `{ "note", "items": [...] }`; each item is rule-checked and the results stored | EMPLOYEE |
| GET | `/me/proposals` | My proposals and their status | EMPLOYEE |
| GET | `/proposals?unitId=&status=SUBMITTED` | Supervisor inbox | SUPERVISOR |
| POST | `/proposals/{id}/decision` | `{ "items": [ { "id", "accept": true } ] }`; accepted items become assignments (rules re-run) | SUPERVISOR |

### 4.5 Time and payroll

| Method | Path | Purpose | Roles |
|---|---|---|---|
| GET | `/pay-periods` | Periods with status, the period's overtime threshold and the lock totals | SUPERVISOR, AUDITOR |
| GET | `/pay-periods/{id}/time-entries?employeeId=` | Scheduled vs actual entries with pay codes, the officer's name and unit, the actual start and end, and the unpaid extension under 30 min (P-04) | SUPERVISOR, AUDITOR; EMPLOYEE (own) |
| PUT | `/time-entries/{id}` | Record actuals (worked as scheduled / adjusted times / absence type) | SUPERVISOR |
| POST | `/pay-periods/{id}/lock` | Lock: actuals become read-only. **Refused with `409`** (`type: .../problems/missing-actuals`, body lists `missing: [{ assignmentId, employeeId, start }]` and a count) while any shift in the period that has ended (`end_at ≤ now`) has no actual time entry or absence (ADR-017). **Idempotent:** locking a period that is already `LOCKED` returns `200` with the period view and writes no second audit row. Facility-wide: any supervisor with at least one unit in scope (ADR-022) | SUPERVISOR |
| POST | `/pay-periods/{id}/unlock` | `{ "reason" }`; audited with actor and reason. Facility-wide (ADR-022) | SUPERVISOR |
| GET | `/pay-periods/{id}/payroll-export` | `text/csv`; locked periods only; records a `payroll_export` row with the actor and file hash. Facility-wide: every officer in the period, not only the caller's units (ADR-022) | SUPERVISOR |

**Time entries and pay periods (what the Time and attendance screen needs):** a time entry carries the officer's `employeeName` and the `unitId` / `unitName` it belongs to, so the grid needs no second call; when something was recorded it carries `actualStart` and `actualEnd`, and an extension under 30 minutes that is not paid is `unpaidExtensionMinutes` (P-04). A shift that has ended (`end_at ≤ now`) with no actual and no absence is `needsActual: true`. A pay period carries `overtimeThresholdHours` (80 h by default, ADR-016) and the totals the lock confirmation repeats: `totals.officers`, `totals.workedHours` and `totals.overtimeHours`.

**Overtime classification:** overtime is computed per pay period (P-01): hours beyond the threshold, in time order, get overtime codes. Any change to a period's actuals recalculates its codes; locking freezes them.

**Payroll CSV columns:** `employee_no, pay_period_start, pay_period_end, work_date, pay_code, hours, unit_code, cost_centre`, with hours to 2 decimals in 15-minute increments. Totals per employee must equal the sum of actual time entries (tested).

### 4.6 Reports

| Method | Path | Purpose | Roles |
|---|---|---|---|
| GET | `/reports/coverage?from=&to=&unitId=&groupBy=day\|week` | Required vs scheduled vs actual staff-hours and fill rate | SUPERVISOR, AUDITOR |
| GET | `/reports/hours?from=&to=&employeeId=` | Scheduled, worked, and hours by pay code per officer | SUPERVISOR, AUDITOR; EMPLOYEE (own only) |
| GET | `/reports/overtime?from=&to=&top=` | Overtime hours by officer and unit | SUPERVISOR, AUDITOR |
| GET | `/reports/overrides?from=&to=` | Emergency overrides with reasons | SUPERVISOR, AUDITOR |

**CSV export:** each report answers `text/csv` on the same path when the request sends `Accept: text/csv`; the web's Export CSV button uses that. Columns: coverage `week, required_hours, scheduled_hours, actual_hours, scheduled_percent, actual_percent, planned`; hours `employee_no, name, scheduled, worked, regular, overtime_15, overtime_20, sick, vacation`; overtime `employee_no, name, overtime_hours`; overrides `at, employee, unit, rule_codes, actor, reason`. Cells are RFC 4180 quoted where needed and a leading `=`, `+`, `-`, `@`, TAB or CR is neutralised with a single quote, so a spreadsheet cannot evaluate a value as a formula.

**Definitions:** coverage is hourly (ADR-013): required staff-hours are the unit requirements per block × the block's hours, and scheduled/actual hours count each assignment or actual entry once per hour slot it covers. A week that has not started is `planned` with no actual figure; an in-progress week compares against the required hours that have elapsed at the demo "today". Overtime is classified per pay period through the same `PayClassifier` as payroll, so a full period's `OT15` hours equal the payroll export's. For a custom range, classification covers only the entries with a work date inside the range, so a partial period can differ from the payroll export. Override rows carry the reason, the rule codes and the actor who recorded them (docs/09 §6). Defaults when no range is given: coverage = the last six weeks plus next week; hours = the latest locked pay period; overtime = the current quarter; overrides = the last four weeks.

### 4.7 Rules administration

| Method | Path | Purpose | Roles |
|---|---|---|---|
| GET | `/rule-sets` | Versions and status | RULES_ADMIN, RULES_APPROVER, AUDITOR, SUPERVISOR (read) |
| GET | `/rule-sets/{version}/tables/{code}` | Rows, column schema and plain-language sentences | same |
| POST | `/rule-sets/drafts` | `{ "basedOn": 7, "reason" }` → new draft (also used to roll back to an older version) | RULES_ADMIN |
| PUT | `/rule-sets/{version}/tables/{code}/rows` | Replace a table's rows in a draft (no `If-Match` in the prototype: saving clears the build, and a stale build can't be submitted) | RULES_ADMIN |
| POST | `/rule-sets/{version}/build` | Validate → compile (Drools) → run test scenarios → dry run on the published roster; returns the report | RULES_ADMIN |
| POST | `/rule-sets/{version}/submit` | Submit a successfully built draft for approval | RULES_ADMIN |
| POST | `/rule-sets/{version}/approve` · `/reject` | Second-person decision (`approved_by ≠ created_by`) | RULES_APPROVER |
| POST | `/rule-sets/{version}/publish` | Hot-swap the live rule base at the effective date | RULES_APPROVER |

**The build is the evidence, and it goes stale if the rows move.** `build` stores a fingerprint of
the exact rows it validated, compiled and ran; saving rows again clears the report and the
fingerprint, and `submit`/`publish` refuse an older build with `409`. At boot the live rule base is
the published version's rows from PostgreSQL, not a code constant, so a restart keeps the published
rules. The dry run reports counts per rule, unit and old→new outcome, never names (ADR-017).
Publishing an *older* approved version after a newer one is allowed and supersedes the newer one: it
is the rollback path, and the audit row records which version went live.

**Excel export and import: future work (not built in the prototype).** The design planned
`GET /rule-sets/{version}/tables/{code}/export` (an `.xlsx` Drools decision table) and
`POST …/import` (a multipart `.xlsx` into a draft, then build as usual). Neither exists, and there
is no plan to build them for the prototype (docs/10 §8). If built, an import must go through the
same validation as the grid (R24/R28: rule values are code input).

### 4.8 Wall display, audit, operations

| Method | Path | Purpose | Roles |
|---|---|---|---|
| GET | `/display/today` | Counts per unit and block, open shifts and overtime counts. **No names.** | DISPLAY, SUPERVISOR (own units), AUDITOR |
| GET | `/audit-events?entityType=&entityId=&from=&to=` | Audit trail | AUDITOR, SUPERVISOR (own units) |
| GET | `/version` | Build version, git commit, live rule set version, and `asOf` (the server's "today", so the web's clock shows the demo day) | any |
| GET | `/actuator/health` | Liveness and readiness. Internal only, not proxied by nginx. | container network |

## 5. Screen-to-endpoint map

| Screen (UI canvas) | Main calls |
|---|---|
| Planning board | `GET /schedule`, `POST /rule-checks`, `POST/PATCH/DELETE /assignments`, `POST /schedule-periods/{id}/publish` |
| My schedule | `GET /me/schedule`, `GET /me/offers`, `POST /offers/{id}/accept`, `POST /rule-checks`, `POST /proposals` |
| Overtime board | `GET /open-shifts`, `GET /open-shifts/{id}/candidates`, `POST /open-shifts/{id}/offers`, `POST /open-shifts/{id}/assign` |
| Rules | `GET /rule-sets…`, `PUT …/rows`, `POST …/build`, `…/submit`, `…/approve`, `…/publish` (Excel export/import: not built) |
| Reports | `GET /reports/*`, `GET /pay-periods/{id}/payroll-export` |
| Wall display | `GET /display/today` every 60 s |
