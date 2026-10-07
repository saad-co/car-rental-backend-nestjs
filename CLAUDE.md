# CLAUDE.md — car-rental-backend-nestjs (backend repo)

NestJS backend. Workspace rules in `../CLAUDE.md` also apply.
Project docs for both repos live in `docs/` — see the index in `../CLAUDE.md`.

## Stack
NestJS 12 (ES modules: relative imports end in `.js`), TypeScript strict, TypeORM, PostgreSQL (local via `docker-compose`), Vitest,
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
- TypeORM migrations: one per change, never edit an applied migration. `synchronize` stays off.
  Workflow: edit the entity, `npm run migration:generate -- src/database/migrations/<Name>`, run `npm run format`,
  read the SQL, then `npm run migration:run`. Add new entities to `src/database/data-source.ts`.
- Every `@Column` gets an explicit `type` (the migration CLI has no decorator metadata). Timestamps are `timestamptz`.
- Every entity must be registered by some module's `TypeOrmModule.forFeature([...])`, including entities that are
  only the target of a relation; `data-source.ts` alone is not enough for the running app (`autoLoadEntities`).
- Routes are admin-only unless `@Roles(...)` opens them (D32). Email goes through `MailService`; local `.env` uses
  `MAIL_MODE=log` unless testing real sends.

## Commands
- Install: `npm install`
- Database: `docker compose up -d` (needs Docker Desktop running); copy `.env.example` to `.env` first
- Dev: `npm run start:dev` (API on http://localhost:5000)
- Build: `npm run build`
- Test: `npm test` (unit), `npm run test:e2e`
- Lint: `npm run lint`
- Format: `npm run format` (Prettier, double quotes; run before committing)
- Migrate: `npm run migration:run` (also `migration:revert`, `migration:show`, `migration:generate -- <path>`)
- Seed first admin: `npm run seed:admin` (needs `ADMIN_EMAIL`, `ADMIN_PASSWORD` in `.env`)
- Export OpenAPI: `npm run openapi:export` (writes `openapi.json`; commit it, then regenerate the frontend client)
- API docs: http://localhost:5000/docs
