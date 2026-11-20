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

Latest full run: 56 rules + 20 infrastructure + 54 api = **130 tests**, all passing in Docker.

## Next, in the lead's priority order

### a) Step 8 backend: overtime (E1/E2, T6) — DO THIS NEXT

- `OvertimeRanker` in `shiftcircle-rules`: policy from the OT_RANKING rows
  (`orderBy`, `skipIfBlocked`, `keepPlace`); rank candidates by fewest overtime hours this quarter,
  ties by seniority; mark `SKIPPED` (would break a Block rule) **without losing their place**, and
  `UNAVAILABLE` (unqualified, already scheduled, insufficient rest).
- Endpoints: `GET /open-shifts?unitId=&from=&to=&status=`, `GET /open-shifts/{id}/candidates`
  (ranked list + per-candidate rule results), `POST /open-shifts/{id}/offers` (SUPERVISOR, audit),
  `GET /me/offers`, `POST /offers/{id}/accept|decline` (own), `POST /offers/{id}/confirm`
  (SUPERVISOR; creates the assignment through the same rules/override/audit path).
- T6 test: planted PC-08 open Unit B day shift Sat 21 Nov; assert fewest-OT-then-seniority order,
  a skipped officer keeps their rank, and PC-09's unqualified highest-ranked officer shows
  UNAVAILABLE for Control.

### b) Step 11 backend: rules publish pipeline (T7/E3, T10, T13)

- Reads rows from PostgreSQL (the drift guard proves V2 == RuleRowsV1), validates against
  `TemplateColumns`/builder limits (reject `windowHours` the builders never emit — docs/04 §5a),
  compiles with `RuleSetCompiler`, runs scenarios T1–T13, dry run with counts only, stores the
  build report, submit/approve (DB maker/checker already enforced), publish with a hot-swapped
  `KieBase` bean (replace `RuleEngineConfig.publishedRuleBase` with a mutable holder), version
  history, rollback.
- T7: change U-10 from 4 to 3 nights on a draft, dry run lists PC-06's four-night runs as new
  warnings; after approval/publish the same check warns. No code change.

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
