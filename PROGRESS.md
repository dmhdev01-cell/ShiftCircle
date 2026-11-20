# Build progress (working note)

Internal note for the team; remove before submission (step 13) or fold into the build record.

## Done, committed on `main`

| Step | Commit(s) | Evidence |
|---|---|---|
| 1 spike | `a70556e` | Spring Boot 4.1.3 + Drools 10.2.0 on Java 21, Docker |
| 2 scaffold | `52b8693` | five modules, version endpoint, compose, secrets refusal |
| 3 database | `c24389a` | Flyway V1–V3, constraint tests (T10, T11, overlap), readiness guards |
| 4 rules | `64092c5`, `1452a3d`, `5ad4367`, `dbd0365` | full boundary matrix, seed/rule-set drift guard |
| 4 fixes | `b4a2562`…`6755e4f`, `baf42d0`, `c3f5d41` | review-r2 F2–F8, R5; .gitignore integrity fix |
| 5 generator | `e63e548`, `1c73768`, `3cec3bd` | self-check, PC-01…PC-09, reproducible checksum, PC-06 runs counted |
| 6 auth | `e19cec5`, `ba8f763` | mock sign-in, HS256 JWT, roles/scope, hostile claims are 401s |
| 6 schedule | `4c09f95`, `74b22c8` | `GET /api/v1/schedule`, hourly coverage, web shape |
| 6 assignments | `132590d`, `74b22c8` | rule-check preview, 422/acknowledge/override, audit, S-04 |
| 6 authz | `0a2f51d` | role/scope matrix over the live endpoints |
| 6 reference | `3d373bc` | units (scoped), shift-templates, qualifications, employees |
| docs | `6ec99b2`, `3d373bc` | API spec matches the api and web shapes |
| step 6 review fixes | `f73d6c5` | preview unit scope, per-officer save lock, override+warn acknowledgement, 28-day U-11 window, problem+json; 142 tests from a clean worktree (ADR-021) |
| 8 overtime | `ba8f95f`, `6e68a8d` | `OvertimeRanker` + endpoints: ranked candidates (PC-07 tie, PC-08 offer→accept→confirm, PC-09 unavailable head, PC-02 exactly 8 h), `/me/schedule`, `/me/offers`, V4 `CONFIRMED`; 162 tests |
| 9 time/payroll merge | `1714f76`, `2b5f3fe` | dev-build2's `api-time-payroll` (T8 golden CSV, T11, T12, T14, CSV quoting); 200 tests from a clean worktree |
| 8 review fixes | `7489cf7` | F1 gate on offer/confirm/assign, F3 row locks + status guards, F2/F4/F6, F7 demo clock, F5 docs; 31 targeted tests |
| 11 rules admin | `2dc1b1b`, `3cc55e6`, `a46580b` | `RuleRowValidator` (T13 + Must rows), `RuleScenarioRunner` (T1-T5 + ranking), drafts/rows/build/dry run/submit/approve/publish, atomic hot-swap snapshot, boot-time published rows; 206 tests |
| merges | `c67488d`, `210e59b`, `1a7d231`, `17308b7` | integration2 (reports M1-M6), integration3 (demo clock, offers 404/400, PC-03 actor, guard fix), its docs, web-display (wall display screen); conflicts only ai-dev-log numbering |
| review nits | `874926b` | balanced-parens validation; TemplateColumns' re-checks throw RuleCompilationException (plain refusal, no 500) |
| 12c schedule publish | `f300cd0` | `POST /schedule-periods/{id}/publish`: scope 404, employee/auditor 403, one-way 409, audit row, board publishedState; absences were already on main from step 9 |
| 12d NFR-05 perf | `51a4cc5` | `PerformanceSmokeTest`: board 4 weeks 54/58 ms, rule check 4/7 ms, 90-day coverage 7/15 ms, rule build 655 ms, publish 516 ms; recorded in docs/10 |
| boot validation | `062da95`, `62dd4fc` | `PublishedRuleSet` runs `RuleRowValidator` on the published rows at boot; unreadable rows stop the boot instead of falling back to v1; direct-edit tests restore the row |
| 12e move/cancel | `c1dd6ad` | `PATCH`/`DELETE /assignments/{id}`: full rule pipeline on the target with own slot excluded, If-Match inside the officer lock, ETag/version, locked/started/actual/fills-open checks, audit before/after, 16 tests; POST and board items carry version too. Shapes handed to dev-build2 |
| traceability | `docs/traceability.md` | 20 rules + S-04, T1-T14, E1-E5, guardrails 1-8 and ADR-001..023 mapped to exact tests; 65 class#method refs machine-checked. Found and reported: scenario JSON claim, U-15 boundary, FR-07 notice flag, NFR-09 OpenAPI, ADR-015 editing, perf E2E claim |
| U-15 boundaries | `57da6b1` | `ScheduleApiTest` pins 71.99/72/79.99/80/80.01 h plus last-day/midnight and a separate period; 2 new tests; fixture clears time entries |
| reason caps + absence | `f1d696d` | cancel/override/unlock/reject reasons capped at 500 with 400 naming the field; cancel refuses `absence-recorded`; tests for each; docs/07 updated |
| order-proof tests | `22375d4` | one database per API test class; authz stale-token bug fixed; reverse + random x2 each 276 tests green |
| generated password | `22375d4` | no-op `UserDetailsService` stops Boot's default user; `AuthApiTest` asserts no in-memory user and basic auth 401; log line gone |
| 12b audit viewer | `21af15c` | `GET /audit-events`: auditor facility-wide, supervisor scoped to their units, filters (actor/action/entity/date), keyset pages, read-only; 405s and the append-only trigger proven |
| review S1-S5 | `e13ddeb`, `b572dff`, `444f685`, `03ceb19`, `35c225d` | DRL injection closed (codes/messages/regex validated before compile + escaped again), shift-kind bounded against ReDoS, message edits saved, Must policies pinned, limits capped + silent rule named, odd input 400/404 problems |
| 12a wall display | `6649eb1`, `f191d07`, `6237258` | `GET /display/today` (ADR-017 hourly blocks, midnight-crossing night, no names, scope, roles); the `coverage/` ignore fix that a clean checkout caught; ignored-source guard script + README step; 209 tests from a clean worktree at `f191d07` |
| 12f schedule periods | `4a24ca9`, `530ab82`, `fe6487d` | the generator seeds the 84 roster weeks a supervisor publishes (past weeks published, the current and later weeks drafts), every shift points at its period, and the self-check refuses a dataset without them; the board returns `period {id, label, status}` and a real `unpublishedChanges` count from the audit trail; `SchedulePeriodSeedApiTest` publishes a **generated** period; 284 tests |
| 12g raw 500 on a conflicting save | `ca85c69`, `5f426ce` | a database constraint now answers a problem document, never a 500: one advice maps every SQLSTATE (23P01 → 409 "this officer already has a shift at that time", 23505 → 409, 23514 → 409, 22003 → 400) and nothing rethrows; `ConstraintProblemApiTest` goes through HTTP for the overlapping save, the overlapping move and the guarded overtime confirm; a catch-all answers every other error as problem+json (the advices are ordered so it cannot shadow them); 295 tests |
| 12h hidden errors logged | `dcee43b` | a refusal the caller cannot see behind is now visible to the operator: the catch-all logs the exception and stack at ERROR under a `traceId` that is also in the body (5xx `ErrorResponse` takes the same path, a 4xx keeps its status and is not logged as a fault); a database conflict logs at WARN with its SQLSTATE and constraint name; the rule-compile refusal is pinned by a log test; the boot-validation and unreadable-rows refusals log at ERROR before the app stops; docs/07 §2.2 matches |
| 12i rules-admin refusals | `23bdf0e`, `211e8f9`, `d2d120e` | a row edit is saved or refused, never dropped: unknown keys (unless on the stored row), wrong types, missing non-nullable values and lists over 16 are 400 naming the column; `afterShiftKind` is authoritative in params, the strict grammar is saved and hostile values are refused; minRestHours is 8–24; the validator is total (a stored bad value, including `params = NULL`, is a validation error, not a 500 or an NPE) and a build shows at most 20 errors; `RuleRowEditApiTest` (31 @Test at the final tip; 19 when this row closed); the intermediate static count at this point was 323, superseded by 348 in 12j |
| 12j review-r2/r3 findings | `c0dcaf3`, `33493d0`, `edca04d` | after-label vs params conflict is 400; every numeric column has a documented range at PUT and validator; the validator is total for any JSON root; message/enums/ranges; a new REST row may carry minExtensionMinutes; startAt ±5 years and type ASSIGN|EXTRA are 400; the employee list is scoped; unknown top-level row fields are 400; JWT blank default gives the friendly secret message; LF is neutralised in CSV; open-shift assign/confirm lock the shift first so one fill wins (revert-the-fix: 3/3 officers filled), unlock guards on LOCKED and writes one audit row (revert-the-fix: 4 rows); concurrency + HTTP tests; static total 348 = 97 + 27 + 224; dev-qa's independent default and random seed 20261121 runs at `c0dcaf3` are green |
| 12k D6 rule sentence | `8c5d705` | the sentence the rules screen shows names the shift in words ("any shift", "a regular shift", "a 16-hour shift", or the codes) and the outcome as blocked/warned/noted, never the stored `.*` or the raw enum (`block`); `RuleSentenceTest` scans all 97 shipped rows and pins U-01, and `RuleSetApiTest` checks the GET; red on the old builder ("After .*, ... the change is block."); static 351 = 97 + 27 + 227; this author's full clean-worktree runs at `dc6890e` are 351, 0 failures/errors/skipped in default order and random seed 20261121; dev-qa's independent run pending |
| 12l V12/V19/V5 | `c8c05cd` | refusals name the visible column label, not the params key (the minRestHours and shift-kind messages too); rest rule evidence reads "P12 ending ..., next shift D8 starts ..." with no assignment UUID; seeded locked pay periods record m.ellis so GET /pay-periods names the actor, matching the API lock path; tests red then green (1 + 31 + 14 + 1); static 352 = 97 + 27 + 228; this author's full clean-worktree runs at `c8c05cd` are 352, 0 failures/errors/skipped in default order and random seed 20261121; dev-qa's independent run pending |
| 12m plain evidence everywhere | `9ef9f7c` | the four other fact builders stop echoing assignment ids: rolling names hours/window/count, long-shift names counts/date, consecutive names run length/end date, shift-length names pattern/duration/unit; `FactEvidenceTest` feeds real UUID ids to each builder and asserts the evidence excludes them (red first); the ids move to `RuleResult.evidenceAssignmentIds` so the demo self-check matches overrides without reading the message; rules 101; static 356 = 101 + 27 + 228; this author's full clean-worktree runs at `8a2257a` are 356, 0 failures/errors/skipped in default order and random seed 20261121; dev-qa's independent run pending |
| merge web-stable | `5e7765f` | ux-audit + publish-action + period-shape + web-stable merged `--no-ff`; planning board move/cancel and publish-period actions, audit viewer screen, error boundaries, real-api contract samples, web test waits; ai-dev-log numbering settled at 68/69/70; 301 tests at the merge tip |

