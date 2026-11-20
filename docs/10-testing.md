# ShiftCircle — Test Strategy and Test Data

**Status:** Draft v1.0 · 2026-11-19

## 1. Goals

1. Prove every rule behaves correctly **at its limits** (the most likely place for bugs, and what labour relations will ask about).
2. Prove the safeguards: blocks can't be bypassed without an override reason; maker/checker can't be skipped; locked pay periods can't change; employees can't see others' data.
3. Give the demo and the build record **repeatable** data and scenarios.
4. Produce 2–5 clear test cases (expected vs actual, including a failure or boundary case) for the build record.

## 2. Test layers

| Layer | Tool | What it covers | Runs |
|---|---|---|---|
| **Rule boundary tests** | JUnit 5 + AssertJ, in `shiftcircle-rules` (no Spring, no DB) | Each fact builder and each rule table row at under / exactly / over its limit (§3) | Every build, < 10 s |
| **Scenario library** | Same module; scenarios as data files (`src/test/resources/scenarios/*.json`) | Named end-to-end rule scenarios with expected outcomes (§4). **Also run by the rules publish pipeline.** | Every build + every rule publish |
| **Use-case / repository tests** | Spring Boot Test + Testcontainers PostgreSQL | Services with a real database: overlap constraint, locked-period trigger, audit append-only, maker/checker check, ranking, payroll classification | Every build |
| **API and authorization tests** | Spring MockMvc or RestAssured against the running app (Testcontainers) | Every endpoint's happy path, the 422 rule contract, 412 stale ETag, and **one test per denied/scoped cell** of the permission matrix (`09-access-control.md`) | Every build |
| **Payroll golden file** | Use-case test | Export for planted pay period PP-2026-11 must equal `golden/payroll-2026-10-26.csv` byte for byte | Every build |
| **Generator self-check** | Runs at the end of `DemoDataGenerator` and as a test | Dataset invariants (§6.6); build fails if any break | Every build + on demo start |
| **Frontend unit tests** | Vitest + React Testing Library | Components: `ShiftChip`, `RuleResultList`, decision-table editor validation, the preview → 422 → override hook | Every build |
| **End-to-end** | Playwright against `docker compose up` | The 5 demo flows (§5), on desktop and tablet viewport | Before submission (and in CI if time allows) |
| **Accessibility** | `@axe-core/playwright` in the E2E run | No serious/critical axe violations on each screen; keyboard-only run of flows E1 and E3 | Before submission |
| **Performance smoke** | E2E timing + a JUnit timing test | Planning board (100 officers × 14 days) < 1 s; rule check < 200 ms; 90-day report < 2 s (NFR-05) | Before submission |

**Definition of done for any feature:** its rule and use-case tests pass, its endpoints have authorization tests, and the demo flow touching it passes in Playwright.

## 3. Rule boundary matrix

Each line is at least three tests: just under, exactly at, just over. Times are local (America/Regina).

