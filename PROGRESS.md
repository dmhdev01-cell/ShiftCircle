# Build progress (working note)

Internal note for the team; remove before submission (step 13) or fold into the build record.

## Done, committed on `main`

| Step | Commit(s) | Evidence |
|---|---|---|
| 1 spike | `a70556e` | Spring Boot 4.1.3 + Drools 10.2.0 on Java 21, tested in Docker |
| 2 scaffold | `52b8693` | five Maven modules, version endpoint, compose, secrets refusal |
| 3 database | `c24389a` | Flyway V1–V3, constraint tests (T10, T11, overlap), readiness guards |
| 4 rules | `64092c5`, `1452a3d`, `5ad4367`, `dbd0365` | full boundary matrix, seed/rule-set drift guard |
| 4 fixes | `b4a2562`…`6755e4f`, `baf42d0`, `c3f5d41` | review-r2 F2–F8, R5; .gitignore integrity fix |
| 5 generator | `e63e548`, `1c73768`, `3cec3bd` | self-check, PC-01…PC-09, reproducible checksum; PC-06 now counts runs |
| 6 auth | `e19cec5`, `ba8f763` | mock sign-in, HS256 JWT, roles/scope; hostile claims are 401s (A1–A3) |
| 6 schedule | `4c09f95`, `74b22c8` | `GET /api/v1/schedule`, hourly coverage, now in the web's shape |
| 6 assignments | `132590d`, `74b22c8` | rule-check preview, 422/acknowledge/override, audit, S-04 |
| 6 authz | `0a2f51d` | role/scope matrix over the endpoints that exist |
| docs | `6ec99b2` | API spec updated to the shared shapes |

Latest full run: 56 rules + 20 infrastructure + 49 api = **125 tests, all passing** in Docker.

## Next (step 6 remaining, then 7–13)

1. `GET /api/v1/units`, `/employees`, `/shift-templates`, `/qualifications` (reference data for the
   planning board and sign-in flows); `PATCH`/`DELETE /assignments/{id}`; `POST /schedule-periods/{id}/publish`;
   `POST /absences`. Follow the same scope guard + audit pattern.
2. Overtime endpoints and ranking (step 8, T6), proposals (step 10-ish), reports (step 10), rules admin
   (step 11, T7/T10/T13/E3).
3. dev-build2 owns the time/payroll backend on branch `api-time-payroll`; wire its endpoints to
   `AuthPrincipal` and the audit pattern.
4. After those: Playwright E2E (step 12), build record/demo script/recording (step 13).

## Gotchas for the next seat

- The host owns 8080/5432/5433; use `SC_WEB_PORT=18080 SC_API_PORT=28081 SC_DB_PORT=25432`.
- Tests run only in Docker (no JDK on the host); Testcontainers needs the Docker socket and
  `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`.
- `sc.demo.generate=false` lets tests enable the demo profile without generating 100 officers.
- Verify from a clean worktree (`git worktree add /tmp/x HEAD`) before claiming counts: the .gitignore
  bug taught us that working-tree passes can hide uncommitted files.
- Testcontainers 2.0 artifact names are `testcontainers-postgresql` / `testcontainers-junit-jupiter`.
- Boot 4 needs `spring-boot-flyway` explicitly; without it the app reports readiness with no schema.
