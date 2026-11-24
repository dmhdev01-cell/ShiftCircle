# ShiftCircle: roadmap and known limits

**Status:** 2026-11-24, written for the 26 Nov 2026 submission. This is what is **not** in the prototype, why, and the order we would build it. Efforts are rough dev-days for one developer.

## 1. Known limits (cut ii): documented, not built

| Area | Limit | Why not now |
|---|---|---|
| Rules | **U-03 and U-11 are dormant.** Their live rows key on the retired `L16` template, so a 12 h shift plus an extension never triggers the 12 h rest Block or the 16 h count. U-04 (Warn) and U-05 (Block) are the only guards | A fix is a new rule version (v4), which changes the demo's version numbers and the T4 scenario |
| Rules | **L-01 still lists `[8,12,16]`**, and its message says "8, 12 and 16-hour". There is no 16 h regular shift: 16 h = 12 h + a 4 h extension. U-10's message still says "overnight 00-12" | Same: a new rule version |
| Rules / pay | **P-01's 80 h per-period threshold makes 4-on/4-off 12 h crews built-in overtime** (84 to 96 h a period). The 4,808 OT hours on Dataset 120 and 2,964 on 150 are partly that modelling artefact. **U-13 cycle averaging is not built** | Changes OT figures, the payroll classification and the payroll golden file |
| Pay | Only OT 1.5× is classified. OT 2×, stat holiday, day of rest and call-back pay are not (FR-52) | Payroll golden |
| Planner | **Qualifications are not used for placement**; the scorecard only reports them (FR-03) | Changes plan fingerprints |
| Planner | **No part-time floor or fair share.** Casuals fill leftovers, in their home unit, newest-first, capped at FTE × 80 h a period. On Dataset 120, 13 of 20 part-timers get no shifts | Changes plan fingerprints |
| Planner | **Seniority** orders nights and overtime, but the casual pool is newest-first and not configurable; extra shifts and vacation picks are not offered by seniority | Same, plus rule design |
| Leave | **Leave is skipped by the generator but not shown on the board.** It is entered through the API only; there is no request, approval, balance or leave limit (maximum off per unit per day) | API and data risk on Dataset 100 |
| Sick | Sick is recorded after the fact. There is no call-out flow (sick call → open shift → ranked offer); posting an open shift is "not available in this prototype" | New flow |
| Planner | The quarter window (4 Jan to 11 Apr 2027) and the clock are fixed; a plan can be committed once; the 28 Dec to 3 Jan seam on Dataset 100 is thin | Window is in seeded data |
| Workflow | Employee proposals and the supervisor inbox, FR-06 publish gating, FR-07 "changed" flags, offer withdrawal/expiry, mandatory OT and OT caps | New flows |
| Platform | No OpenAPI or generated client; e2e is not in CI; no Java CVE scan; floating base-image tags; the auth seam is a demo mock; no phone layout | Engineering, not demo-facing |
| Architecture | `PlannerService` and `PlannerPage` are very large; `shiftcircle-domain` and `-application` are empty placeholders (`docs/03-architecture.md` §2) | Refactors risk the demo |

### Staffing findings (measured, synthetic data, seed 20261001)

- **Demand** is 70 post-blocks a day, 3,920 staff-hours a week: about 98 FTE with no leave, about **123 FTE at a 20% relief factor**.
- **Dataset 150 has enough people** (138 FTE; 113% of the requirement after leave). Its 100 plan gaps (5.7% of block-days) are not a headcount problem: part-timers worked 6,564 of their 10,080 target hours, so about 3,516 h of part-time capacity went unused, roughly 3.5× the gap hours. The causes are planner policy: a home-unit-only, newest-first, capped casual pool, leave placed with no per-unit limit, and an evening shoulder the pool doesn't target.
- **Dataset 120** works only because it has no leave; with 20% leave it would be short. **Dataset 100** is deliberately tight (82% of the requirement after leave, no 12 h night crews): it demonstrates the safeguards, not good planning.
- **Unit C has only 4 first-aid officers for four 12 h crews.** A "one first-aider every block" rule needs at least 2 per crew (8 per living unit). A has 7, B has 8, C has 4, which gives 103 failing block-days on Dataset 150 (43 in Unit C). The fix is **+4 first-aiders in C and +1 in A**, plus a planner change (qualified-first placement), not more people overall.

## 2. Owner planner requirements (23 Nov): status and where they land

| Requirement | Today | Roadmap package |
|---|---|---|
| Positions and qualified-first placement | Posts are unit × block counts; qualifications are reported, not used | 4 |
| Seniority-ordered offering (extra shifts, part-time hours, vacation picks) | Nights and OT only; casual pool newest-first | 3 |
| Leave visible and managed with approval | Skipped by the generator; API-only entry; not shown | 2 |
| Sick call-out | After-the-fact actuals only | 5 |
| Part-time fair share and floor | Leftovers only, no floor | 3 |
| Rolling planner window | Fixed quarter, single use | 6 |
| Shift patterns 8 h vs 12 h, preferences | Built | n/a |

## 3. Roadmap (cut iii): ordered, after the submission

| Order | Package | Contents | Effort |
|---|---|---|---|
| 1 | **Rules correctness** | Re-key U-03/U-11 on "12 h + extension ≥ 4 h"; L-01 → `[8,12]` + extension; U-10 message; U-13 cycle averaging so 4/4 crews aren't in built-in OT; update the T4 scenario, boundary tests and demo §4 version numbers | M, about 2 d |
| 2 | **Leave you can see and manage** | Absences on the board and draft; leave limits per unit, block and day; employee request → supervisor approval; simple balances | 4 to 6 d |
| 3 | **Part-time fair share and seniority** | Pool ordered by hours below target (round-robin) or seniority (configurable); cross-unit casual relief with a qualification check; optional per-FTE floor on the scorecard; seniority-ordered offering of extra shifts and vacation picks | about 2 d |
| 4 | **Qualified-first placement** | Tie-break for qualified candidates when a block is below its qualified minimum; a QUALIFIED_MIN Warn rule on the board | about 2 d |
| 5 | **Sick call-out** | "Call in sick" on a future shift → absence + open shift → ranked offer | 3 d |
| 6 | **Rolling planner window and Clock** | Next quarter after today, plan again after a commit, timezone from config, injected `Clock` | 2 to 3 d |
| 7 | **Spreadsheet parity II** | Bulk edits through a batch rule check, undo, keyboard entry, quarter overview / xlsx | 5 to 8 d |
| 8 | **Workflow completeness** | Proposals + inbox, FR-06 gating + FR-07, offer withdraw/expiry, mandatory OT, OT caps, notice rules (S-01, S-02, P-05) | 5 to 7 d |
| 9 | **Pay completeness** | OT 2× band, stat holiday, day of rest, call-back; payroll golden update | 2 to 3 d |
| 10 | **Engineering hardening** | e2e in CI, image digests, Java CVE gate, OpenAPI → generated `types.ts`, split the large classes, extract or delete the empty modules, test isolation, OIDC-ready auth | 8 to 10 d |

Packages 1 to 6 are the first post-submission block: about **15 to 19 dev-days** if taken in this order. The rules values themselves are mock and still need a practitioner's review against the local letters of understanding (`docs/05-union-rules.md` §6).