| Rule | Under (expected) | Exactly (expected) | Over (expected) |
|---|---|---|---|
| U-01 min 8 h rest in 24 h | 7 h 59 m rest → **BLOCK** | 8 h 00 m → **PASS** (inclusive) | 8 h 01 m → PASS |
| U-02 target 12 h between regular shifts | 11 h 59 m → **WARN** | 12 h → PASS | 13 h → PASS |
| U-03 12 h after a 16 h double | 11 h 59 m → **BLOCK** | 12 h → PASS | — |
| U-04 10 h after OT extension ≥ 4 h | extension 4 h + rest 9 h 59 m → **WARN**; extension 3 h 59 m + rest 8 h → PASS (rule not triggered) | 10 h → PASS | — |
| U-05 max 16 h in any 24 h | 16 h 00 m → PASS | 16 h 01 m → **BLOCK** | — |
| U-08 max 7 consecutive work days (8 h) | 7 → PASS | 8th day scheduled → **BLOCK**; 8th day via overtime → **WARN** | — |
| U-09 max 4 consecutive 12 h shifts | 4 → PASS | 5th scheduled → **BLOCK**; 5th via OT → **WARN** | — |
| U-10 max 4 consecutive 12 h nights | 4 → PASS | 5th → **WARN** | — |
| U-11 doubles: 1 per 7 d, 2 per 28 d | 1 in 7 d → PASS | 2nd within 7 d → **WARN**; 3rd within 28 d → **WARN** | double exactly 7 d later → PASS (window boundary) |
| U-12 2 consecutive days off per 7 | 48 h off → PASS | 47 h 59 m off → **WARN** (a break of 24 h or less isn't a day of rest) | — |
| U-14 weekly ceiling 48 warn / 60 block | 48 h → PASS | 48.25 h → **WARN**; 60.25 h → **BLOCK** | — |
| P-01 OT on a regular day: first 4 h 1.5×, then 2× | 4 h OT → 4 × OT15 | 4.25 h → 4 × OT15 + 0.25 × OT20 | 6 h → 4 × OT15 + 2 × OT20 |
| P-02 day of rest: 2×, min 2 h | 1 h worked → paid 2 h OT20 | 2 h → 2 h OT20 | 8 h → 8 h OT20 |
| P-04 OT under 30 min unpaid | 29 m → 0 | 30 m → 0.5 h | — |
| L-01 16 h only as overtime | 16 h as REGULAR → **BLOCK** | 16 h as OVERTIME → PASS | — |
| Time zones / midnight | Night 23:00–07:00 crossing midnight: `work_date` = start date; rest maths correct across midnight and month end (31 Oct → 1 Nov) | | |

## 4. Scenario library (named, reusable)

These are the verification cases. Pick 2–5 for the build record (recommended: **T2, T3, T7, T8, T9**).

| ID | Scenario | Expected |
|---|---|---|
| T1 | Assign a day shift to a rested, qualified officer under the threshold | Saved; all rules PASS |
| T2 | Night 12 h ends 07:00; assign a day shift starting 07:00 the same day (planted **PC-01**) | **BLOCK** U-01 and U-05; message names both shifts; nothing saved |
| T3 | **Boundary:** Night 8 h ends 07:00; Evening starts 15:00 (exactly 8 h) (planted **PC-02**) | U-01 PASS; U-02 WARN; saves after acknowledgement |
| T4 | A 16 h double, then any shift within the same 24 h | **BLOCK** U-05 (and U-03 if under 12 h rest) |
| T5 | Fifth consecutive 12 h night (planted **PC-04**) | WARN U-10; saves after acknowledgement |
| T6 | Overtime candidates for planted open shift **PC-08** | Order matches fewest-OT-then-seniority; an officer with insufficient rest is SKIPPED and keeps their place; unqualified officer UNAVAILABLE for Control (**PC-09**) |
| T7 | Rules admin lowers U-10 from 4 to 3 nights; build + dry run | Dry run lists the existing 4-night runs (**PC-06**) as new warnings; after approval and publish, the same check now warns; **no code change** |
| T8 | Payroll export for locked period 26 Oct – 8 Nov (planted **PC-05**) | CSV equals the golden file; per-officer totals equal actual hours; OT split 1.5× / 2× correct |
| T9 | **Human judgment:** lockdown; supervisor needs an officer for 17 h (planted **PC-03**) | BLOCK without override; with a reason (≥ 10 chars) it saves, creates an override record, appears in the audit log and the overrides report |
| T10 | Rules admin tries to approve their own draft | `403` from the API and rejected by the database check |
| T11 | Supervisor edits an actual in a locked pay period | `409`; database trigger also refuses |
| T12 | Employee requests another officer's hours | `404` (not revealed) |
| T13 | Validation: a rule row value below the legal floor (U-01 = 7) | Build fails validation with a plain message; can't be submitted |

## 5. End-to-end demo flows (Playwright)

| ID | Flow | Checks |
|---|---|---|
| E1 | Supervisor tries to assign Nia Thompson to Sat days → blocked → "Find eligible officer" → offers to two officers | Block banner and messages; ranked list order; offer recorded |
| E2 | Employee (Tara) accepts the offer; supervisor confirms | Offer status changes; assignment appears on both screens; overtime status updates |
| E3 | Rules admin changes U-03 from 12 to 14 h → build → submit; approver approves and publishes | Checklist states; dry-run numbers; live version increments; maker can't approve |
| E4 | Supervisor records actuals, locks the period, exports payroll | Lock prevents edits; CSV downloads and matches |
| E5 | Wall display | Shows counts only; no names anywhere in the DOM; refreshes |

These five flows are also the backbone of the ≤ 5-minute demo recording.

## 6. Demo dataset specification (`DemoDataGenerator`)

### 6.1 Fixed parameters

| Parameter | Value |
|---|---|
| Seed | `20261001` (`SC_DEMO_SEED`) |
| Window | 1 Oct – 29 Dec 2026 (90 days) |
| "Today" | 19 Nov 2026 (`SC_DEMO_TODAY`): days before today get actuals; today and later are planned only |
| Pay periods | Biweekly, Monday start: 28 Sep, 12 Oct, 26 Oct, 9 Nov, 23 Nov, 7 Dec, 21 Dec. Periods ending before today are **LOCKED**. |
| Rule set | v1 from `05-union-rules.md`, published 1 Oct; the generator then creates demo versions v2–v7 (history only) so the Rules screen shows a realistic version list |

### 6.2 Units and required staffing (by block, ADR-013)

| Unit | Day 07–15 | Evening 15–23 | Night 23–07 | Qualification rule |
|---|---|---|---|---|
| Unit A · Living unit | 5 | 5 | 4 | ≥ 1 FIRST_AID per block |
| Unit B · Living unit | 5 | 5 | 4 | ≥ 1 FIRST_AID per block |
| Unit C · Living unit | 5 | 4 | 4 | ≥ 1 FIRST_AID per block |
| Admissions | 3 | 3 | 2 | — |
| Control | 3 | 3 | 3 | all CONTROL |
| Escort & transport | 6 | 4 | 2 | all ESCORT |
| **Total** | **27** | **24** | **19** | |

All 12-hour patterns are allowed on Units A–C and Control (`allows_12h`); Admissions and Escort use 8-hour shifts only.

### 6.3 Why these numbers produce realistic overtime

- 60 officers on 12 h "2 days, 2 nights, 4 off" (4 crews of 15, each starting 2 days apart) → every day 15 officers work 07–19 and 15 work 19–07.
- 40 officers on 8 h "5 on, 2 off" rotations with staggered days off: 17 on days, 14 on evenings, 9 on nights → about 12 / 10 / 6–7 on duty per day.
- On-duty supply before absences: 07–15 ≈ 27, 15–19 ≈ 25, 19–23 ≈ 25, 23–07 ≈ 21.4, against required 27 / 24 / 24 / 19. That matches requirements **only when nobody is absent**, so the ~8% absences create real gaps that overtime must fill. That's the point of the dataset.
- **Coverage is measured hourly** (ADR-013 revised): a block is covered when every hour in it meets the required headcount. A 12 h day therefore covers the Day block and only the first 4 hours of Evening.

### 6.4 People

| Item | Rule |
|---|---|
| Names | First and last names drawn from fixed fictional lists (60 + 60) in the repo, combined uniquely by the seeded random generator. The named demo characters (Tara Nakamura, Nia Thompson, Ruth Okafor, Marc Desjardins, Kari Lindqvist, Sam Abara, Piotr Kowalczyk, Leah Morin, Devon Clarke, Aiden Bergeron) are created first with fixed IDs, matching the UI design. |
| Home units | Spread to fit requirements; Control and Escort staff hold those qualifications |
| Qualifications | CONTROL 25 officers; ESCORT 30; FIRST_AID 70 (overlaps allowed) |
| Seniority dates | Spread 2006–2025; include **two officers with equal OT hours and different seniority** (tie-break test) |
| Classification | All `CO`; FTE 1.00 |

### 6.5 Events

| Event | Rule |
|---|---|
| Sick days | ~4% of past and near-future shifts, random (seeded); recorded as type SICK only |
| Vacation | ~4% of shifts, as blocks of 3–7 consecutive days, booked in advance |
| Gap filling | For each hour below requirement, create an open shift; fill using the **real** ranking and rules: candidates in O-02 order, skip any with a Block, voluntary acceptance with probability 0.7 (seeded). Leave ~1–2% of gaps unfilled so reports show imperfection. |
| Actuals (past days) | Worked as scheduled, except: absences; ~3% of shifts extended by 0.5–2 h (overtime); a few early leaves. Time entries get pay codes from the pay-classification rules. |
| Overrides | Exactly the planted ones (PC-03) plus 3 more emergency overrides spread over the window, each with a reason |
| Audit | Every generated change writes an audit event with actor `system:generator` |

### 6.6 Planted cases (stable IDs, used by tests and the demo)

| ID | What | Where |
|---|---|---|
| PC-01 | Nia Thompson: N12 Fri 20 Nov 19:00–07:00; a pending supervisor proposal to assign her D8 Sat 21 Nov 07:00 (blocked) | Unit B |
| PC-02 | An officer with N8 ending Thu 26 Nov 07:00 and an E8 slot open at 15:00 (exactly 8 h) | Unit A |
| PC-03 | Wed 4 Nov: an officer worked 17 h (16 h double + 1 h extension) with override reason "Lockdown, relief unavailable" | Unit C |
| PC-04 | Piotr Kowalczyk: four consecutive N12 ending Mon 23 Nov, with a fifth available | Control |
| PC-05 | Pay period 26 Oct – 8 Nov, LOCKED, containing OT15, OT20, day-of-rest work and a 29-minute extension (unpaid) | All |
| PC-06 | At least three 4-night runs in the published roster (for the dry-run test T7) | Mixed |
| PC-07 | Two officers with identical OT hours this quarter, different seniority | Unit A |
| PC-08 | Open shift Sat 21 Nov Unit B Days with candidates matching the UI's Overtime board | Unit B |
| PC-09 | An officer without CONTROL qualification ranked first for a Control open shift | Control |

### 6.7 Self-check (generator fails the build if any is false)

1. No overlapping assignments for any officer.
2. Apart from planted cases PC-01 to PC-04 and the logged overrides, **no saved assignment breaks a Block rule** of the rule set in force on its date.
3. Coverage: ≥ 97.5% of hour-slots meet requirement across the window; at least 5 unfilled gaps exist.
4. Overtime: total 3–6% of worked hours; at least 10 officers with zero overtime and at least 5 above 25 h this quarter (skew).
5. For every locked pay period: sum of actual time entries = sum of payroll export lines per officer.
6. Every person row has `is_synthetic = true`; no name appears outside the fixed lists.
7. Re-running with the same seed produces identical row counts and a matching checksum of assignments.

## 7. Test data hygiene

- Unit tests build their own tiny fixtures with builders (`aShift().night12().endingAt("2026-11-21T07:00")…`), never the demo dataset.
- Integration tests use Testcontainers with migrations applied and **only** the fixtures each test needs. E2E tests use the full demo dataset after `docker compose down -v`.
- No real names, real staffing levels or non-public operational details, ever (synthetic data only, ADR-004).