Latest full runs: dev-qa's independent clean-worktree runs at `c0dcaf3` are **348 = 97 rules + 27 infrastructure + 224 api tests**, in the default order and with random seed 20261121, 0 failures/errors/skipped; this author's static count agrees. Playwright against the real api: desktop 19 passed, tablet 18 + 1 skipped (the TV-size check is desktop-only); fixtures 43 passed / 3 skipped. Earlier, as history: 301 at `5e7765f` (this author, seed 20261120), and dev-qa's 4 red at `211e8f9` were fixed at `d2d120e`. The infrastructure count moved from 22 to 27 with the web chain (`DemoDataReadinessTest`, `ReferenceDataHealthIndicatorTest`). Dataset checksum `3390148255db715844c4df90f553ae342530417621539b23499f638c5b126539` (roster and the 84 roster weeks); the T8 golden file is byte-identical.

## Next, in the lead's priority order

### a) Step 8 backend: overtime (E1/E2, T6)

**Done** (commits `ba8f95f`, `6e68a8d`). `OvertimeRanker` + `RankingPolicy` in
`shiftcircle-rules`; `OvertimeController`/`OvertimeService`; `/me/schedule` in
`MyScheduleQuery`; V4 adds `CONFIRMED` to `overtime_offer`. Candidates are limited to the
caller's unit scope (overtime totals are scope-only data); confirm accepts the offer-time
warnings but refuses a *new* one. Tests: `OvertimeRankerTest` (10), `OvertimeApiTest` (9),
matrix cells.

