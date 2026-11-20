# ShiftCircle demo script (≤ 5 minutes)

**Status:** v0.4 · 2026-11-20 · follows `HANDOFF.md` §10.
- **VERIFIED** means the step was done on the **real api**, in two independent walks by dev-qa. The first was in the browser from a clean clone at `17308b7` (R30). The final one was at the api level from a true clone of the merged `main` `3a4bbbd`, and every step worked. The exact figures below come from that final walk. The Playwright specs drive most of the same steps in a browser.
- **The panel's wording differs slightly from the quotes here.** Read the words on the screen, not the script's.
- The time budgets add up to 275 s. The machine steps take seconds, so the 4:35 is narration time.
- **TODO-VERIFY** marks a step not yet done on the real api.

Rehearse every step anyway before recording.

**The safeguard story in one line:** PC-01 (Nia) is a Block with **no way around it**. PC-03 (the lockdown) is the **legitimate emergency override**: a different rule whose policy allows one, used with a written reason and audited.

**Setup before recording:** a clean `docker compose down -v` then `docker compose up -d --build --wait` (README § Setup) on the `demo` profile with seed `20261001` and "today" fixed at **Thu 19 Nov 2026**. A browser at `http://localhost:8080` (or `SC_WEB_PORT`) at 1440×900, zoom 100%. A second browser profile or private window keeps two users signed in, which saves sign-in time. Have a text editor ready to open the payroll CSV.

**Data used:** planted cases from `docs/10-testing.md` §6.6 and scenarios from §4: PC-01/T2, PC-08/T6, PC-03/T9, PC-05/T8. T3 and T7 are tests only and aren't shown on screen. If PC-02 is shown at all, show it only as a rule result (U-01 silent at exactly 8 h, U-02 WARN): its officer is also blocked by U-08 (10 consecutive days in the base roster), so don't try to assign them.

| Time | Segment |
|---|---|
| 0:00–0:30 | 1. Problem and users |
| 0:30–1:30 | 2. Planning board: blocked change (**the safeguard**) |
| 1:30–2:30 | 3. Overtime: fair ranking, offer, accept |
| 2:30–3:30 | 4. Rules admin: a rule change with no code change |
| 3:30–4:15 | 5. Time, payroll and reports |
| 4:15–4:35 | 6. What's real, what's simulated, next steps |

About 25 s of slack is left for transitions.

---

## 1. Problem and users (30 s)

| Do | Say (outline) | Status |
|---|---|---|
| Show `/login`: the "Mock sign-in · demo only" banner and the list of demo users | A 24/7 correctional centre runs 8, 12 and 16-hour shifts. Supervisors must respect rest and hours rules, offer overtime fairly and hand clean time to payroll. Everything here is fictional, synthetic data, and sign-in is simulated. | VERIFIED (every real-api spec signs in through this picker) |

## 2. Planning board: blocked change (60 s) · T2, PC-01

