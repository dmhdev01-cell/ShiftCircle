# ShiftCircle demo script (≤ 5 minutes)

**Status:** v0.5 · 2026-11-23 · follows `docs/process/HANDOFF.md` §10.

**The recorded submission video is §1–6 only: 4 min 35 s, within the 5-minute limit.** §7 (the planner) is an **optional, separate walkthrough that is not part of the 5-minute video**; do not record it into the submission video.

- **Wording and data re-checked 2026-11-23** against the current web code, the e2e specs (E1–E4) and the demo data on `main` (`efba3f7`): the Rules button reads **Build and check**; a first edit starts with **Start a draft** and a reason; the live rule set on a fresh stack is **v3**, so a publish makes it **v4**. No step in §1–6 uses **Propose shifts** or needs a draft quarter plan: everything starts from the default seeded data, so changes to the officer's Propose shifts screen and to how open shifts are shown don't alter the walk. Rehearse once after those changes merge.
- **VERIFIED** means the step was done on the **real api**, in two independent walks by dev-qa. The first was in the browser from a clean clone at `17308b7` (R30). The final one was at the api level from a true clone of the merged `main` `3a4bbbd`, and every step worked. The exact figures below come from that final walk. The Playwright specs drive most of the same steps in a browser.
- **The panel's wording differs slightly from the quotes here.** Read the words on the screen, not the script's.
- The time budgets add up to 275 s, almost all of it narration. dev-qa timed the read calls on a warm stack at `3a4bbbd` (Docker Desktop, macOS, two runs each): sign-in 32 / 4 ms, rule-check preview 43 / 7 ms, planning board week 27 / 12 ms, open shifts 9 / 6 ms, the auditor's overrides 13 / 7 ms, 90-day coverage 20 / 15 ms, wall display 15 / 7 ms. The write steps (offer, accept, confirm, build, publish, export) weren't timed. In the walk each one completed interactively.
- The optional planner walkthrough (§7, not in the video) is newer: dev-design walked it on candidate 1 `99703a9`, re-walked it on candidate 2 `c2c8dba`, and re-checked steps 3 and 6 on candidate 3 `5d0f810` (its own note is in the mission folder, `P3-FINAL-VISUAL.md`).

Rehearse every step anyway before recording.

**The safeguard story in one line:** PC-01 (Nia) is a Block with **no way around it**. PC-03 (the lockdown) is the **legitimate emergency override**: a different rule whose policy allows one, used with a written reason and audited.

**Pre-recording checklist** (about 5 minutes, do it before you press record):

- [ ] **Fresh data.** Either a fresh stack (`docker compose down -v` on your own project, then `docker compose up -d --build --wait`, README § Setup) or, signed in as **P. Planner**, **About & version → Reset the demo data** with the default 100 dataset, `RESET`. The demo profile, seed `20261001`, "today" fixed at **Thu 19 Nov 2026**. A used stack has an old rule version and old offers, and the steps below won't match.
- [ ] **Browser.** `http://localhost:8080` (or `SC_WEB_PORT`), window 1440×900, zoom 100%, notifications off, bookmarks bar hidden.
- [ ] **Two profiles.** A second browser profile or private window, so **M. Ellis** and **T. Nakamura** are both signed in (§3). The other roles sign in and out in the main window.
- [ ] **CSV viewer.** A text editor or spreadsheet ready to open the downloaded payroll CSV (§5).
- [ ] **Rehearse** §1–6 once, reading the words on the screen, and time it.

**Data used:** planted cases from `docs/10-testing.md` §6.6 and scenarios from §4: PC-01/T2, PC-08/T6, PC-03/T9, PC-05/T8. T3 and T7 are tests only and aren't shown on screen. If PC-02 is shown at all, show it only as a rule result (U-01 silent at exactly 8 h, U-02 WARN): its officer is also blocked by U-08 (10 consecutive days in the base roster), so don't try to assign them.