### b) Step 11 backend: rules publish pipeline (T7/E3, T10, T13)

**Done** (commits `2dc1b1b`, `3cc55e6`). `RuleRowValidator` (T13), `RuleScenarioRunner`
(T1-T5 + O-02 ranking), `RuleSetService`/`RuleSetController` (drafts, row edits, build with
validate→compile→scenarios→dry run, submit, maker/checker approve/reject, publish with hot swap,
row fingerprint), `RuleRowsRepository` + `PublishedRuleSet` boot from PostgreSQL, `/version`
reports the live version. Tests: `RuleSetApiTest` 4 (T13, T10, T7 dry run + post-publish WARN,
E3), validator 13, scenarios 3.

### c) Step 12 should-items — all done

1. **Wall display** `GET /display/today` (`6649eb1`); screen merged at `17308b7`.
2. **Audit viewer** `GET /audit-events` (`21af15c`).
3. **Absences** already on main from step 9 (`POST /absences`, assignment + type, tested in
   `PayrollApiTest`); **schedule publish** `POST /schedule-periods/{id}/publish` (`f300cd0`), and
   the periods it publishes now exist (`4a24ca9`): the generator seeds one roster week per unit
   and week, so a fresh stack has a draft week to publish, and the board hands over the id
   (`530ab82`). The web's Publish action is dev-build2's (branch `publish-action`).
