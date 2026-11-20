# ShiftCircle

A shift-scheduling prototype for a 24/7 provincial correctional centre. Supervisors plan 8, 12 and 16-hour shifts against a **configurable rules engine** (rest and hours limits, consecutive shifts, staffing, qualifications, overtime). Employees see their schedule and hours and propose shifts. Time feeds a payroll export, and reports show coverage and overtime as planned vs. actual.

> Built for the AI Solutions Architect screening assessment. **All data is synthetic.** Payroll and sign-on are simulated. The dataset is 100 fictional officers over 90 days.

> **Picking this up?** Start with [HANDOFF.md](HANDOFF.md).

## Architecture at a glance

Three containers: **web** (nginx + React) · **api** (Java 21 + Spring Boot 4.x + Drools rules engine) · **db** (PostgreSQL). See [docs/03-architecture.md](docs/03-architecture.md).

## Documentation

| Doc | What's in it |
|---|---|
| [docs/01-scope-and-plan.md](docs/01-scope-and-plan.md) | Problem, users, outcomes, feature priorities, assumptions, plan, open questions |
| [docs/02-requirements.md](docs/02-requirements.md) | Screens, functional and non-functional requirements, rules catalogue, data model, test cases |
| [docs/03-architecture.md](docs/03-architecture.md) | Containers, layers, change flow, frontend, security |
| [docs/04-rules-engine.md](docs/04-rules-engine.md) | Rules engine design: Drools decision tables a non-technical admin can edit |
| [docs/05-union-rules.md](docs/05-union-rules.md) | Mock collective-agreement rule set, with each rule's source |
| [docs/06-data-model.md](docs/06-data-model.md) | PostgreSQL tables, constraints, ER diagram, migrations and seed |
| [docs/07-api-spec.md](docs/07-api-spec.md) | REST endpoints, rule-check/override contract, error format, screen-to-endpoint map |
| [docs/08-deployment.md](docs/08-deployment.md) | Docker Compose topology, configuration, startup, nginx, path to pilot |
| [docs/09-access-control.md](docs/09-access-control.md) | Roles, permission matrix, enforcement, mock sign-in, privacy |
| [docs/10-testing.md](docs/10-testing.md) | Test strategy, rule boundary matrix, scenarios, E2E flows, demo dataset spec |
| [docs/ui/README.md](docs/ui/README.md) | UI spec: Sask design tokens, components, every screen; design files in `docs/ui/screens/` |
| [docs/ai-dev-log.md](docs/ai-dev-log.md) | AI-assisted development log (assessment requirement) |
| [docs/decisions.md](docs/decisions.md) | Decision log (ADRs) |

**UI design:** six screens (planning board, my schedule, overtime board, rules admin, reports, wall display) are specified in `docs/ui/`. The original design canvas is a private Claude artifact owned by the project lead.

## Setup

_Coming in Day 1 scaffolding: `docker compose up`, then open http://localhost:8080._
