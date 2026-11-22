# ShiftCircle — Mock Collective-Agreement Rule Set

**Status:** Draft v0.1 · 2026-11-19
**What this is:** A **fictional** "hours of work" rule set for the prototype's rules engine, modelled on real public sources. It is **not** the actual agreement covering Saskatchewan correctional officers, and it isn't legal or labour-relations advice. Every rule is labelled with what it's based on, so a reviewer can see what's real and what's made up.

## 1. Sources consulted

| Code | Source | What we took from it |
|---|---|---|
| **SEA** | *The Saskatchewan Employment Act* and Saskatchewan Employment Standards guidance | The legal floor: 8 consecutive hours' rest in any 24 h; no more than 16 h of work in any 24 h, except in an emergency |
| **PSGE** | SGEU–Government of Saskatchewan PS/GE Collective Bargaining Agreement 2022–2025 (Articles 9 and 11) | Overtime rates and minimums, rest days, modified 12-hour patterns, breaks. It covers the public service and mentions corrections workers. **Check whether a newer agreement or local letters of understanding apply.** |
| **CX** | Treasury Board – UCCO-SACC-CSN Correctional Services (CX) agreement, Article 21 (federal correctional officers) | Rest between shifts, consecutive days, days of rest, schedule posting, short-notice change premium, equitable overtime distribution, limits on 16-hour shifts in a cycle |
| **NU** | Government of Nunavut HR manual, shift-work policy (HRM 1202) | Maximum consecutive hours, consecutive shifts, consecutive days |
| **NWT** | GNWT–UNW agreement, Appendix A2 (corrections officers) | Maximum 7 consecutive shifts |
| **MOCK** | Invented for the prototype | Plausible values where no public source was found; **needs validation** |

**Important caveat:** the PS/GE agreement says 12-hour (modified) patterns need a **local agreement**, approved by both parties. The exact rules at a Saskatchewan correctional centre are likely set out in local letters of understanding that aren't public. That's exactly where real-world input is needed (§6).

## 2. Rule set (all values are configurable)

Severity: **Block** = can't be saved. An emergency override exists only where marked "emergency override" (U-01, U-03, U-05, and U-06 when built). Every other Block, including U-08, U-09 and U-14, can't be overridden in v1 (ADR-023) · **Warn** = needs acknowledgement · **Info** = guides the decision · **Pay** = affects how hours are classified for payroll.

### A. Rest and fatigue

| ID | Rule (plain language) | Default | Severity | Based on |
|---|---|---|---|---|
| U-01 | At least **8 consecutive hours** of rest in any 24-hour period | 8 h | Block (emergency override) | **SEA** (statutory floor) |
| U-02 | **Target 12 hours** between the end of one regular shift and the start of the next | 12 h | Warn | **MOCK**, aimed above the floor. CX makes 8 h a "reasonable effort" target |
| U-03 | After a **16-hour shift**, at least 12 hours off before the next shift | 12 h | Block (emergency override) | **MOCK**. No public rule found. CX gives 12 h rest after court attendance, which is an analogous concept |
| U-04 | After an **overtime extension of 4 h or more**, at least 10 hours off before the next shift | 10 h | Warn | **MOCK** |
| U-05 | No more than **16 hours worked in any 24-hour period** | 16 h | Block (emergency override) | **SEA** |
| U-06 | No more than **16 consecutive hours** on duty, and no more than **2 shifts back-to-back** | 16 h / 2 | Block (emergency override), specified but not in rule set v1 (§3) | **NU** |
| U-07 | **Forward rotation** preferred (days → evenings → nights); flag a backward rotation inside a work block | — | Warn | **MOCK** (common fatigue-management practice) |

### B. Consecutive shifts and days off

| ID | Rule | Default | Severity | Based on |
|---|---|---|---|---|
| U-08 | Maximum **consecutive work days** (8-hour pattern) | 7 | Block (scheduled), no emergency override in v1 (override policy ACKNOWLEDGE; editable per rule through the rules admin approval flow); Warn (overtime-caused) | **NWT**, **NU** (7); CX allows up to 8 |
| U-09 | Maximum **consecutive 12-hour shifts** | 4 | Block (scheduled), no emergency override in v1 (override policy ACKNOWLEDGE; editable per rule through the rules admin approval flow); Warn (overtime-caused) | **MOCK**, matching common "4 on, 4 off" patterns |
| U-10 | Maximum **consecutive 12-hour overnight shifts** (19:00–07:00; A12 00:00–12:00 and N12 19:00–07:00 count) | 4 | Warn | **MOCK** (fatigue) |
| U-11 | Maximum **16-hour shifts**: 3 in any 7 days, 10 in any 28 days | 3 / 7 d · 10 / 28 d | Warn | **MOCK**, inspired by CX limits on 16-hour shifts within a work cycle |
| U-12 | At least **2 consecutive days of rest** in each 7-day period; a break of 24 h or less doesn't count as a day of rest | 2 days / 7 | Warn | **CX**, **PSGE** (two consecutive rest days normally), **NU** |

