# AI-Assisted Development Log

Required by the assessment: tools used, tasks delegated, what was verified, and AI suggestions that were corrected or rejected. **Keep adding entries as you build.** The build record (≤ 2 pages) will quote a few selected excerpts from here.

## Tools

| Tool | Used for |
|---|---|
| Claude (Opus 5.5) in the Claude app, linked to the project folder | Reading the assessment brief, scoping, requirements, architecture, research on Saskatchewan rules and design standards, the UI design canvas, documentation, git setup |
| OpenRig (from 2026-11-20) | Implementation, per `HANDOFF.md`; add its entries below |

## Log

| # | Date | Task delegated to AI | How it was verified | Correction / rejection |
|---|---|---|---|---|
| 1 | 2026-11-19 | Read the assessment PDF and suggest how an existing app idea fits | Lead re-read the brief; rubric weights checked against the PDF | — |
| 2 | 2026-11-19 | Propose scope | Lead reviewed | **AI recommendation partly overridden.** AI recommended one narrow workflow (safe shift swaps). The lead chose a broader scheduling prototype; AI then tiered features Must/Should/Could to manage the risk. Later the lead cut trades and notifications (ADR-010). |
| 3 | 2026-11-19 | Research Saskatchewan rest and hours law | Cross-checked against saskatchewan.ca employment-standards pages (8 h rest in 24 h; 16 h max in 24 h, except emergencies) | — |
| 4 | 2026-11-19 | Find or mock up collective-agreement rules | Sources labelled per rule (SEA, SGEU PS/GE 2022–2025, federal CX agreement, Nunavut, NWT, MOCK) | AI flagged that it could not read the full SGEU agreement text and that local letters of understanding aren't public: **all MOCK values need validation by someone who works in a correctional centre.** |
| 5 | 2026-11-19 | Choose a rules engine | Lead reviewed options | **AI suggestion rejected.** AI recommended a custom rule-type catalogue (ADR-007). The lead chose Drools so non-technical staff can edit rules as decision tables (ADR-012). |
| 6 | 2026-11-19 | Pick Java and Spring Boot versions | Checked Apache KIE release notes | **AI corrected itself.** First proposed Java 25 + Spring Boot 4.1; after checking that Apache KIE 10.2 lists Spring Boot 3.5 and Java 21 support, revised to Java 21 and added a Day 1 compatibility spike with a documented fallback. |
| 7 | 2026-11-19 | Keep docs consistent after scope changes | Lead noticed while viewing the GitHub page | **AI error caught.** README still listed "trade limits" after trades were removed; fixed in commit `012dcab`. |
| 8 | 2026-11-19 | Design the UI (design canvas) | Reviewed sample data for internal consistency | **AI error caught before publishing.** The overtime candidate list was out of order (21 h ranked after 34.5 h), contradicting the fair-distribution rule; reordered. A CSS class used in the first draft (`st-block`) was undefined; added. |
| 9 | 2026-11-19 | Restyle to the Government of Saskatchewan digital standard | Colours and font taken from the published standard; contrast checked | **AI deviated from the standard deliberately:** its error red `#EE0000` fails 4.5:1 text contrast, so blocked messages use `#A30000`. **AI declined** to copy the government logo, wheat sheaf or coat of arms (would present the prototype as an official service). |
| 10 | 2026-11-19 | Size the test dataset | Arithmetic: supply per hour vs requirement | **AI corrected its own earlier design.** The coverage rule "a shift counts toward a block if it covers half of it" double-counted 12 h shifts and distorted sizing. Replaced with hourly coverage (ADR-013 revised). |
| 11 | 2026-11-19 | Create the GitHub repo and push | Repo checked in the browser | AI could create the repo through the browser but couldn't push (session lacked access); the lead pushed from their own terminal. |
| 12 | 2026-11-19 | Apply the lead's shift times (8 h 07–15/15–23/23–07; 12 h 00–12/12–24; 16 h 20:00–12:00) | Re-ran the hourly supply vs requirement arithmetic; checked rest between consecutive 12 h shifts | **AI flagged a consequence:** a 12–24 shift followed by 00–12 gives zero rest, so the 12 h rotation was reordered (2 × 00–12, then 2 × 12–24, then 4 off). Planted case PC-01 and the API example were rewritten for the new times (7 h rest, 17 h in 24 h). |
| 13 | 2026-11-19 | Model 16 h shifts and overtime | Re-ran hourly supply and daily staff-hours (≈ 585 available vs 560 required) | **Lead corrected two AI assumptions:** (1) AI had treated 16 h shifts as overtime-only doubles; they're regular rostered shifts. (2) AI had modelled overtime per shift/day; it's based on hours per week or pay period. AI then noted the consequences: a rostered 16 h shift sits exactly at the legal 16 h-in-24 h limit, so any extension is blocked without an emergency override; period averaging depends on a modified work arrangement under the Employment Act (recorded as an assumption, ADR-016). |
| 14 | 2026-11-20 | Day 1 compatibility spike: Spring Boot 4.x + Drools 10.x on Java 21 (HANDOFF §6 step 1) | `docker run … maven:3.9-eclipse-temurin-21 ./mvnw test` in Docker: 6/6 tests pass (4 rule boundary tests in `shiftcircle-rules`, 2 Spring context tests in `shiftcircle-api`). Then the packaged jar was started on `eclipse-temurin:21-jre-alpine` and reached `Started ShiftCircleApplication` — the rule base compiled at startup on a JRE with no `jdk.compiler` module, so runtime rule compilation (needed by the publish pipeline) does not require a JDK image. | **AI corrected itself twice, from real build errors:** (1) The first template used a literal-first constraint (`"ANY" == "@col" || shiftKind == "@col"`), which Drools 10 rejects at compile time (`ConstraintBuilder$DummyConstraintBuilder.setExprInputs` → `UnsupportedOperationException`); the template now uses a property-first regex `shiftKind matches ".*"`, which also gives the grid an "Any shift" wildcard. (2) The rule base would not compile with only `drools-engine` + `drools-templates`: DRL constraint building needs `org.drools:drools-mvel`, which is not in the `drools-engine` bundle. **Version choice:** Spring Boot **4.1.3** (latest patched 4.1 line) rather than 4.2.0, which was released the same day and has no patch releases yet. |

## Still to verify (open)

- Real shift start times (ADR-015 defaults are a best guess).
- All MOCK collective-agreement values (`docs/05-union-rules.md` §6), with a practitioner.
- ~~Whether Drools 10 works with Spring Boot 4 on Java 21~~ — verified 2026-11-20 by the Day 1 spike (entry 14): Spring Boot 4.1.3 + Drools 10.2.0 on Java 21, template + data row → KieBase → U-01 fires in a stateless session, in Docker and on a JRE runtime image.
- Generated code: every rule must have boundary tests (`docs/10-testing.md` §3) **written or reviewed by a human**, not only generated.
