# Worklog

Newest entry at the top. One dated entry per task: what changed, where, how verified, what is not done, branch.

---

### 2026-10-08 — Step B frontend: driver pages; admin app admin-only
- **Done (frontend):** `/driver/verify-email` (confirm button, not on page load, so email scanners cannot use up
  the token), `/driver/login`, forced `/driver/change-password`, placeholder `/driver` portal; login page shared
  by both areas and refuses the wrong role; `RequireAuth` per role; any 401 logs out (B23 done); lists refetch
  when the tab regains focus.
- **Verified (manually):** full flow: approve → email → confirm → login → forced password change → portal.
- **Not done:** real portal content (payments, charges, vehicles); frontend tests.
- **Next:** payment email parsing (needs B4–B8).
- **Branch:** `feature/driver-login` (frontend).

---

### 2026-10-08 — Step B backend: driver logins (D32, D33)
- **Done (backend):** global `RolesGuard` (admin-only by default); `users.email_verified_at`,
  `must_change_password`, email verification token hash + expiry; `drivers.user_id`; `MailService` (log/smtp,
  Nodemailer); approval creates the driver's login and sends the welcome email inside the transaction;
  `POST /auth/verify-email`, `POST /auth/change-password`; login refuses unverified drivers; forced-change gate;
  `mustChangePassword` in login and `/auth/me`; `openapi.json` exported.
- **Verified (manually):** driver token gets 403 on admin routes; welcome email printed (log) and delivered (Gmail
  SMTP); new login row linked, unverified, must change password, token hash stored; unverified login 403;
  verify 204; forced-change 403 until changed; wrong current password 400; change 200; new password logs in.
- **Not done:** driver frontend (B5); resend-credentials action; automated tests; rate limiting on login and
  verify-email.
- **Next:** B5 driver pages and admin-only admin app; then payment email parsing.
- **Branch:** `feature/driver-login` (backend).

---

### 2026-10-07 — Step A frontend: applications and drivers screens
- **Done (frontend):** Applications list (status filter, pagination, filter and page in the URL), application
  detail (full submission, approve / reject / on hold, approve confirmed in a modal, API errors shown), Drivers
  list (status filter, pagination). Hooks per query and mutation in `applications.queries.ts` and
  `drivers.queries.ts`. Copied from TailAdmin: Table, Badge, Pagination (made controlled), Modal.
- **Verified (manually):** filters and paging (URL survives refresh); approve errors (non-US phone, duplicate phone)
  shown; reject updates the badge and the list without a reload; approved shows no actions; drivers list.
- **Not done:** driver detail page; frontend tests; a 401 during use (expired token) shows an error instead of
  returning to login.
- **Next:** merge both PRs; step B (driver login), starting with the admin-only role check.
- **Branch:** `feature/driver-applications` (frontend).

---

### 2026-10-07 — Step A backend: drivers, applications intake and review (D26, D31)
- **Done (backend):** `drivers` table (unique lower-case email, unique `+1` phone via CHECK, active/inactive);
  `applications` table (unique `request_id`, full payload as jsonb minus `turnstile_token`, review fields,
  CHECK approved iff driver linked); public `POST /applications` (lenient checks, idempotent);
  admin `GET /applications` (paginated, status filter), `GET /applications/:id`, approve / reject / hold
  (approve creates the driver in one transaction with a row lock); admin `GET /drivers`, `GET /drivers/:id`;
  shared `PaginationQueryDto`; `openapi.json` exported; fixture `test/fixtures/application.json`.
- **Verified (manually):** constraints in psql (bad phone, upper-case email, approved without driver, unknown
  driver id); repeat submission returns the same id with one row; token not stored; 400 for missing fields and
  bad email; approve 200 with driver; second approve/reject 409; duplicate email and differently formatted
  duplicate phone 409; non-US phone 400 with nothing saved; hold → reject → approve works; drivers list and filters.
- **Not done:** automated tests; rate limiting and Turnstile on the public endpoint (B16); admin screens (A8–A10).
- **Next:** backend PR; frontend applications and drivers screens; then step B (driver login).
- **Branch:** `feature/driver-applications` (backend).

---

### 2026-10-07 — M0 merged; build order for drivers and payment parsing (D30)
- **Done:** backend PR #1 and frontend PR #2 merged into `dev` (2026-10-06). New branch `feature/driver-applications`.
- **Plan (D30):** step A (drivers, applications intake, admin review) → payment email parsing → step B (driver login).
- **Revised same day (D31):** step A → step B (driver login) → payment email parsing.
- **Next:** A1 `Driver` entity and migration.
- **Branch:** `feature/driver-applications` (backend).

---

### 2026-10-06 — Frontend admin login (D28, D29)
- **Done (frontend):** typed API client generated from `openapi.json` (`npm run api:generate`, `openapi-fetch`
  with a bearer-token middleware); `AuthContext` (login, logout, `/auth/me` session check); central
  `queryClient.ts`; login page at `/admin/login` (TailAdmin `Label`, `InputField`, `Button`); `RequireAuth` guard
  on `/admin`; header shows the logged-in email and role with Sign out. Removed unused `openapi-react-query`.
- **Verified (manually):** build, lint, Prettier pass. `/auth/me` 200 with a stored token, 401 with a bad token
  (token removed). Login: empty fields and invalid email blocked by the browser; wrong password shows
  "Invalid email or password."; success redirects to `/admin`. Logged-out visits to `/admin` and `/` redirect to
  login; refresh keeps the session; Sign out clears the token; API down shows the retry screen.
- **Not done:** admin-only role check (comes with driver accounts); return to the originally requested page after
  login; no frontend tests yet.
- **Next:** backend PR description and merge of both PRs after testing; then applications and drivers.
- **Branch:** `feature/m0-auth` (frontend).

---

### 2026-10-06 — Admin auth backend, CORS, OpenAPI (D25, D27)
- **Done (backend):** `PasswordService` (bcrypt), `UsersService`, `npm run seed:admin`, `POST /auth/login`,
  global `JwtAuthGuard` with `@Public()`, `GET /auth/me` with `@CurrentUser()`, global `ValidationPipe`,
  CORS from `CORS_ORIGINS`, Swagger at `/docs`, `npm run openapi:export` writing `openapi.json`.
- **Verified (manually):** seed creates the admin (bcrypt `$2b$12$` hash) and is a no-op on re-run; login returns
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
- **Verified (manually):** `\dT+ user_role` lists `admin` and `driver`.
- **Next:** `PasswordService`, `UsersService`, `seed:admin`, login, auth guard; then Drivers.
- **Branch:** `feature/m0-auth` (backend).

---

### 2026-10-04 — Port 5000 and renamed Postgres user/db (D23)
- **Done (backend, uncommitted):** port 3000 → 5000 (`.env.example`, `main.ts`, `env.validation.ts`, `CLAUDE.md`);
  Postgres names updated in `.env.example`, `docker-compose.yml` defaults and `docker/initdb/01-create-test-db.sql`.
- **Verified (manually):** volume recreated; `\l` lists `car_rental_db` and `car_rental_db_test`; `migration:run`
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
- **Done (reviewed by Claude):** `singleQuote: false` in the backend `.prettierrc`, `npm run format`
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
