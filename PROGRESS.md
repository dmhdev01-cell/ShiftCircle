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

Latest full run: 83 rules + 20 infrastructure + 103 api = **206 tests**, all passing in Docker.

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

### c) Step 12 should-items (lead's order; step 10 reports is dev-build2's `api-reports`, do not redo)

1. **Wall display** `GET /display/today` — counts only, ADR-017 blocks, open shifts and officers
   in overtime, no names; a test scans the payload for every employee name/number. *In progress.*
2. **Audit viewer API** `GET /audit-events` — AUDITOR and scoped SUPERVISOR, filters
   (actor/action/date/entity), paginated, read-only; prove the append-only trigger still refuses
   UPDATE/DELETE.
3. **Absences** `POST /absences` (type only; affects coverage), then
   `POST /schedule-periods/{id}/publish`; `PATCH`/`DELETE /assignments` only if time remains
   (rules + locked-period gate; the web has no move/cancel screen now).

**Before submission:** Playwright E2E E1–E5 against the real api, README setup, BUILD_RECORD,
demo script/recording.

## Gotchas for the next seat

- Host owns 8080/5432/5433: use `SC_WEB_PORT=18080 SC_API_PORT=28081 SC_DB_PORT=25432`.
- Tests only in Docker; Testcontainers needs the socket and `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`.
- `sc.demo.generate=false` enables the demo profile in tests without generating 100 officers.
- Verify counts from a clean worktree (`git worktree add /tmp/x HEAD`); working-tree passes hid files once.
- Testcontainers 2.0 artifact names: `testcontainers-postgresql`, `testcontainers-junit-jupiter`.
- Boot 4 needs `spring-boot-flyway` explicitly or the app reports readiness with no schema.
- JdbcTemplate `query(String, RowCallbackHandler, Object...)` needs the rows handler cast and every
  placeholder bound; `queryForList` returns `java.sql.Date` for dates.
