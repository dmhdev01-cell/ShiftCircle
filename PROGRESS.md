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

Latest full run: 66 rules + 20 infrastructure + 76 api = **162 tests**, all passing in Docker.

## Next, in the lead's priority order

### a) Step 8 backend: overtime (E1/E2, T6)

**Done** (commits `ba8f95f`, `6e68a8d`). `OvertimeRanker` + `RankingPolicy` in
`shiftcircle-rules`; `OvertimeController`/`OvertimeService`; `/me/schedule` in
`MyScheduleQuery`; V4 adds `CONFIRMED` to `overtime_offer`. Candidates are limited to the
caller's unit scope (overtime totals are scope-only data); confirm accepts the offer-time
warnings but refuses a *new* one. Tests: `OvertimeRankerTest` (10), `OvertimeApiTest` (9),
matrix cells.

### b) Step 11 backend: rules publish pipeline (T7/E3, T10, T13) — DO THIS NEXT

- Reads rows from PostgreSQL (the drift guard proves V2 == RuleRowsV1), validates against
  `TemplateColumns`/builder limits (reject `windowHours` the builders never emit — docs/04 §5a,
  and reject `skipIfBlocked=false`), compiles with `RuleSetCompiler`, runs scenarios T1–T13,
  dry run with counts only (ADR-017), stores the build report, submit/approve (DB maker/checker
  already enforced), publish with a hot-swapped `KieBase` bean (the current config compiles v1
  at startup), version history, rollback. Audit each step.
- T7: change U-10 from 4 to 3 nights on a draft, dry run lists PC-06's four-night runs as new
  warnings; after approval/publish the same check warns. No code change.
- The ranking policy must be read from the published rows too (a v2 draft that edits O-02 has
  to change the list), so route `RankingPolicy.from` through the same published rule set.

### c) Leftovers only if time remains

`PATCH`/`DELETE /assignments/{id}`, `POST /schedule-periods/{id}/publish`, `POST /absences`.

## Gotchas for the next seat

- Host owns 8080/5432/5433: use `SC_WEB_PORT=18080 SC_API_PORT=28081 SC_DB_PORT=25432`.
- Tests only in Docker; Testcontainers needs the socket and `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`.
- `sc.demo.generate=false` enables the demo profile in tests without generating 100 officers.
- Verify counts from a clean worktree (`git worktree add /tmp/x HEAD`); working-tree passes hid files once.
- Testcontainers 2.0 artifact names: `testcontainers-postgresql`, `testcontainers-junit-jupiter`.
- Boot 4 needs `spring-boot-flyway` explicitly or the app reports readiness with no schema.
- JdbcTemplate `query(String, RowCallbackHandler, Object...)` needs the rows handler cast and every
  placeholder bound; `queryForList` returns `java.sql.Date` for dates.