| Time | Segment |
|---|---|
| 0:00–0:30 | 1. Problem and users |
| 0:30–1:30 | 2. Planning board: blocked change (**the safeguard**) |
| 1:30–2:30 | 3. Overtime: fair ranking, offer, accept |
| 2:30–3:30 | 4. Rules admin: a rule change with no code change |
| 3:30–4:15 | 5. Time, payroll and reports |
| 4:15–4:35 | 6. What's real, what's simulated, next steps |
| **4:35 total** | **The submission video ends here.** About 25 s of slack to the 5:00 limit is left for transitions. |
| (not in the video) | 7. Planner walkthrough, about 4 min, recorded separately if at all |

---

## 1. Problem and users (30 s)

| Do | Say (outline) | Status |
|---|---|---|
| Show `/login`: the "Mock sign-in · demo only" banner and the list of demo users | A 24/7 correctional centre runs 8- and 12-hour shifts; a 16 h day is a 12 h shift plus an extension. Supervisors must respect rest and hours rules, offer overtime fairly and hand clean time to payroll. Everything here is fictional, synthetic data, and sign-in is simulated. | VERIFIED (every real-api spec signs in through this picker) |

## 2. Planning board: blocked change (60 s) · T2, PC-01

| Do | Say (outline) | Status |
|---|---|---|
| Sign in as **M. Ellis** (Supervisor, Units A and B). The planning board opens on the first unit in scope; choose **Unit B · Living unit** in the Unit selector. Week of **16 Nov**. | Coverage per block, measured hourly, with each officer's pay-period hours and overtime status. | VERIFIED (board and unit switch) |
| Point to the KPI tiles (on the demo data: **13** coverage gaps, **2** in overtime, **3** approaching, **0** rule warnings, **0** overrides this period) and one coverage cell that names its short hours | Overtime is pay-period hours over 80 h, not a shift type. | VERIFIED (dev-qa's walk) |
| On **Nia Thompson's** row, click her empty **Sat 21 Nov** cell ("Off"), then choose **D8 · Day 8 h** (07:00–15:00) | Nia works the 12 h shift Fri 12:00–24:00. | VERIFIED. The real api has no proposals in the schedule yet, so the fixtures' `! D proposed` chip doesn't appear; start from the empty cell |
| Read the rule-check panel: **Blocked: 4 rules fail**: **U-01** (7 h rest; the minimum is 8 h), **U-05** (17 h in 24 h; the limit is 16 h), **U-08** (the proposal makes 8 consecutive work days) and **U-14** (64 h in the week; the ceiling is 60 h) | The rules engine decides and gives a plain reason with its source. **Safeguard:** there's no Save and **no Emergency override**. The weekly ceiling allows no override, so there is no way around this one: find someone else. | VERIFIED: U-01 7.0 vs 8.0 h, U-05 17.0 h in 24 h, U-08 8 > 7 consecutive days, U-14 64.0 > 60 h, BLOCK, not overridable; the real api shows 4 rules, the fixtures 3. No "Assign shift" and no "Emergency override…" button. Even an override with a valid reason gets 422, Nia's Sat 21 cell stays empty, and the refusal writes no audit row |

## 3. Overtime (60 s) · T6, PC-08, E1/E2

| Do | Say (outline) | Status |
|---|---|---|
| Click **Find eligible officer**. The Overtime board opens on the open shift **Sat 21 Nov · Unit B · Days 07:00–15:00** | | VERIFIED |
| Point to the fair-distribution box (O-02: fewest overtime hours this quarter, then seniority) and one **Skipped** row (read its rule code off the screen) | An officer without enough rest is skipped and keeps their place. They aren't penalised. | VERIFIED: 36 candidates, 20 of them skipped. The ranking order is pinned by the T6 test, not re-read on screen in this walk; check it at rehearsal |
| Tick **Tara Nakamura** (the officer behind the `T. Nakamura` login; the roster also has a **Tara Fontaine**, so check the surname) and a second eligible officer (dev-qa used E-003), then **Offer to selected (2)** | Offers are recorded in-app. Notifications are future work. | VERIFIED (PC-08 frees Tara Nakamura for this shift) |
| Switch to the window signed in as **T. Nakamura**. On **My schedule**, the offer card for Sat 21 Nov, Unit B, shows what the rules said. Click **Accept** | Employees see only their own hours. | VERIFIED (accept, and the employee-privacy check) |
| Back as M. Ellis: **Confirm** the accepted offer. On the planning board, Tara Nakamura's row shows `D · extra` on Sat 21 Nov | A supervisor authorises every extra shift (S-04, ADR-019). | VERIFIED: offer, accept and confirm; Tara Nakamura has a D8 EXTRA shift on Sat 21 Nov; the board shows the `D · extra` chip |

## 4. Rules admin (60 s) · E3 (T7 and T10 as tests)

| Do | Say (outline) | Status |
|---|---|---|
| Sign in as **L. Fraser** (Rules admin). Open **Rules → Rest between shifts**. Set **U-03** (the **Minimum hours off for U-03** field) from **12 h** to **14 h** | A non-technical admin edits a decision table. The sentence below updates: "After a 16 h shift, an officer needs at least 14 hours off…" | VERIFIED (E3 runs on the real api) |
| If there is no draft yet, enter a reason and click **Start a draft**. Click **Build and check**. The checklist fills in: values checked → compiled by Drools → test scenarios pass → dry-run impact on the published roster. Then **Submit for approval** | It can't go live if any scenario fails. | VERIFIED. Read the real dry-run count off the screen at rehearsal |
| Sign in as **P. Singh** (Rules approver). The review shows the before/after diff (~~12~~ **14**). Click **Approve**, then **Publish**. The live version goes from **v3 to v4** (on a fresh stack) | Maker/checker: the person who edits can't approve. The API and the database both refuse it. **No code change, no redeploy.** | VERIFIED: the build reported 6/6, L. Fraser approving their own draft gets 403, P. Singh approves and publishes, `/version` reported the new live version (v1 to v2 at that time; v3 to v4 now, since the 8 h night-warning rule set was added) |

## 5. Time, payroll and reports (45 s) · T8, PC-05, T9, PC-03

| Do | Say (outline) | Status |
|---|---|---|
| As M. Ellis, open **Time & attendance** and choose pay period **26 Oct – 8 Nov** (Locked). Click **Payroll export (CSV)** and open the file | Overtime is classified per pay period. The CSV totals equal the recorded hours, and a golden-file test checks it. The payroll system itself is simulated: the CSV is the handoff. | VERIFIED: the export is 1,038 lines, sha256 `9f2d51b3…04ff`, byte-identical to the golden file. The locked period is read-only, the CSV header follows docs/07 §4.5 and every row is in the period; "Unlock…" asks for a reason of ≥ 10 characters. Locking the **open** period also works at the demo clock (the real-clock bug is fixed). Optional, if time allows |
| Sign in as **A. Reviewer** (Auditor, facility-wide, read-only). Open **Reports → Coverage**, then **Overtime**. On the overrides list, point to **Tue 3 Nov (ended Wed 4 Nov 05:00), 17 h, "Lockdown, relief unavailable"** (PC-03) | **This is the legitimate override.** In a lockdown with no relief, a supervisor kept an officer on for 17 h. U-05 (16 h in 24 h) is a Block whose policy allows an emergency override, so the supervisor gave a written reason, and it is reported and audited. Compare Nia: no override existed. Human judgment stays with people, inside limits the rules set. | VERIFIED: the auditor's overrides list holds exactly this one row: the reason, rule **U-05**, the officer (Pia Nguyen, E-047), **Unit C · Living unit**, the actor (M. Ellis) and 4 Nov 05:05. Use the auditor: no demo supervisor has Unit C in scope, so a supervisor's report doesn't show it. (An earlier "fields empty" note was a verifier's own tool error, retracted on the raw data.) |