### C. Hours over a period

| ID | Rule | Default | Severity | Based on |
|---|---|---|---|---|
| U-13 | Regular hours **average** 8 h × working days over the rotation cycle | per pattern | Info | **PSGE** (modified patterns) |
| U-14 | **Weekly ceiling**, including overtime: warn above 48 h, block above 60 h (the limit itself passes, like every other limit; exactly 60 h is a warning). The planner's warning group is named by the warning level, **"Week over 48 hours"** | 48 / 60 | Warn above 48 h; Block above 60 h, no emergency override in v1 (override policy ACKNOWLEDGE; editable per rule through the rules admin approval flow) | **MOCK** |
| U-15 | **Overtime status** shown on the planning board: under / approaching (within 8 h of the threshold) / in overtime | per period | Info | **MOCK** (feature) |

### D. Pay classification (what feeds payroll)

| ID | Rule | Default | Severity | Based on |
|---|---|---|---|---|
| P-01 | **Overtime is based on total hours in the period:** hours worked beyond the threshold (default **80 h per 2-week pay period**; a weekly 40 h threshold can be selected) are overtime. Rostered 12 h and 16 h shifts aren't overtime by themselves. | 80 h / pay period | Pay | Lead's direction; relies on an averaging / modified work arrangement (SEA, **PSGE** 9.3.5.2) |
| P-01b | Overtime rate bands in a pay period: default **all overtime hours at 1.5×**; an optional band (e.g. 2× beyond a set number of overtime hours) can be switched on | 1.5× | Pay | **MOCK** (PSGE pays 1.5× for the first 4 h then 2× per occurrence; confirm local practice) |
| P-02 | Any hours on an **assigned day of rest**: **2×**, with a **2-hour minimum** | 2× / 2 h · **off by default** | Pay | **PSGE**; confirm whether it applies alongside period-based overtime |
| P-03 | **Call-back:** minimum 2 hours at overtime rates | 2 h | Pay | **PSGE** |
| P-04 | Overtime under 30 minutes isn't paid | 0.5 h | Pay | **PSGE** |
| P-05 | Shift changed on **short notice (under 96 h)**: first changed shift gets a premium (code `CHG`) | 96 h | Pay / Warn | **CX** (pays 1.75×; our rate is a placeholder) |
| P-06 | Statutory holiday worked | placeholder | Pay | **MOCK**, to confirm |

### E. Scheduling and notice

| ID | Rule | Default | Severity | Based on |
|---|---|---|---|---|
| S-01 | Schedules **posted at least 28 days** before they start | 28 d | Warn | **CX** |
| S-02 | No more than **1 change of an officer's regular shift per cycle** without their consent (a change and a return count as one) | 1 | Warn | **CX** |
| S-03 | 12- and 16-hour patterns allowed only on units flagged as having a **local agreement** | per unit | Block | **PSGE** |
| S-04 | Overtime must be **authorized** by a supervisor, recorded with name and time | — | Block (**workflow-enforced**, not a decision table, ADR-019): `EXTRA` shifts and overtime offers are created or confirmed only by a `SUPERVISOR`, and each writes an audit event with actor and time | **PSGE** (written authorization) |

### F. Overtime allocation

| ID | Rule | Default | Severity | Based on |
|---|---|---|---|---|
| O-01 | Offer overtime **equitably** among available, qualified officers | — | Info (ranking) | **CX** |
| O-02 | Ranking: **fewest overtime hours this quarter** first, ties broken by **seniority** | quarter / seniority | Info | **MOCK** (CX leaves the method to local agreement) |
| O-03 | Officers who would break a Block rule (e.g. U-01, U-03, U-05) are **skipped**, shown as "bypassed: insufficient rest", and **not penalized** in the ranking | — | Info | **MOCK**. Whether a bypassed officer loses their turn has been disputed in practice, so this is a judgment call to confirm |
| O-04 | **Voluntary first.** Ordered (mandatory) overtime only after the voluntary list is used up, in reverse ranking, at most once per officer every 14 days | 14 d | Warn | **MOCK**. CX case law found that chronic reliance on ordered overtime to cover staffing shortages is inconsistent with the agreement |

### G. Shift lengths and breaks

| ID | Rule | Default | Severity | Based on |
|---|---|---|---|---|
| L-01 | Allowed regular lengths: **8 h, 12 h and 16 h** (16 h default 20:00–12:00). 12 h and 16 h only on units with a local agreement (S-03). | — | Block | Lead's direction + **PSGE** (modified work patterns over 8 h need a local agreement) |
| L-02 | Breaks: 2 × 15 min per 8-hour shift, 3 per 12-hour shift (shown only; not scheduled) | — | Info | **PSGE** |

## 3. What the prototype implements

To keep the build realistic, the prototype implements a core set and documents the rest.

| Implement (Must) | Document only (future) |
|---|---|
| U-01, U-02, U-03, U-04, U-05, U-08, U-09, U-10, U-11, U-12, U-14, U-15 · P-01, P-01b, P-04 · S-03, S-04 (workflow, ADR-019) · O-01, O-02, O-03 · L-01 | U-06, U-07, U-13 · P-02, P-03, P-05, P-06 · S-01, S-02 · O-04 · L-02 |

