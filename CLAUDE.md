# CLAUDE.md — car-rental-backend-nestjs (backend repo)

NestJS backend. Workspace rules in `../CLAUDE.md` also apply.
Project docs for both repos live in `docs/` — see the index in `../CLAUDE.md`.

## Stack
NestJS, TypeScript strict, Prisma, PostgreSQL (local via `docker-compose`), Jest,
`@nestjs/schedule` for jobs, `@nestjs/swagger` for the OpenAPI document.

## Conventions
- One module per domain: auth, drivers, aliases, ledger, billing, email-intake, plaid,
  matching, sms, settings, dashboard.
- Business logic in services, never controllers.
- Validate every request body with DTOs. Every endpoint documented in OpenAPI.
- External APIs (Gmail, Plaid, Quo, LLM) behind interfaces so tests use fakes.
- Server-side pagination on every list endpoint.
- Scheduled jobs take a Postgres advisory lock so runs never overlap.
- Webhook routes verify signatures using the raw request body.
- Prisma migrations: one per change, never edit an applied migration.

## Commands
<!-- Fill in once the scaffold exists -->
- Install:
- Dev:
- Test:
- Migrate:
- Export OpenAPI:
