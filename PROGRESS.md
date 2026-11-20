# Build progress (working note)

Internal note for the team; remove before submission (step 13) or fold into the build record.

## Done, committed on `main`

| Step | Commit(s) | Evidence |
|---|---|---|
| 1 spike | `a70556e` | Spring Boot 4.1.3 + Drools 10.2.0 on Java 21, tested in Docker |
| 2 scaffold | `52b8693` | five Maven modules, version endpoint, compose, secrets refusal |
| 3 database | `c24389a` | Flyway V1–V3, constraint tests (T10, T11, overlap), readiness guards |
| 4 rules | `64092c5`, `1452a3d`, `5ad4367`, `dbd0365` | 56 rule tests, full boundary matrix, seed/rule-set drift guard |
| 4 fixes | `b4a2562`…`6755e4f`, `baf42d0`, `c3f5d41` | review-r2 F2–F8, R5; .gitignore integrity fix |
| 5 generator | `e63e548`, `1c73768`, `c3f5d41` | 100 officers × 90 days, self-check, PC-01…PC-09, reproducible checksum |
| 6 auth | `e19cec5` | mock sign-in, HS256 JWT, roles/scope, /me |
| 6 schedule | `4c09f95` | `GET /api/v1/schedule` with ADR-017 coverage fields |

Full suite at `c3f5d41` from a clean worktree: 84/84. Later slices add api tests
(22 after auth, 29 after schedule) and are run module-local in Docker.

## Next (step 6 remaining)

1. `POST /api/v1/rule-checks` preview: build facts for a proposed change, return
   `ruleResults` with PASS/WARN/BLOCK, evidence and rule-set version.
2. `POST /api/v1/assignments` (+ PATCH/DELETE): 422 with `ruleResults`, Warn needs
   `acknowledgeWarnings`, Block needs an EMERGENCY override with reason ≥ 10 chars;
   saving creates the assignment, the override row and an audit event.
3. Authorization matrix tests: one per denied/scoped cell of docs/09 §2, plus S-04
   (EXTRA shifts/offers only by SUPERVISOR, audited).
4. Then steps 7–13 per HANDOFF; dev-build2 owns step 9 backend.

## Running everything

- Tests: `docker run --rm -v "$PWD/api":/src -v shiftcircle_m2:/root/.m2 -v /var/run/docker.sock:/var/run/docker.sock -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal -w /src maven:3.9-eclipse-temurin-21 ./mvnw -B test`
- Stack: `SC_WEB_PORT=18080 SC_API_PORT=28081 SC_DB_PORT=25432 docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build` (this host already owns 8080/5432/5433).