**Implementation notes (2026-11-20).** U-04 is a live Warn row in rule set v1 (docs/04 §3 and docs/10 §3 already require its boundary tests; 4 h extension trigger, 10 h rest). U-15 stays a Must **feature** but is **not** a decision-table row: under / approaching / in-overtime is a pay-period status, computed with the pay classification (P-01) and shown on the planning board — a rolling hours window cannot express it. S-04 is enforced by the workflow (ADR-019). Override policy (ADR-023): U-01, U-03 and U-05 are `EMERGENCY` (overridable with a reason of ≥ 10 characters, audited). U-08, U-09 and U-14 are Blocks with policy `ACKNOWLEDGE`, so the api refuses any override. The policy is a column of each rule row, changed through maker/checker like any value. Rule set v1 therefore has 19 rows across the 8 tables.

**Release 4 (2026-11-22).** Rule set **v3** (V12) adds **U-16** to the shift-types table: an 8-hour officer assigned to a night shift is a **Warn** the supervisor acknowledges, with the message "An 8-hour officer is assigned to a night shift; 8-hour officers work day or evening." It is a person-directed safeguard, not a new clause in the agreement, and it is not in the Must list above. The planner never produces the assignment (the 100/120/150 plan fingerprints are unchanged); the row fires only for a manual assignment. Version 2 stays as history; v3 is a baseline seed like v1 and v2, so subsequent edits use maker/checker.

## 4. How these map onto the engine

The rules are grouped into Drools decision tables (see `04-rules-engine.md` §5). The derived facts each table needs are computed by Java fact builders. The "rule type" names below are now those fact/template pairs:

| Rule type | Used by |
|---|---|
| `MinRestInWindow` | U-01 |
| `MinRestBetweenShifts` (optional "after shift of kind X") | U-02, U-03, U-04 |
| `MaxHoursInWindow` | U-05, U-14 |
| `MaxConsecutive` (days, or shifts of a kind) | U-08, U-09, U-10, U-06 |
| `MaxCountInPeriod` (rolling window) | U-11 (and trades later) |
| `MinConsecutiveDaysOff` | U-12 |
| `HoursThresholdStatus` | U-15 |
| `PayClassification` (ordered bands: first N h at rate A, then rate B; minimums) | P-01 to P-06 |
| *(none: workflow-enforced, ADR-019)* | S-04: only a `SUPERVISOR` can create or confirm `EXTRA` shifts and overtime offers (API role check), and every one writes an audit event with actor and time. No rule table. |
| `RankingPolicy` + eligibility filter | O-01 to O-04 |
| `AllowedShiftLengths` | L-01 |

## 5. Example configuration (mock; shown as data; in the app this is a decision-table grid)

```yaml
agreement: "Mock Hours-of-Work Schedule (fictional) v0.1"
effectiveFrom: 2026-10-01
rules:
  - code: U-01
    type: MinRestInWindow
    params: { minHours: 8, windowHours: 24 }
    severity: Block
    overridable: emergency
    source: "SEA s.2-13"
  - code: U-03
    type: MinRestBetweenShifts
    params: { afterShiftKind: Long16, minHours: 12 }
    severity: Block
    overridable: emergency
    source: "MOCK"
  - code: U-09
    type: MaxConsecutive
    params: { unit: Shift, shiftKind: Regular12, max: 4 }
    severity: { scheduled: Block, overtime: Warn }
    overridable: none   # override policy ACKNOWLEDGE in v1 (ADR-023)
    source: "MOCK"
  - code: U-11
    type: MaxCountInPeriod
    params: { event: Long16, limits: [ { days: 7, max: 3 }, { days: 28, max: 10 } ] }
    severity: Warn
    source: "MOCK (cf. CX 16-hour limits in a cycle)"
  - code: P-01
    type: PayClassification
    params: { window: PayPeriod, thresholdHours: 80, countPaidLeave: false, bands: [ { hours: null, code: OT15 } ], minimumUnpaidHours: 0.5 }
    source: "Lead's direction (period-based overtime)"
```

## 6. Questions to check against real practice

1. What are the regular rotations: 12-hour "4 on, 4 off"? 2 days / 2 nights / 4 off? 8-hour rotations?
2. Is there a **required rest after a 16-hour shift**, or after an overtime extension?
3. Maximum consecutive shifts or days, and any limit on **16-hour shifts** per week or month?
4. How is overtime **offered**: a seniority list, fewest hours, rotating? What happens when someone is skipped for insufficient rest?
5. Is overtime **ordered** (mandatory) when nobody volunteers, and how often can one person be ordered?
6. Overtime is based on hours per week or pay period (confirmed by the lead). What's the threshold (80 h per 2 weeks?), is it 1.5× throughout or 2× after some hours, and does paid leave count toward it?
7. How far ahead are schedules posted, and how much notice is given before a change?