## 6. Close (20 s)

| Real (working code) | Simulated |
|---|---|
| Rules engine (Drools decision tables), rule checks with plain reasons, overrides with reasons, maker/checker publish, database constraints and append-only audit, period-based overtime and the payroll CSV, role- and unit-scoped access with signed tokens, the wall display (counts only) | Sign-in (the token issuer is mock; the API validates tokens as it would real ones), the payroll system (CSV only), all people and data (synthetic), collective-agreement values (MOCK, to validate), "today" fixed at 19 Nov 2026 |

**Say, in one line:** "The rules, safeguards, audit and payroll file are real working code; sign-in, the payroll system, the people and the agreement values are simulated."

Optional 10 s shot: sign in as **Unit office TV** for the wall display: counts only, no names, "updated hh:mm" (E5; VERIFIED: zero person names in the final walk; the stale state was re-verified live at the final web head).

**Then say:** "Next steps for a pilot: government single sign-on, validate the MOCK rules with practitioners, restore human review of the rule tests, and run on an approved platform."

Keep to that one sentence. The full list is in `BUILD_RECORD.md`.

---

## 7. OPTIONAL, NOT PART OF THE 5-MINUTE VIDEO. Planner: next quarter in seconds, checked by the same rules (about 4 min) · Phase 3

