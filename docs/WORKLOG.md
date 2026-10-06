# Worklog

Newest entry at the top. One dated entry per task: what changed, where, how verified, what is not done, branch.

---

### 2026-10-06 — Admin auth backend, CORS, OpenAPI (D25, D27)
- **Done (backend):** `PasswordService` (bcrypt), `UsersService`, `npm run seed:admin`, `POST /auth/login`,
  global `JwtAuthGuard` with `@Public()`, `GET /auth/me` with `@CurrentUser()`, global `ValidationPipe`,
  CORS from `CORS_ORIGINS`, Swagger at `/docs`, `npm run openapi:export` writing `openapi.json`.
- **Verified (by Saad):** seed creates the admin (bcrypt `$2b$12$` hash) and is a no-op on re-run; login returns
  a token; wrong password 401; invalid body 400; `/auth/me` 200 with token, 401 without or with a tampered token;
  a deactivated admin is rejected with a still-valid token; CORS answers only allowed origins; `/docs` Authorize
  flow works; `openapi.json` exported. build, lint and Prettier pass.
- **Not done:** no automated tests for auth yet; Swagger pages are public (decide for staging).
- **Scope change recorded:** driver applications and driver accounts (D26).
- **Next:** frontend admin login (generated client, login page, protected routes); then applications and drivers.
- **Branch:** `feature/m0-auth` (backend).

---

### 2026-10-04 — Role cleanup: `admin` | `driver` (D24)
- **Done (backend, uncommitted):** `Role` enum is `admin` | `driver`; `role` column has no default; JSDoc on the
  `User` entity; migration `ReplaceStaffRoleWithDriver` generated and applied. Spec, ARCHITECTURE and DECISIONS updated.
- **Verified (by Saad):** `\dT+ user_role` lists `admin` and `driver`.
- **Next:** `PasswordService`, `UsersService`, `seed:admin`, login, auth guard; then Drivers.
- **Branch:** `feature/m0-auth` (backend).

---

### 2026-10-04 — Port 5000 and renamed Postgres user/db (D23)
- **Done (backend, uncommitted):** port 3000 → 5000 (`.env.example`, `main.ts`, `env.validation.ts`, `CLAUDE.md`);
  Postgres names updated in `.env.example`, `docker-compose.yml` defaults and `docker/initdb/01-create-test-db.sql`.
- **Verified (by Saad):** volume recreated; `\l` lists `car_rental_db` and `car_rental_db_test`; `migration:run`
  applied `CreateUsers` to the new database.
- **Branch:** `feature/m0-auth` (backend).

---

### 2026-10-03 — M0: config, TypeORM, `User` entity, first migration (backend)
- **Done (backend repo, uncommitted):** `ConfigModule` + startup env validation (`PORT`, `DATABASE_URL`);
  TypeORM connected via `TypeOrmModule.forRootAsync`; `User` entity and `UsersModule`; shared `data-source.ts`;
  migration `CreateUsers` generated and applied to the dev database; scripts `typeorm`, `migration:generate|run|revert|show`;
  `.env.example` gained `DATABASE_URL` and `DATABASE_URL_TEST`.
- **Verified:** Docker Postgres up, `car_rental` and `car_rental_test` exist (init script works). `\d users` matches the
  entity. In rolled-back transactions Postgres rejected a duplicate email, an upper-case email and an invalid role.
  `migration:show` lists the migration as applied. App starts against Postgres; a bad `PORT` or missing `DATABASE_URL`
  stops startup with a clear message. `prettier --check`, `build`, `npm test`, `npm run test:e2e`, `npm run lint` pass.
- **Not done:** the migration is applied to the dev DB only, not `car_rental_test` (done in the test-setup step);
  no service, controller, password hashing or seed yet.
- **Next:** `PasswordService` + `UsersService` + `seed:admin`, then auth (login, guards).
- **Branch:** `feature/m0-auth` (backend).

---

### 2026-10-03 — Prettier formatting in both repos
- **Done (by Saad, reviewed by Claude):** `singleQuote: false` in the backend `.prettierrc`, `npm run format`
  over the backend; same `.prettierrc` and Prettier added to the frontend (`format` script), frontend formatted (D21).
- **Verified:** formatting-only diffs; `prettier --check` clean in both repos; backend `build`, `test`, `test:e2e`,
  `lint` pass; frontend `build` passes, `lint` 0 errors (same 1 warning as before).
- **Also done:** Prettier version range aligned to `^3.9.9` in both repos (3.9.9 was already installed in both).
- **Branch:** `feature/m0-auth` (both).

---

### 2026-10-02 — M0 frontend base: Vite app + TailAdmin shell
- **Done (frontend repo, uncommitted):** Vite 8 + React 19 + TypeScript (strict), Tailwind v4 via PostCSS,
  `react-router` 8. TailAdmin foundation in light theme only (D20): theme CSS, `SidebarContext`, `AppLayout`,
  `AppSidebar`, `AppHeader`, `Backdrop`, `UserDropdown` (placeholder), `Dropdown`, `cn()`, svgr icon setup,
  placeholder Dashboard page, `.gitattributes` (`* text=auto eol=lf`, completes B11), `.gitignore` covers `.env`.
- **Verified:** `npm run build` passes (`tsc -b` + `vite build`); `npm run lint` 0 errors, 1 warning
  (`SidebarContext` exports a hook and a component, same as TailAdmin); `npm run dev` checked in the browser:
  desktop and mobile layout, sidebar collapse to icons, user menu opens, no console errors.
- **Not done:** no login page, no auth, no API client, no TanStack Query yet (planned steps 11–12);
  user menu shows a static placeholder user; no real logo (BACKLOG).
- **Next:** TypeORM + `User` entity + first migration (backend), once Docker Desktop is running.
- **Branch:** `feature/m0-auth` (frontend).

---

### 2026-10-02 — M0 step 1: backend scaffold
- **Done (backend repo, uncommitted):** NestJS 12 scaffold (ESM, Vitest, oxlint), package renamed
  `car-rental-backend-nestjs`, `.gitattributes` (`* text=auto eol=lf`, part of B11), `.gitignore`,
  `docker-compose.yml` (Postgres 17 + init script creating `car_rental_test`), `.env.example`.
  Docs fixed for the TypeORM / Vitest / "two repos, not monorepo" decisions (D17–D19; spec §2, §4, §11,
  ARCHITECTURE, both CLAUDE.md files).
- **Verified:** `npm run build`, `npm test` (1 passed), `npm run test:e2e` (1 passed), `npm run lint`
  (exit 0); built app answers `GET /` with `Hello World!`; `npm audit --omit=dev` = 0 issues.
- **Not verified:** `docker compose up` — Docker Desktop was not running on this machine.
- **Not done:** no config/env validation yet (added with the database step); frontend `.gitattributes` (B11 stays open).
- **Next:** start Docker Desktop, bring up Postgres; then TypeORM + `User` entity + first migration.
- **Branch:** `feature/m0-auth` (backend).

---

### 2026-10-02 — Project setup
- **Done:** both repos created by Saad under `saad-co`. Initial commit on `main` with `CLAUDE.md` and
  `docs/` (backend) and `CLAUDE.md` (frontend); `dev` created from `main`. Docs finalised on
  `feature/m0-auth`: client scope document added as `docs/reference/CLIENT_SCOPE.md`, D15 and D16 recorded.
- **Not done:** nothing pushed — waiting on write access (B1). No application code exists.
- **Next:** M0 on `feature/m0-auth` in both repos.
- **Branch:** `feature/m0-auth` in both repos.
