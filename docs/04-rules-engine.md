# ShiftCircle — Rules Engine Design (Drools)

**Status:** Draft v0.5 · 2026-11-19 · replaces the custom-engine design (see ADR-012)

## 1. Goals

1. A **non-technical person** (HR, labour relations, a senior supervisor) can **read** every rule in plain language and **change** values (limits, severity, override, effective dates) without a developer.
2. Rules run on an established, standards-based engine: **Drools** (Apache KIE).
3. A change can't break the system or quietly weaken a safeguard. Every change is validated, tested, approved, versioned and reversible.

## 2. The approach in one picture

```mermaid
flowchart LR
    subgraph Admin["Rules screen (non-technical)"]
        G[Friendly grid per rule table<br/>labels · dropdowns · help text<br/>plain-language preview]
        X[Download / upload Excel<br/>for offline review]
    end
    subgraph API["api container"]
        V[Validate values]
        C[Compile with Drools<br/>templates + rows → rules]
        T[Run regression scenarios<br/>+ dry run on current roster]
        P[Approve & publish<br/>maker / checker]
        K[(Live Drools KieBase<br/>hot-swapped)]
        F[Fact builders (Java)<br/>rest gaps · rolling hours<br/>consecutive runs · 16 h shifts · period hours]
    end
    DB[(PostgreSQL<br/>rule tables + versions)]
    G --> V --> C --> T --> P --> K
    X <--> DB
    G <--> DB
    P --> DB
    F --> K
```

## 3. Who does what

| Layer | Written by | What it does |
|---|---|---|
| **Fact builders** (Java) | Developers | Build the after-change schedule and compute the **derived facts** a rule needs: `RestGap` (hours between two shifts, previous shift kind), `RollingHours` (hours in any 24 h / 7 d), `ConsecutiveRun` (days, 12 h shifts, nights), `LongShiftCount` (16 h shifts in 7 / 28 days), `DaysOffRun`, `PeriodHours` (hours so far in the week and pay period, for overtime). Time maths is hard to get right in rule syntax, so it lives in tested Java. |
| **Rule templates** (Drools) | Developers, once per rule table | The technical "when … then …" pattern for a kind of rule, e.g. *when a RestGap after shift kind X is less than N hours, record a result with severity S*. Hidden from non-technical users. |
| **Decision-table rows** (data) | **Non-technical rules admins** | One row = one rule. Columns are plain-language fields: *After shift type · Minimum rest (hours) · Result · Override allowed · Message*. |

Drools is built for exactly this split: decision tables generate rules from rows of data, each row combined with a template. Each row becomes one rule, and each column is a condition, an action or another rule attribute.

## 4. What a non-technical admin sees

Each rule table is shown as a simple grid. Example, **Rest between shifts**:

| Rule | After this kind of shift… | …the officer needs at least (hours) off | If not | Override | Message shown |
|---|---|---|---|---|---|
| U-01 | Any shift (within any 24 h) | 8 | Block | Emergency only | Less than 8 hours' rest in 24 hours (Employment Act minimum). |
| U-02 | Regular shift | 12 | Warn | — | Less than the 12-hour rest target between shifts. |
| U-03 | 16-hour shift | 12 | Block | Emergency only | Needs 12 hours off after a 16-hour shift. |
| U-04 | Overtime extension of 4 h or more | 10 | Warn | — | Short rest after a long overtime extension. |

Under each row the screen shows a generated **plain-language sentence**:
> *"After a 16-hour shift, an officer must have at least 12 hours off before their next shift. If not, the change is **blocked**; a supervisor may override only in an emergency, with a reason."*

The admin can change numbers, choose from dropdowns (shift kinds, Block / Warn / Info, override options), switch a row on or off, set an effective date, and add a row (e.g. a new rest rule after a 12-hour night). They **can't** edit the technical template. That's what keeps the system safe.

**Excel round-trip:** any table can be downloaded as a standard Drools spreadsheet decision table (`.xlsx`) to review with labour relations or the union, and uploaded back. Uploads go through the same validate → test → approve pipeline (§6). The spreadsheet's technical header area (Drools' RuleSet and RuleTable keywords) is generated and protected.

## 5. Rule tables