| Do | Say (outline) | Status |
|---|---|---|
| Sign in as **M. Ellis** (Supervisor, Units A and B). The planning board opens on the first unit in scope; choose **Unit B · Living unit** in the Unit selector. Week of **16 Nov**. | Coverage per block, measured hourly, with each officer's pay-period hours and overtime status. | VERIFIED (board and unit switch) |
| Point to the KPI tiles (on the demo data: **13** coverage gaps, **2** in overtime, **3** approaching, **0** rule warnings, **0** overrides this period) and one coverage cell that names its short hours | Overtime is pay-period hours over 80 h, not a shift type. | VERIFIED (dev-qa's walk) |
| On **Nia Thompson's** row, click her empty **Sat 21 Nov** cell ("Off"), then choose **D8 · Day 8 h** (07:00–15:00) | Nia works the 12 h shift Fri 12:00–24:00. | VERIFIED. The real api has no proposals in the schedule yet, so the fixtures' `! D proposed` chip doesn't appear; start from the empty cell |
| Read the rule-check panel: **Blocked: 3 rules fail**: **U-01** (7 h rest; the minimum is 8 h), **U-05** (17 h in 24 h; the limit is 16 h) and **U-14** (68 h in the week; the ceiling is 60 h) | The rules engine decides and gives a plain reason with its source. **Safeguard:** there's no Save and **no Emergency override**. The weekly ceiling allows no override, so there is no way around this one: find someone else. | VERIFIED: U-01 7.0 vs 8.0 h, U-05 17.0 h in 24 h, U-14 68.0 > 60 h, BLOCK, not overridable. No "Assign shift" and no "Emergency override…" button. Even an override with a valid reason gets 422, Nia's Sat 21 cell stays empty, and the refusal writes no audit row |

## 3. Overtime (60 s) · T6, PC-08, E1/E2

| Do | Say (outline) | Status |
|---|---|---|
| Click **Find eligible officer**. The Overtime board opens on the open shift **Sat 21 Nov · Unit B · Days 07:00–15:00** | | VERIFIED |
| Point to the fair-distribution box (O-02: fewest overtime hours this quarter, then seniority) and one **Skipped** row (read its rule code off the screen) | An officer without enough rest is skipped and keeps their place. They aren't penalised. | VERIFIED: 36 candidates, 20 of them skipped. **TODO-VERIFY: the ranking order.** It is pinned by the T6 test, not by the walk; check the order on screen at rehearsal |
| Tick **Tara Nakamura** (the officer behind the `T. Nakamura` login; the roster also has a **Tara Fontaine**, so check the surname) and a second eligible officer (dev-qa used E-003), then **Offer to selected (2)** | Offers are recorded in-app. Notifications are future work. | VERIFIED (PC-08 frees Tara Nakamura for this shift) |
| Switch to the window signed in as **T. Nakamura**. On **My schedule**, the offer card for Sat 21 Nov, Unit B, shows what the rules said. Click **Accept** | Employees see only their own hours. | VERIFIED (accept, and the employee-privacy check) |
| Back as M. Ellis: **Confirm** the accepted offer. On the planning board, Tara Nakamura's row shows `D · extra` on Sat 21 Nov | A supervisor authorises every extra shift (S-04, ADR-019). | VERIFIED: offer, accept and confirm; Tara Nakamura has a D8 EXTRA shift on Sat 21 Nov; the board shows the `D · extra` chip |

## 4. Rules admin (60 s) · E3 (T7 and T10 as tests)

| Do | Say (outline) | Status |
|---|---|---|
| Sign in as **L. Fraser** (Rules admin). Open **Rules → Rest between shifts**. Set **U-03** from **12 h** to **14 h** | A non-technical admin edits a decision table. The sentence below updates: "After a 16-hour shift, an officer must have at least 14 consecutive hours off…" | VERIFIED (E3 runs on the real api) |
| Click **Build**. The checklist fills in: values checked → compiled by Drools → test scenarios pass → dry-run impact on the published roster. Then **Submit for approval** | It can't go live if any scenario fails. | VERIFIED. Read the real dry-run count off the screen at rehearsal |
| Sign in as **P. Singh** (Rules approver). The review shows the before/after diff (~~12~~ **14**). Click **Approve**, then **Publish**. The live version goes from **v1 to v2** (on a fresh stack) | Maker/checker: the person who edits can't approve. The API and the database both refuse it. **No code change, no redeploy.** | VERIFIED: the build reported 6/6, L. Fraser approving their own draft gets 403, P. Singh approves and publishes, `/version` says v2 |

## 5. Time, payroll and reports (45 s) · T8, PC-05, T9, PC-03

| Do | Say (outline) | Status |
|---|---|---|
| As M. Ellis, open **Time & attendance** and choose pay period **26 Oct – 8 Nov** (Locked). Click **Payroll export (CSV)** and open the file | Overtime is classified per pay period. The CSV totals equal the recorded hours, and a golden-file test checks it. The payroll system itself is simulated: the CSV is the handoff. | VERIFIED: the export is 1,010 lines, sha256 `d502848d…d06a`, byte-identical to the golden file. The locked period is read-only, the CSV header follows docs/07 §4.5 and every row is in the period; "Unlock…" asks for a reason of ≥ 10 characters. Locking the **open** period also works at the demo clock (the real-clock bug is fixed). Optional, if time allows |
| Sign in as **A. Reviewer** (Auditor, facility-wide, read-only). Open **Reports → Coverage**, then **Overtime**. On the overrides list, point to **Tue 3 Nov (ended Wed 4 Nov 13:00), 17 h, "Lockdown, relief unavailable"** (PC-03) | **This is the legitimate override.** In a lockdown with no relief, a supervisor kept an officer on for 17 h. U-05 (16 h in 24 h) is a Block whose policy allows an emergency override, so the supervisor gave a written reason, and it is reported and audited. Compare Nia: no override existed. Human judgment stays with people, inside limits the rules set. | VERIFIED: the auditor's overrides list holds exactly this one row: the reason, rule **U-05**, the officer (Nell Holm), **Unit C · Living unit**, the actor (M. Ellis) and 4 Nov 13:05. Use the auditor: no demo supervisor has Unit C in scope, so a supervisor's report doesn't show it. (An earlier "fields empty" note was a verifier's own tool error, retracted on the raw data.) |

## 6. Close (20 s)

| Real (working code) | Simulated |
|---|---|
| Rules engine (Drools decision tables), rule checks with plain reasons, overrides with reasons, maker/checker publish, database constraints and append-only audit, period-based overtime and the payroll CSV, role- and unit-scoped access with signed tokens, the wall display (counts only) | Sign-in (the token issuer is mock; the API validates tokens as it would real ones), the payroll system (CSV only), all people and data (synthetic), collective-agreement values (MOCK, to validate), "today" fixed at 19 Nov 2026 |

**Say, in one line:** "The rules, safeguards, audit and payroll file are real working code; sign-in, the payroll system, the people and the agreement values are simulated."

Optional 10 s shot: sign in as **Unit office TV** for the wall display: counts only, no names, "updated hh:mm" (E5; VERIFIED: zero person names in the final walk; the stale state was re-verified live at the final web head).

**Then say:** "Next steps for a pilot: government single sign-on, validate the MOCK rules with practitioners, restore human review of the rule tests, and run on an approved platform."

Keep to that one sentence. The full list is in `BUILD_RECORD.md`.

---

**Fallbacks if a step fails while recording:** don't fake it. Cut the segment and say what isn't finished (CLAUDE.md: honest errors over graceful degradation).
