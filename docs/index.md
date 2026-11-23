# ShiftCircle documentation

ShiftCircle is a shift-scheduling prototype for a fictional 24/7 correctional centre. It is built with a configurable rules engine, a whole-quarter planner, time and attendance, and a simulated payroll export.

All data is synthetic, and sign-in and payroll are simulated.

This page is plain Markdown with relative links. It reads on GitHub as it is. It also works on GitHub Pages with no build step, provided Pages serves the repository root, because some links point up to files beside `docs/`. The site then starts at `/docs/`.

## Use it

- [Install and run](../INSTALL.md): Docker only. Covers start, reset, upgrade and remove.
- [User guide](../USER-GUIDE.md): sign-in, words used throughout, and what to do when something goes wrong. Then one page per role:
  - [Officer](user-guide/officer.md)
  - [Supervisor](user-guide/supervisor.md)
  - [Planner](user-guide/planner.md)
  - [Auditor](user-guide/auditor.md)
  - [Rules admin and approver](user-guide/admin.md)
- [Demo script](demo-script.md): a five-minute walk through the main flows.

## How it works

| Doc | What's in it |
|---|---|
| [Scope and plan](01-scope-and-plan.md) | Problem, users, outcomes, priorities, assumptions |
| [Requirements](02-requirements.md) | Screens, functional and non-functional requirements, rules catalogue |
| [Architecture](03-architecture.md) | Containers, layers, change flow, security |
| [Rules engine](04-rules-engine.md) | Drools decision tables an admin can edit, and the publish pipeline |
| [Union rules](05-union-rules.md) | The mock collective-agreement rule set, with sources |
| [Data model](06-data-model.md) | PostgreSQL tables, constraints, migrations and seed |
| [API](07-api-spec.md) | REST endpoints, the rule-check and override contract, errors |
| [Deployment](08-deployment.md) | Docker Compose topology, configuration, path to pilot |
| [Access control](09-access-control.md) | Roles, permission matrix, mock sign-in, privacy |
| [Testing](10-testing.md) | Test layers, rule boundary matrix, scenarios, end-to-end flows |
| [Traceability](traceability.md) | Each requirement mapped to the test that proves it |
| [Decisions](decisions.md) | The decision log (ADRs) |
| [UI specification](ui/README.md) | Design tokens, components and every screen |

## How it was built

- [Build record](../BUILD_RECORD.md): the two-page summary.
- [Process records](process/):
  - [the brief](process/HANDOFF.md);
  - [AI-assisted development log](process/ai-dev-log.md);
  - [review and QA rounds](process/review-rounds.md).

## Licence

[MIT](../LICENSE).