| Rule table | Rows (from `05-union-rules.md`) | Columns the admin edits |
|---|---|---|
| Rest between shifts | U-01 to U-04 | After shift kind · window · minimum hours · result · override · message |
| Maximum hours | U-05, U-06, U-14 | Window (24 h / 7 d / consecutive) · max hours · result · override |
| Consecutive work | U-08 to U-10 | What's counted (days / 12 h shifts / nights) · max · result when scheduled · result when overtime |
| 16-hour shifts | U-11 | Window (days) · max 16 h shifts · result |
| Days off | U-12 | Days off required · within how many days (the "a break of 24 h or less does not count" clause is fixed at 24 h in the fact builder) |
| Pay classification | P-01 to P-06 | Threshold window (week / pay period) · threshold hours · whether paid leave counts · rate bands (hours, pay code, multiplier) · minimum hours |
| Overtime ranking | O-01 to O-04 | Sort order (OT hours this quarter, seniority…) · skip if (rule result) · voluntary/ordered limits |
| Shift types | L-01, S-03 | Shift code · start time · length · units allowed (ADR-015) |

Staffing and qualification checks (per unit) are maintained on the facility setup screen, not in the decision tables.

## 5a. Publish-time validation the builders require (review F4)

Some columns are only meaningful for the values the fact builders actually produce. A row whose
`windowHours` is 48, for example, would never fire: the builders emit 24-hour, 168-hour and
pay-period facts only. A rule that can never fire is worse than a broken one, because the admin
believes it is protecting people. The build step (writer: rules publish pipeline, step 11) must
reject such rows with a plain-language message ("Window must be 24 or 168 hours") before a version
can be submitted, and the same validation belongs in `TemplateColumns` where it can be expressed
there (for example, a warning level at or above the ceiling is refused).

## 6. Safe change pipeline

1. **Edit**: a rules admin changes rows in a **draft** version (or uploads an Excel file).
2. **Validate**: types, ranges and sanity checks (e.g. minimum rest can't be below the 8-hour legal floor; a Block rule can't be switched to Info without a reason). Errors are shown in plain language.
3. **Compile**: Drools builds a **staging** rule base from templates plus rows. Compilation problems are translated into "row 3, column *Minimum rest*: must be a number".
4. **Test**: the automated regression scenarios run (T1–T9 and the boundary cases), plus a **dry run** against the current roster: "This change adds 14 warnings and 2 blocks on the published schedule."
5. **Approve (maker/checker)**: a second person with the approver role reviews the before/after comparison and the impact, then publishes. One person can't both edit and publish.
6. **Publish**: the new rule base is swapped in live, with no restart. The version is stored with who, when, why and the effective date.
7. **Roll back**: any earlier version can be republished through the same approval.

## 7. Runtime evaluation

```text
ScheduleChange ─▶ FactBuilders (Java) ─▶ insert facts into a Drools session
                                         ─▶ fire rules (decision tables)
                                         ─▶ collect RuleResult facts
                                         ─▶ API returns PASS / WARN / BLOCK + messages + evidence shifts
```

- Stateless sessions (one per check): fast and thread-safe.
- Each `RuleResult` records the rule ID, outcome, message, the evidence shifts, the **rule-table version** and the facts used (e.g. `restHours = 4.0, minHours = 8`), so every decision can be audited later.
- Time is stored as UTC and evaluated in `America/Regina` (no daylight saving time, but the code is still timezone-aware).

## 8. Technology and compatibility

| Item | Choice |
|---|---|
| Engine | Drools 10.x (Apache KIE, currently incubating), embedded as libraries through the KIE API. We don't use the KIE Spring Boot starter. |
| Rule authoring | Rule templates plus data rows (`drools-templates`); spreadsheet decision table import/export (`drools-decisiontables`) |
| Java / Spring | **Java 21 LTS** + Spring Boot 4.x, pending a Day 1 compatibility check (see below) |

**Compatibility note:** the Apache KIE 10.2.0 release notes list an upgrade to Spring Boot 3.5.10 and Java 21 support. Our earlier target (Java 25 + Spring Boot 4.1) is newer than what KIE says it has tested. Because we embed Drools as plain libraries rather than through its Spring integration, Spring Boot 4.x should work, but we'll **prove it with a Day 1 spike**. Fallback: Spring Boot 3.5.x, which is past its free open-source support, so that's a governance trade-off to record.

## 9. Trade-offs we're accepting

- **More moving parts** than a custom engine: Drools adds dependencies, startup time and a learning curve for developers.
- **Project maturity:** Drools is long-established, but under Apache it is currently an *incubating* project. A ministry would want to confirm its support position (community vs. commercial).
- **Not everything belongs in a table.** Time-window maths stays in Java fact builders. That's deliberate: it keeps the tables readable.
- **DMN** (the decision-modelling standard, also supported by KIE) was considered. Its visual editors would need extra tooling outside our three containers, so it's noted as a future option, mainly for pay classification.