4. **NFR-05 performance smoke** (`51a4cc5`, docs/10).
5. **Boot validation** (`062da95`, `62dd4fc`): the published rows run the same validator as the
   publish path, and unreadable rows stop the boot instead of falling back to v1.

### d) Submission work (HANDOFF step 13)

- Playwright E1-E5 against the real api on main (`e2e/`, dev-build2's specs merged at `17308b7`).
- README setup pass, `BUILD_RECORD.md`, demo script/recording.
- `PATCH`/`DELETE /assignments` are built (`c1dd6ad`); the exact shapes went to dev-build2 so the
  web can bring move/cancel back. Excel round-trip for rule tables remains **not built**, and
  docs/10 §8 says so plainly.
- The demo script has no roster-publish beat yet: it can be written once the web's Publish action
  lands (dev-build2). The api side is ready and proven on a fresh dataset.

**Before submission:** Playwright E2E E1–E5 against the real api, README setup, BUILD_RECORD,
demo script/recording.

## Gotchas for the next seat

- A rules-admin PUT now refuses rather than drops: unknown keys (unless already on the stored row), wrong types, missing non-nullable values, lists over 16 values, minRestHours outside 8–24 and a bad afterShiftKind are 400 naming the column. There is no V5 migration; the one undeclared column the v1 rows carry (`minExtensionMinutes`) is accepted because it is on the stored row. `RuleRowEditApiTest` is the HTTP proof; the validator is total, so a stored bad value is a validation error, not a 500.
- Host owns 8080/5432/5433: use `SC_WEB_PORT=18080 SC_API_PORT=28081 SC_DB_PORT=25432`.
- Tests only in Docker; Testcontainers needs the socket and `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`.
- `sc.demo.generate=false` enables the demo profile in tests without generating 100 officers.
- Tests share one PostgreSQL container but each API class gets its own database
  (`PostgresTestSupport`), so class order cannot leak state. Keep fixtures off the demo day
  (2026-11-19) where the display/schedule tests assert exact Unit A coverage. Run reverse and random
  class order when changing test infrastructure; the README has the commands.
- Verify counts from a clean worktree (`git worktree add /tmp/x HEAD`); working-tree passes hid files once.
- `.gitignore` patterns must be anchored to the build output (`/web/build/`, `/web/coverage/`): the
  unanchored forms each swallowed a Java package (`rules/build/`, `api/coverage/`). Run
  `./scripts/check-ignored-sources.sh` before committing and again in the clean worktree.
- Testcontainers 2.0 artifact names: `testcontainers-postgresql`, `testcontainers-junit-jupiter`.
- Boot 4 needs `spring-boot-flyway` explicitly or the app reports readiness with no schema.
- JdbcTemplate `query(String, RowCallbackHandler, Object...)` needs the rows handler cast and every
  placeholder bound; `queryForList` returns `java.sql.Date` for dates.
