# Decisions

Append-only. Never edit or delete an entry. If a decision changes, add a new dated entry
that says which entry it supersedes.

Entries dated 2026-10-02 were recorded on that date; most were decided in the preceding weeks.

---

### D1 — 2026-10-02 — Rebuild as a new system, alongside the existing one
The existing FastAPI app (`gonzocar/`) is not extended. A new system is built from scratch.
The old app is a reference for behaviour only. No data migration. Both systems run side by side
and the client keeps whichever parses and matches payments more accurately.
**Why:** client wants a clean application. Decided by Saad with the client.

### D2 — 2026-10-02 — Stack: NestJS, React + Vite, PostgreSQL, Prisma, TailAdmin
Supersedes the Supabase backend recommended in the original proposal.
**Why:** team choice. TailAdmin Pro gives a ready admin UI. The original proposal assumed a
localStorage prototype; the client turned out to have a working FastAPI system instead.

### D3 — 2026-10-02 — Two repos in one workspace
`car-rental-backend-nestjs` and `car-rental-frontend-reactjs`, side by side. The API publishes an
OpenAPI document; the web app generates its typed client from it.
**Why:** deployed separately (Saad's call). The generated client replaces the cross-checking a
single repo would give, so the two cannot silently drift apart.

### D4 — 2026-10-02 — Railway hosting; `dev` and `main` branches
`dev` is integration; all work branches come from `dev` and PR into `dev`. `main` is staging,
deployed to Railway, updated only by a PR from `dev` opened by Saad. No `master`.

### D5 — 2026-10-02 — Money is integer cents
**Why:** floats cannot represent most decimal amounts exactly, and errors accumulate across a ledger.
The reference system passed amounts through floats.

### D6 — 2026-10-02 — Append-only ledger, idempotency in the database
No updates or deletes to ledger entries; corrections are reversals. Every retryable write has a
unique key enforced by a database constraint.
**Why:** every balance must be explainable in a driver dispute, and retries must never double-credit or double-bill.

### D7 — 2026-10-02 — Zelle confirmed through Plaid; two-stage posting
A Chase Zelle email marks a payment `reported` (suppresses reminders). The matching Plaid deposit
marks it `confirmed` and credits the ledger. Reported with no deposit after 72h → `discrepancy`.
**Why:** an email can be forged; a deposit in the bank account cannot. Zelle, Venmo and Cash App
have no public API for receiving payments, so the bank feed is the only machine-verifiable source.
The client's bank is Chase.

### D8 — 2026-10-02 — Cash App and Venmo post in one stage
A verified, validated, matched email credits the ledger directly.
**Why:** that money stays in the app balance and reaches the bank only as a lump-sum cashout, so
there is no individual bank record to confirm against.
**Status:** assumption made while writing the spec. To be confirmed with Saad.

### D9 — 2026-10-02 — LLM extraction and matching instead of hand-written parsers
LLM extracts structured payment data from each verified email; the amount must literally appear in
the email text or the result is rejected. Matching: exact alias lookup (filtered by type) first,
then LLM against the driver list, then the unrecognised bucket below a 0.9 confidence threshold.
Manual assignment creates an alias so the sender matches automatically next time.
**Why:** hand-written parsers break silently when providers change email templates. Proposed to and accepted by the client.

### D10 — 2026-10-02 — Email intake: allow-listed senders, DKIM verified
Gmail queried only for known payment senders (never `in:anywhere`). Each email requires `dkim=pass`
and an exact expected domain. Bodies stored only for payment senders.
**Why:** the reference system read the whole mailbox including spam, trusted the subject line alone
for Zelle, and stored personal mail. A forged email could credit a driver.

### D11 — 2026-10-02 — SMS modes off / dry_run / live, default dry_run
**Why:** the client was promised an off switch for every automated action. With two systems
running side by side, a live default risks drivers receiving duplicate or contradictory reminders.

### D12 — 2026-10-02 — No Stripe ACH for rent collection
**Why:** client rejected it. ACH can bounce on insufficient funds days later, is reversible, and
settles slowly. Rent must be instant and irreversible.

### D13 — 2026-10-02 — No card processing
**Why:** client rejected Stripe card payments over fees.

### D14 — 2026-10-02 — Phase 1 is payments and SMS reminders only
Contracts and e-signature, and vehicle condition / check-in, are later phases.

### D15 — 2026-10-02 — TailAdmin components copied in as needed, not the whole template
The frontend is a fresh Vite + React + TypeScript app. M0 copies the foundation once (Tailwind setup
and theme, fonts, dark mode, app shell). After that, a component is copied only when a screen needs
it, with everything it imports.
**Why:** the template is large; trimming it down leaves a repo full of code nobody understands.
Supersedes the earlier plan to start the frontend from a full copy of the template.

### D16 — 2026-10-02 — Phase 1 build order starts with authentication
Milestone order is set in `PHASE1_SPEC.md` section 11. M0 is auth and roles.
**Why:** every later screen needs a logged-in user, ledger adjustments are admin-only, and auth proves
the full chain (database, API, OpenAPI client, frontend) before money logic is built on it.
The client document groups this under "Setup and foundation"; the milestone split is ours.

### D17 — 2026-10-02 — TypeORM instead of Prisma
Supersedes the Prisma part of D2. Schema = TypeORM entity classes; changes only through generated,
reviewed migration files; `synchronize` stays off (it can drop columns at startup).
**Why:** Saad's choice. Idempotency and uniqueness rules still live in database constraints (D6).

### D18 — 2026-10-02 — Vitest instead of Jest; NestJS 12 (ES modules)
Nest 12's generator produces an ESM project with Vitest and oxlint. Kept as generated. The spec's
"Jest" is changed to "Vitest"; the describe/it/expect API is the same.
**Why:** Jest needs fragile extra configuration for ESM. Verified: constructor injection works under
Vitest (the generated unit and e2e tests pass).

### D19 — 2026-10-02 — Project name `car-rental` for local infrastructure
Docker container `car-rental-db`, volume `car-rental-db-data`, database `car_rental`, test database
`car_rental_test`, user `car_rental`. Matches the repo names.

### D20 — 2026-10-02 — Frontend foundation: light theme only, trimmed TailAdmin shell
Copied from TailAdmin: theme tokens, Outfit font, svgr icon convention, `SidebarContext`, `AppLayout`,
`Backdrop`, `Dropdown`, `cn()`. Rewritten smaller: `AppSidebar` (one nav list, no sub-menus), `AppHeader`
(no search, no notifications), `UserDropdown` (static placeholder until auth). **No dark mode**: all `dark:`
classes removed, no theme context or toggle. Text logo "Car Rental" instead of TailAdmin images.
Not copied: `react-helmet-async`/`PageMeta` (`<title>` is set in `index.html`), icon barrel entries beyond
the two in use. `react-router` is v8 (template used v7); `strict: true` added to `tsconfig.app.json`.
**Why:** Saad asked for a simple theme and basic shell (D15: copy only what a screen needs). Dark mode can be
added later by re-adding the `dark` variant and a theme context.

### D21 — 2026-10-03 — One code style in both repos: Prettier, double quotes
Both repos have the same `.prettierrc` (`singleQuote: false`, `trailingComma: "all"`) and `npm run format`.
Backend formats `src` and `test`; frontend formats `src/**/*.{ts,tsx,css}`.
**Why:** one style across the two repos; format once now so later diffs show only real changes.

### D22 — 2026-10-03 — Database conventions (users table, migrations)
- Primary keys are `uuid` with the database default `gen_random_uuid()` (built into Postgres 13+); TypeORM is told
  `uuidExtension: "pgcrypto"` (picks that function) and `installExtensions: false` (no `CREATE EXTENSION`).
- All timestamps are `timestamptz` (UTC instants). Emails are stored lower-case, enforced by a CHECK constraint.
- Every `@Column` states its SQL `type` explicitly. **Why:** the migration CLI runs through `tsx` (esbuild), which does
  not emit TypeScript decorator metadata, so TypeORM cannot infer types and fails to load the entities.
- Entities and migrations are registered in `src/database/data-source.ts` (explicit entity list; migrations by glob),
  used by the CLI, seed script and tests. The running app gets its connection from `AppModule`.
- Tests use a separate database via `DATABASE_URL_TEST` (name ends in `_test`).
- Env is validated at startup (`src/config/env.validation.ts`); the app refuses to start on a bad value.

### D23 — 2026-10-04 — API port 5000; clearer Postgres names
Supersedes the names in D19 and the default port 3000. API listens on **5000**.
Postgres user `car_rental_user`, password `car_rental_password`, database `car_rental_db`, test database
`car_rental_db_test` (must end in `_test`). Container and volume names are unchanged.
**Why:** user and database had the same name (`car_rental`), which made connection strings hard to read.
Changing them needs a fresh volume (`docker compose down -v`), since Postgres reads these only on first start.

### D24 — 2026-10-04 — Admin-only login; no `staff` role; drivers do not log in
User `role` is `admin` | `driver` with no database default; only `admin` can log in. Drivers are records managed
by admins. `driver` exists so a future driver portal needs no table change. Supersedes the `staff` role in the spec.
**Why:** the client system has no staff role. The spec was drafted in chat and is not binding where it is
inconsistent; it is updated in place when a better decision is made.

### D25 — 2026-10-06 — Admin auth: JWT bearer token, global guard, user re-read per request
`POST /auth/login` returns a JWT (payload `sub` = user id only; lifetime `JWT_EXPIRES_IN_SECONDS`, default 8h).
A global guard (`APP_GUARD`) requires `Authorization: Bearer <token>` on every route unless marked `@Public()`.
The guard loads the user from the database on each request and rejects missing or inactive users, so
deactivation takes effect immediately. Unknown email, wrong password and inactive account give the same 401;
a dummy bcrypt hash keeps response times equal. bcrypt cost 12, passwords limited to 72 bytes.
No Passport: `@nestjs/jwt` plus our own guard. Scripts that need Nest's dependency injection (seed) run from
the compiled build, because `tsx` does not emit decorator metadata.

### D26 — 2026-10-06 — Driver applications and driver accounts (supersedes "drivers do not log in" in D24)
Drivers apply through the existing 3-step form on gonzocar.com. The website sends the same JSON to the old
backend and, as a second independent call, to our public `POST /applications`; both systems run in parallel and
independently. Admins approve, reject or put applications `on_hold`. On approval the system creates the driver
and a `driver` login (email only), generates a password and emails it (Nodemailer); the driver must verify their
email before logging in and must change the password on first login before reaching any other screen.
The driver portal shows payments, charges, late fees, deposit and vehicles, but never a lifetime total paid.
**Why:** Saad and the client (2026-10-05/06). Details still open are in BACKLOG.

### D27 — 2026-10-06 — CORS allow-list; OpenAPI document committed as `openapi.json`
Browser origins allowed to call the API come from `CORS_ORIGINS` (comma-separated). The OpenAPI document is
built by `@nestjs/swagger` with its CLI plugin (DTO types and JSDoc become the schema; no extra decorators),
served at `/docs` and `/docs-json`, and exported by `npm run openapi:export` to `openapi.json` (committed).
The export uses Nest's preview mode, so it needs no database. The frontend generates its client from the file.
**Why:** the file works without a running backend, ties the contract to each commit, and makes API changes
visible in PR diffs.

### D28 — 2026-10-06 — Frontend admin session: token in localStorage, `/auth/me` on load, routes under `/admin`
The access token from `POST /auth/login` is stored in `localStorage` (`carRental.accessToken`) and mirrored in
React state (`AuthContext`). An `openapi-fetch` middleware adds `Authorization: Bearer <token>` to every request.
On page load a stored token is checked with `GET /auth/me`; a 401 removes it. API unreachable keeps the token and
offers a retry. Routes: `/admin/login` public; everything under `/admin` behind `RequireAuth`; any other URL goes
to `/admin`. `RequireAuth` only decides what to show; the API's guard (D25) is the real protection.
**Why:** simplest setup that matches the API's bearer tokens and survives a refresh. Trade-off: script running
on the page (XSS) could read the token; an httpOnly cookie avoids that but needs cookie auth and CSRF protection
in the API (B21). The `/admin` prefix leaves room for driver portal routes (D26).

### D29 — 2026-10-06 — Frontend API data layer: generated types, TanStack Query conventions
- `src/api/schema.d.ts` is generated from the backend's `openapi.json` (`npm run api:generate`) and is the
  list of endpoints and their types; request paths are type-checked against it. No hand-written endpoint list.
- `openapi-typescript` runs through `npx` pinned to 7.13.0 instead of being a dev dependency: its peer
  dependency is TypeScript 5 and the project uses TypeScript 6, so `npm install` fails on peer resolution.
- `src/api/queryClient.ts` holds the only TanStack Query configuration and every query key (hierarchical).
- One `src/api/<feature>.queries.ts` per feature. Every `useQuery` / `useMutation` is wrapped in a custom hook
  there, built from `queryOptions(...)`; screens call only these hooks. Exception: the `/auth/me` query lives
  in `AuthContext` (its fetch function updates the provider's token state).
**Why:** Saad (2026-10-06): configuration in one file, one queries file per feature, a hook per query/mutation.
The generated types make backend changes fail the frontend build instead of failing at runtime.
