# ShiftCircle — API Specification

**Status:** Draft v1.0 · 2026-11-19 · REST + JSON · the generated OpenAPI document is the source of truth once code exists

## 1. Conventions

| Topic | Convention |
|---|---|
| Base path | `/api/v1` (nginx proxies `/api/` to the api container) |
| Docs | OpenAPI 3 at `/api/v1/openapi.json`; Swagger UI at `/api/swagger-ui` (`demo` and `dev` profiles only) |
| Auth | `Authorization: Bearer <token>` from mock sign-in (see `09-access-control.md`) |
| IDs | UUID strings |
| Time | Instants as ISO-8601 with offset (`2026-11-21T07:00:00-06:00`); dates as `YYYY-MM-DD`; all in `America/Regina` |
| Lists | `?page=0&size=50`; response `{ "items": [...], "page": 0, "size": 50, "total": 123 }` |
| Concurrency | Editable resources return `ETag: "<version>"`; updates require `If-Match`. A stale version gets `412 Precondition Failed`. |
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
| `422` | **A rule blocked the change** (body includes `ruleResults`), or Warn results need acknowledgement |

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

**Coverage per block (ADR-013 revised, ADR-017):** coverage is hourly, so one number per block can hide a short hour. `GET /schedule` returns a flat `coverage` array (one entry per block per day); `GET /display/today` uses the same block shape. Each entry carries:

```json
{ "block": "EVENING", "date": "2026-11-20", "required": 5,
  "scheduled": { "lowestHourly": 4, "shortHours": [ { "from": "15:00", "to": "17:00", "count": 4 } ], "maxHourly": 6 },
  "actual":    { "lowestHourly": 5, "shortHours": [], "maxHourly": 6 },
  "covered": false }
```

The payload also has `unit { id, name }`, `days` (ISO dates), `asOf` (the demo today), `officers`
(rows with day cells of `SHIFT` items), `warnings`, `overridesThisPeriod` and
`publishedState { published, unpublishedChanges }`, matching `web/src/api/types.ts`.

`lowestHourly` is the minimum headcount over the block's hours; `shortHours` lists merged hour ranges below `required` (`to` is exclusive); `covered` is true when `shortHours` is empty. `actual` is present for past hours only. The display version has the same shape and still **no names**.

**Board header fields:** three facts on the board are neither per-officer nor per-block, so `GET /schedule` returns them at the top level of the payload:

```json
{ "asOf": "2026-11-19",
  "overridesThisPeriod": 1,
  "publishedState": { "published": true, "unpublishedChanges": 3 } }
```

`asOf` is the server's "today" (`SC_DEMO_TODAY` on the demo profile), so the board marks the same days the api does instead of guessing from the browser clock. `overridesThisPeriod` counts the emergency overrides recorded in the pay period on the board. `publishedState` says whether the period is published and how many changes are not published yet.

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
| PUT | `/rule-sets/{version}/tables/{code}/rows` | Replace a table's rows in a draft (`If-Match`) | RULES_ADMIN |
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
| GET | `/rule-sets/{version}/tables/{code}/export` | `.xlsx` Drools decision table | RULES_ADMIN, RULES_APPROVER |
| POST | `/rule-sets/{version}/tables/{code}/import` | multipart `.xlsx` into a draft (then build as usual) | RULES_ADMIN |

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
| Rules | `GET /rule-sets…`, `PUT …/rows`, `POST …/build`, `…/submit`, `…/approve`, `…/publish`, export/import |
| Reports | `GET /reports/*`, `GET /pay-periods/{id}/payroll-export` |
| Wall display | `GET /display/today` every 60 s |
