# ShiftCircle demo script (≤ 5 minutes)

**Status:** draft v0.2 · 2026-11-20 · follows `HANDOFF.md` §10.
- **VERIFIED** means a Playwright spec drove exactly that step against the **real api**, on desktop and tablet: branch `integration` at `2ba502d`, by dev-build2 (`docs/ai-dev-log.md` #53 on that branch).
- **TODO-VERIFY** marks a step no test has driven against the real api yet.

Rehearse every step anyway before recording.

**The safeguard story in one line:** PC-01 (Nia) is a Block with **no way around it**. PC-03 (the lockdown) is the **legitimate emergency override**: a different rule whose policy allows one, used with a written reason and audited.

**Setup before recording:** a clean `docker compose up --build` on the `demo` profile with seed `20261001` and "today" fixed at **Thu 19 Nov 2026**. A browser at `http://localhost:8080` (or `SC_WEB_PORT`) at 1440×900, zoom 100%. A second browser profile or private window keeps two users signed in, which saves sign-in time. Have a text editor ready to open the payroll CSV.

**Data used:** planted cases from `docs/10-testing.md` §6.6 and scenarios from §4: PC-01/T2, PC-08/T6, PC-03/T9, PC-05/T8. T3 and T7 are tests only and aren't shown on screen.

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
| Point to the KPI tiles (coverage gaps, in overtime) and one coverage cell that names its short hours | Overtime is pay-period hours over 80 h, not a shift type. | TODO-VERIFY (no spec asserts the tiles or the ADR-017 cell text on the real api) |
| On **Nia Thompson's** row, click her empty **Sat 21 Nov** cell ("Off"), then choose **D8 · Day 8 h** (07:00–15:00) | She works the 12 h shift Fri 12:00–24:00. | VERIFIED. The real api has no proposals in the schedule yet, so the fixtures' `! D proposed` chip doesn't appear; start from the empty cell |
| Read the rule-check panel: **Blocked: 3 rules fail**: **U-01** (7 h rest; the minimum is 8 h in 24 h), **U-05** (17 h in 24 h) and **U-14** (the week passes the 60 h ceiling) | The rules engine decides and gives a plain reason with its source. **Safeguard:** there's no Save and **no Emergency override**. The weekly ceiling allows no override, so there is no way around this one: find someone else. | VERIFIED: the Block count, U-01's reason, no "Assign shift" and no "Emergency override…" button. TODO-VERIFY: read the U-05 and U-14 wording aloud at rehearsal (the spec doesn't assert it) |

## 3. Overtime (60 s) · T6, PC-08, E1/E2

| Do | Say (outline) | Status |
|---|---|---|
| Click **Find eligible officer**. The Overtime board opens on the open shift **Sat 21 Nov · Unit B · Days 07:00–15:00** | | VERIFIED |
| Point to the fair-distribution box (O-02: fewest overtime hours this quarter, then seniority) and one **Skipped · U-01** row | An officer without enough rest is skipped and keeps their place. They aren't penalised. | TODO-VERIFY (no spec asserts the order or a Skipped row on the real api; names come from the generator) |
| Tick **Tara Nakamura**, then **Offer to selected (1)** | Offers are recorded in-app. Notifications are future work. | VERIFIED (the planted data now frees Tara for this shift, PC-08). Offering to a second officer is untested on the real api |
| Switch to the window signed in as **T. Nakamura**. On **My schedule**, the offer card for Sat 21 Nov, Unit B, shows what the rules said. Click **Accept** | Employees see only their own hours. | VERIFIED (accept, and the employee-privacy check) |
| Back as M. Ellis: **Confirm** the accepted offer | A supervisor authorises every extra shift (S-04, ADR-019). | VERIFIED. TODO-VERIFY: the `D · extra` chip on the board afterwards (not asserted) |

## 4. Rules admin (60 s) · E3 (T7 and T10 as tests)

| Do | Say (outline) | Status |
|---|---|---|
| Sign in as **L. Fraser** (Rules admin). Open **Rules → Rest between shifts**. Set **U-03** from **12 h** to **14 h** | A non-technical admin edits a decision table. The sentence below updates: "After a 16-hour shift, an officer must have at least 14 consecutive hours off…" | TODO-VERIFY (E3 is pending against the real api until step 11 is merged into `integration`; passes in fixtures) |
| Click **Build**. The checklist fills in: values checked → compiled by Drools → test scenarios pass → dry-run impact on the published roster. Then **Submit for approval** | It can't go live if any scenario fails. | TODO-VERIFY (show the real dry-run count) |
| Sign in as **P. Singh** (Rules approver). The review shows the before/after diff (~~12~~ **14**). Click **Approve**, then **Publish**. The live version goes up by one | Maker/checker: the person who edits can't approve. The API and the database both refuse it. **No code change, no redeploy.** | TODO-VERIFY |

## 5. Time, payroll and reports (45 s) · T8, PC-05, T9, PC-03

| Do | Say (outline) | Status |
|---|---|---|
| As M. Ellis, open **Time & attendance** and choose pay period **26 Oct – 8 Nov** (Locked). Click **Payroll export (CSV)** and open the file | Overtime is classified per pay period. The CSV totals equal the recorded hours, and a golden-file test checks it. The payroll system itself is simulated: the CSV is the handoff. | VERIFIED: the locked period is read-only, the CSV header follows docs/07 §4.5 and every row is in the period; "Unlock…" asks for a reason of ≥ 10 characters. TODO-VERIFY: the first click path, where the open period refuses to lock while actuals are missing (that spec is fixtures-only) |
| Open **Reports → Coverage**, then **Overtime**. On the overrides list, point to **Tue 3 Nov (ended Wed 4 Nov 13:00), 17 h, "Lockdown, relief unavailable"** (PC-03) | **This is the legitimate override.** In a lockdown with no relief, a supervisor kept an officer on for 17 h. U-05 (16 h in 24 h) is a Block whose policy allows an emergency override, so the supervisor gave a written reason, and it is reported and audited. Compare Nia: no override existed. Human judgment stays with people, inside limits the rules set. | TODO-VERIFY (Reports is step 10; no e2e spec covers the overrides list yet) |

## 6. Close (20 s)

| Working | Simulated |
|---|---|
| Rules engine (Drools decision tables), rule checks with plain reasons, overrides with reasons, maker/checker publish, database constraints and append-only audit, period-based overtime and the payroll CSV, role- and unit-scoped access with signed tokens | Sign-in (the token issuer is mock; the API validates tokens as it would real ones), the payroll system (CSV only), all people and data (synthetic), collective-agreement values (MOCK, to validate), "today" fixed at 19 Nov 2026 |

**Say:** "Next steps for a pilot: government single sign-on, validate the MOCK rules with practitioners, restore human review of the rule tests, and run on an approved platform."

Keep to that one sentence. The full list is in `BUILD_RECORD.md`.

---

**Not in the recording:** E5, the wall display, is TODO-VERIFY. Its api is on `main` (`6649eb1`) but the screen isn't built yet. If it's ready in time, add a 10 s shot to segment 6 showing counts only, no names.

**Fallbacks if a step fails while recording:** don't fake it. Cut the segment and say what isn't finished (CLAUDE.md: honest errors over graceful degradation).