> **Not in the submission video.** The recorded video is §1–6 (4:35). This section is a separate walkthrough, for a live demo or a second recording. It needs Dataset 120 and it commits a quarter plan, so run it on its own reset stack, never before or between §1–6 on the same data.

**Status:** v0.4 · 2026-11-21 · dev-design. **Re-walked on candidate 2, p3-cand2 `c2c8dba`** (a clean worktree; my own stack, web 18085; dataset 120; Chromium at 1440×900), after v0.2 on `99703a9`. **Steps 3 and 6 re-checked on candidate 3, p3-cand3 `5d0f810`** (own stack, dataset 120; shots in `/private/tmp/sc-ui-shots/p3-cand3/visual/`). The walk was driven by `e2e/tests/p3-final-walk.spec.ts`, slowed to about human speed (350 ms per action), with a screenshot of every step in `/private/tmp/sc-ui-shots/p3-cand2/walk/`. It is a scripted browser walk, not a person at the keyboard, so rehearse it by hand before recording. Figures below are the ones measured on that walk (two runs).

It runs after the 5-minute script as its own walkthrough, or replaces segments 3–5 in a live session when the planner is the subject. It is not recorded into the submission video.

**What the audience should take away:** a planner builds the whole next quarter in seconds. Every shift in it went through the same rules engine as the planning board. Where the rules and the staffing don't allow a shift, the plan leaves an honest gap rather than bending a rule. Supervisors then fill those gaps with the normal live rule check.

**Data:** dataset **120**. That is 100 full-time crew officers plus 20 part-time casuals as a relief pool. Dataset **150** (120 full-time + 30 part-time with 20% leave) is selectable for the staffing story; the steps below use 120. Only 12 h crews work nights: D12 is 07:00–19:00 and N12 is 19:00–07:00, 4 on / 4 off. 8 h officers work D8 or E8 only. The window is Mon 4 Jan – Sun 11 Apr 2027, seven 14-day pay periods. "Today" stays Thu 19 Nov 2026. Every 8 h officer starts on **Rotating 5 on, 2 off (weekends rotate)** (ADR-026, chosen by the person); the pattern is per officer and changed on **Preferences**.

| # | Do | The audience should see / Say (outline) | Status (p3-cand2 `c2c8dba`) |
|---|---|---|---|
| 1 | **Reset to a known state.** Sign in as **P. Planner**. Open **About & version**. On **Reset the demo data**, choose Dataset **"120: 100 full-time crews + 20 casual relief officers"**, type `RESET`, click **Reset demo data**. | "Done. The demo data was rebuilt in 1 s. Dataset checksum 82b19cf8…ea66732ca." Say: "Synthetic data, rebuilt from scratch, same every time." | **VERIFIED.** The same checksum on two resets (it changed from `99703a9` because the officers now have real names). The card now says "It takes a few seconds" and the progress line names the dataset. |
| 2 | **Generate.** Open **Quarter plan** ("No plan for this quarter yet."). Leave the seed at **20261001** - every officer now keeps their own pattern (rotating 5 on/2 off by default; 12-hour officers their crew's 4 on/4 off). Click **Generate draft**. | The scorecard in under a second: "Draft generated: 38 block-days short, 7 warnings, took 0.6 s." Say: "Same seed, same plan. It is a fixed method, not a guess, and every shift was checked by the rules engine before it went in." | **VERIFIED** (0.6–0.8 s on four runs) |
| 3 | **Scorecard.** Walk the tiles, open **What this means** on **Coverage gaps**, then point to **Hours against target by FTE band** and **Night shifts by seniority**. | **Coverage gaps 38** of 1,764 block-days, with the plain explanation. **Rule warnings 7**, no blocked shifts. **Qualified staff: All met** (0 of 1,470 requirement block-days below the qualified minimum; on the 100 seed it would read 346). **Preferences met 92 %** (196 of 214 wishes: shift length 104 of 107, time of day 92 of 107; no day-off wishes in this dataset; the 13 casuals with no shifts are *not rostered* and are not counted). **Night fairness Held**: the newest third works 96.8 % of night shifts; N12 night crew 42 officers. **Overtime built in 4,808 h** (97 officers over 80 h in a pay period: the 4-on/4-off structure). FTE bands: full-time 100 officers, avg 586 h of a 560 h target; casuals 0–336 h ("not guaranteed hours; they fill what is left"). Weekends worked 0–22 (average 12.2). | **VERIFIED on `5d0f810`; re-checked for release 4 #14 on `p5`.** Preferences met 92 % (196 of 214), the same number as Compare; the shift-less casuals are excluded from both. The undercount for the 12-hour crews (D12/N12 read as 8-hour days) is fixed. Minor, still open: "hire years not shown" in the night bands. |
| 4 | **Gaps tab.** Click **Gaps (38)**. Point to the Unit and Block filters, then **Show week** on the first gap. | "38 block-days are short. The planner left them open rather than break a blocking rule." **All 38 are Escort & transport evenings (19:00–23:00)**, each with Staffed / needed (for example 3 / 4) and the reason. Show week opens the Roster on that week. Say: "This is the supervisors' work list. We show it; we don't hide it." | **VERIFIED.** Minor: the reason reads in rule jargon ("No eligible officer left without a Block rule; a supervisor fills this"). |
| 5 | **Compare.** Click **Compare**. | "Nothing is on the planning board for 4 Jan – 11 Apr 2027 yet." Board vs draft: gaps 1,764 → 38, shifts 0 → 5,103, officers 0 → 107, warnings 0 → 7, with better/worse. | **VERIFIED** (10 measure rows, unit names). Preferences met reads 196 (214 asked), the same as the scorecard. |
| 6 | **Commit.** Back on **Scorecard**, click **Commit plan…**. Read the dialog, tick "I've read these 7 warnings and accept them for this plan.", then click **Commit plan**. | "This writes 5,103 shifts for 107 officers… If any shift is blocked, nothing is written. 38 block-days stay short." Then the full list of 7 warnings by kind, with unit names. Commit plan stays disabled until the box is ticked. Afterwards: "Plan committed", 5,103 shifts written, a link per unit, and the tabs stay readable. Say: "One decision, recorded once, with the warning list. No override is implied." | **VERIFIED.** The status line reads the commit time in Regina time ("Committed 21 Nov, 02:20" for a commit at 08:20Z). The unit links are in order and the date reads "4 Jan 2027". The commit dialog groups the U-14 warnings as "Week over 48 hours · 3". |
| 7 | **A supervisor fixes a gap.** Sign out; sign in as **J. Chen** (supervisor for Admissions, Control and Escort; **not M. Ellis**, who covers only Units A and B, and every gap is in Escort). On the **Planning board**, choose **Escort & transport** and click **Next week** to **11 – 17 Jan 2027**. The Evenings row shows "3 / 4 short 19–23" on Wed 13. **(a) Fix:** on an officer who is Off on Wed 13, click the cell, choose **E8**, read the rule check (a warning only), then **Acknowledge and assign**. **(b) Refused:** on a day-crew officer with D12 Mon–Thu, click **Fri 15** and choose **D12**. | (a) Wed 13 evenings turns **4 / 4**, and the Coverage gaps tile drops. (b) **"Blocked: 1 rule fails"**: **U-09** "More than 4 consecutive 12-hour shifts", evidence "5 consecutive 12-hour shifts", plus a U-14 warning. Only **Find eligible officer** and **Close**: **no Assign, no Emergency override**. Say: "Same rules on the board as in the planner. A supervisor can fill a gap, but can't break a hard limit." | **VERIFIED** (filled with Vera Walsh, refused Yusuf Zimmer; pick by eye at rehearsal). The board shows planned pay-period hours in 2027 (72, 84 and 96 h with status pills), so **review M3 is fixed**. Minor: Off cells are dashed boxes. |
| 8 | **Audit.** Sign in as **A. Reviewer** (facility-wide), open **Audit log**. | Newest first: "Shift assigned" (J. Chen, E8 · unit ESC · WARN), "Quarter plan committed" ("5,103 shifts written · 107 officers · 7 warnings accepted · across 6 units"), "Quarter plan generated" (Gaps 38 · Seed 20261001 · Warnings 7), "Demo data reset" (Seed 20261001 · Dataset 120). Say: "Everything that changed the roster is in one append-only log." | **VERIFIED.** The summaries now read in words. Still open: the commit line has the warning count, not the list (F8, not re-checked in this pass), and the shift line says "unit ESC". |

| 9 | **Close a unit.** Sign in as **P. Planner**, open **Units**, find **Unit C**, click **Close from a date…**: Closed from **15 Feb 2027**, Reopens on empty, Reason **`Renovation (demo)`**. Read the effect text, then **Close Unit C**. | The effect says Unit C needs no staff, gets no roster and shows no gaps from that date; its officers stay employed and work as relief; published shifts are not deleted. The row now reads **Closed from 15 Feb 2027 · no reopening date set**. | **VERIFIED** (api and web; screenshots by dev-build2) |
| 10 | **Plan without it.** **Quarter plan → Generate draft**. Then open **Roster**: the picker says `Unit C · Living unit (closed from 15 Feb 2027)`, the weeks from 15 Feb show **Closed** cells and the closed note, C's officers appear as relief under other units, and **Gaps** has no Unit C row from 15 Feb. The **Staffing** panel splits into `4 Jan – 14 Feb` and `15 Feb – 11 Apr`, with C at `0 closed` in the second. **Shifts in closed units** lists C's committed shifts from 15 Feb; **Show on board** opens one. | "Nothing was deleted. The planner simply plans without C from that date; C's officers work as relief, and a supervisor moves or cancels the published shifts." | **VERIFIED** (api; web/e2e by dev-build2) |
| 11 | **Reopen (optional).** **Units → Unit C → Set reopening date…** **29 Mar 2027**, reason **`Renovation ends (demo)`**. | The closure reads **Closed from 15 Feb 2027 · reopens 29 Mar 2027**; a new draft plans C again from that date. | **VERIFIED** (api) |

> **Known limits (say plainly if asked; they are also in the scorecard text and BUILD_RECORD)**
> - **The planner does not check qualifications yet.** It doesn't place shifts by qualification, for example Control or Escort certification at night, so a plan can be short of qualified officers even when the head count is met.
> - **The demo plan has no leave or absences.** Every officer is available all quarter, which is why the casual relief pool gets few hours in the plan. In real use casuals cover leave and gaps.
> - **Hours are balanced over a cycle, but payroll overtime stays per pay period** (P-01). A full-timer's 84 h period on 4 on / 4 off is paid as 4 h overtime even when the cycle averages out. Real averaging arrangements need a rule change.
> - **Recorded extensions count in rule checks.** An officer kept on about 4 h after a 12 h shift counts for rest and hours on the next shift. But a time entry recorded late is not re-checked against shifts already saved after it.
> - **Rule set v2 (the D12/N12 rows) was published by a database migration** as the baseline, like v1. It did not go through the maker/checker approval that every later change uses.
> - **L16 is retired (release 5).** The 100 seed has no 16 h template rows; a "16 h shift" is a 12 h shift plus an extension worked as overtime, and an old database still renders its L16 history. The planner never rosters 16 h shifts.

---

**Fallbacks if a step fails while recording:** don't fake it. Cut the segment and say what isn't finished (CLAUDE.md: honest errors over graceful degradation).
