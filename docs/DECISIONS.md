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

### D30 — 2026-10-07 — Build order: drivers and applications, then payment parsing, then driver login
1. **Step A:** `drivers` and `applications` tables, public `POST /applications`, admin review (approve creates the
   driver), admin screens. Tested with a fixture JSON and Postman/curl, not the live website.
2. **Payment email parsing** (spec M3/M4): Gmail intake, extraction, matching payments to drivers.
3. **Step B:** driver logins from D26 (generated password, email verification, forced password change, portal),
   starting with an admin-only role check on admin endpoints.

Connecting the live gonzocar.com form to `POST /applications` is the last step, after deployment and full testing.
**Why:** payment parsing is the client's main problem (Saad, 2026-10-07). Matching payments needs driver records
but not driver logins, so the login work moves after parsing. The live form is the client's real sign-up flow, so
it is only touched once our endpoint is deployed and proven.

### D31 — 2026-10-07 — Driver login before payment parsing (supersedes the order in D30)
Order: step A (drivers, applications) → step B (driver login, D26) → payment email parsing.
Connecting the live gonzocar.com form stays the last step.
**Why:** Saad: driver login is small, and application → approval → driver login forms one flow that is
tested together.

### D32 — 2026-10-08 — Roles: admin-only by default
A second global guard (`RolesGuard`, after `JwtAuthGuard`) checks the user's role. A route without `@Roles(...)`
is admin-only; routes open to drivers say so (`@Roles(Role.admin, Role.driver)` on `/auth/me` and
`/auth/change-password`). 401 = unknown user, 403 = known user without access.
**Why:** a forgotten decorator on a new admin route must not expose it to drivers.

### D33 — 2026-10-08 — Driver logins: created on approval, verified by email, forced password change
- A driver's login is a `users` row (role `driver`), linked by `drivers.user_id` (unique). Approval creates it in
  the same transaction as the driver, with a generated password (`must_change_password = true`).
- The welcome email (password + verification link) is sent last inside that transaction; a failed send rolls
  everything back and returns 503. The rarer reverse case (sent, commit fails) is accepted.
- The verification link carries a random one-time token; only its SHA-256 hash and an expiry (48 h) are stored on
  `users`, cleared on use. Not a JWT: the auth guard accepts any JWT signed with `JWT_SECRET` as a login.
- Drivers cannot log in before verifying (403, only after a correct password). Admins are not required to verify.
- While `must_change_password` is true, `RolesGuard` answers 403 on every route except those marked
  `@AllowedBeforePasswordChange()` (`/auth/me`, `/auth/change-password`). New passwords: 8 characters to 72 bytes.
- Email goes through `MailService`: `MAIL_MODE=smtp` (Gmail App Password for now, B18) or `log` (printed, not sent;
  local only, because the console shows temporary passwords). `MAIL_MODE` has no default.
**Why:** D26 flow with the fewest moving parts; no driver can end up with an account but no email.

### D34 — 2026-10-08 — Deployment blocked; features first, hardening later; one chat per feature
- Railway deployment waits for access to the client's Railway account (B24). Until then everything is built and
  tested locally. Connecting the live website form (B22) needs a deployed API, so it waits too.
- Next feature: payment email parsing (spec M3/M4), starting with what needs no outside access: tables and
  parsing against saved sample emails. Gmail access, real samples and the LLM choice (B4-B8) are requested from Saad.
- Security hardening (rate limiting, `/docs` exposure, token storage, production secrets) is deferred until the
  features are done (B25). The Safety rules in `CLAUDE.md` still apply.
- Each feature gets its own chat; the docs carry the state between chats (`CLAUDE.md`, "Sessions").
**Why:** Saad and Abulkalam, 2026-10-08: show features to the client first; long chats lose detail.

### D35 — 2026-10-08 — Email intake: trust only our own server's DKIM result; mailbox is Mailcow (IMAP)
- The client's mail server (`mail.gonzocar.com`) is Mailcow, not Gmail. Reading the mailbox is therefore expected to
  be over IMAP, not Gmail OAuth (spec 5.1 / B6 to be revised once Saad confirms the mailbox and login).
- `verifyDkim` reads the `Authentication-Results` headers and uses only the topmost one whose first word is our own
  server's name. Headers written by anyone else, or copies lower down, are ignored. Passes only on `dkim=pass` with
  `header.d` exactly equal to the provider's domain (spec 5.1).
- `EXPECTED_DKIM_DOMAIN` (`square.com`, `venmo.com`, `chase.com`) are assumptions from the reference system, to be
  confirmed from real samples (B4). Mailcow adding this header is also unconfirmed (B5).
- `validateExtraction` never trusts LLM output: shape checked, provider must equal the DKIM-verified one, amount must
  literally appear in subject or body. `occurred_at` may be null (the email's `Date` header is the fallback; my
  choice, not in the spec).
**Why:** a forged email can carry a fake `Authentication-Results` header; an LLM can invent an amount or provider.

### D36 — 2026-10-09 — Read the four Mailcow pay mailboxes over IMAP, not Gmail (tentative)
- Each of `gonzopay@`, `payashwood@`, `payevergreen@`, `paysilver@` keeps a copy and redirects the original to
  `gonzobilling@gmail.com` (sieve `keep; redirect`). The old system reads that Gmail account.
- New system: IMAP to the four Mailcow mailboxes, one revocable Mailcow app password each (credentials in `.env`).
  `InboundEmail` gets a column for the mailbox it came from (my addition, not in the spec), which also tells which
  entity received the payment (B28).
- `verifyDkim` takes the trusted server name as a parameter, so it works for Mailcow (`mail.gonzocar.com`) or Gmail.
**Why:** the original message with our own server's DKIM verdict, no Gmail restricted-scope OAuth, and the mailbox
identifies the receiving entity. **Status:** confirmed for Zelle on 2026-10-09: a real Chase email in `payashwood@` read over IMAP has
`Authentication-Results: mail.gonzocar.com; dkim=pass header.d=chase.com ...; spf=pass; dmarc=pass`, and `verifyDkim`
returns VERIFIED for `zelle_chase` and rejects the other providers. Cash App and Venmo not yet seen.

### D37 — 2026-10-09 — `inbound_emails`: identity, immutability and database-enforced reasons
- A message is identified by `(mailbox, imap_uid_validity, imap_uid)` (unique), not by a Gmail id. UIDs restart when
  a mailbox's UIDVALIDITY changes, so the validity number is part of the key. `Message-ID` is stored for reference only.
- `received_at` is the IMAP internal date (when our server received it); the `Date` header is sender-controlled.
- Rows are insert-only: no `updated_at`, no update path. A seen message is skipped, never reprocessed.
- CHECK: `rejected_unverified` and `extraction_failed` require a `status_reason` (no silent failure, in the database).
  CHECK: mailbox lower-case, `imap_uid > 0`. UIDs are `bigint`, mapped to `number` by a column transformer.
- `payment_id` is not added yet; the migration that creates `payments` adds it with its foreign key.
- `provider` enum values come from `EXPECTED_DKIM_DOMAIN` plus `unknown`, so there is one list in code.
**Why:** spec rules 3 and 5 enforced by Postgres, and a record of what happened that nothing can rewrite.

### D38 — 2026-10-09 — Read `gonzobilling@gmail.com` over IMAP (supersedes D36)
- All payment email arrives in `gonzobilling@gmail.com`: Zelle through the Mailcow `keep; redirect` rule, Cash App
  through a forward from another Gmail account, Venmo directly (seen in real headers). The four Mailcow pay mailboxes
  hold only Zelle, so reading them alone would miss Cash App and Venmo.
- Source: IMAP `imap.gmail.com:993` on INBOX, read-only, with a Google app password (needs 2-Step Verification);
  credentials in `.env` (`IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`, `IMAP_TRUSTED_SERVER`). No Gmail OAuth.
- The only header we trust is the one written by `mx.google.com`. Gmail writes the signer as `header.i=@domain`,
  not `header.d=`, so `verifyDkim` reads either (real Cash App and Venmo headers verified). Expected signing domains
  confirmed: `square.com`, `venmo.com`, `chase.com`.
- `inbound_emails` (D37) is unchanged: `mailbox` is `gonzobilling@gmail.com`, uid and validity are Gmail's.
  Which pay address received a Zelle email is no longer a column; it stays in the stored headers if ever needed.
- Mailcow reading remains possible (change `IMAP_HOST`) and is used only for debugging.
**Why:** one complete source ("never miss a payment") with the fewest credentials and no restricted-scope OAuth.
**Risk (D38):** the Cash App forward runs through a personal Gmail; if it breaks, payments stop arriving with no error
(later: alert when a provider is silent for days).

### D39 — 2026-10-09 — Phase 1 covers all five providers; go-live date deferred
- Zelle (Chase), Cash App, Venmo, Stripe and Chime are all in scope (decision by Saad and Abulkalam, after the Gmail
  inbox showed Stripe and Chime in daily use). `CLIENT_SCOPE.md` named only the first three; it stays as the
  historical record and this entry wins.
- Stripe and Chime post in one stage like Cash App and Venmo (assumed, to confirm with Saad).
- Not payments, always `not_payment`: Stripe payouts, security and legal notices; Chime money requests, expired
  requests and transfers out; Venmo "You paid …"; Cash App "You sent …"; statements and promotions.
- `EmailProvider` and the `inbound_email_provider` database enum gain `stripe` and `chime`. Their signing domains are
  confirmed from real emails first, then added to `EXPECTED_DKIM_DOMAIN` with a migration.
- The go-live start point (B33) is deferred until the AI parser works end to end on real emails.
**Why:** payments arriving through unsupported channels would be silently missing from balances.

### D40 — 2026-10-10 — Intake trigger: scheduled UID poll behind one `syncNewMessages()`
- Triggers only say "look now"; `syncNewMessages()` is the only code that reads mail. First trigger: `@Cron` every
  3 minutes. Later, optional: IMAP IDLE (B35), a "Sync now" button, a sync right before each SMS reminder batch.
- Each run: connect, check UIDVALIDITY, search UIDs after the cursor from the allow-listed senders only, process
  oldest first, log out. Cursor = highest UID already recorded (first run: the go-live UID, B33).
- Guarded by a Postgres advisory lock (`pg_try_advisory_lock`) taken on one dedicated connection: a run that finds
  the lock taken exits at once, so overlapping ticks or two server instances never process the same mail.
- Never miss: a temporary failure (LLM or network down) records nothing and the same UID is retried next run; a
  permanent failure is recorded with its reason; an email that keeps failing temporarily is recorded as failed
  after a few attempts so it cannot block the queue.
- Never duplicate: the unique key in the database, not just the lock. Correction to D37: `(mailbox, uid_validity,
  uid)` does NOT catch a duplicate if Gmail ever changes UIDVALIDITY (the same email gets new keys). Dedup must
  use Gmail's permanent message id (`X-GM-MSGID`, imapflow `emailId`, to verify) instead; migration with the
  intake service. And the same payment notified by two different emails needs a payment-level key: the
  provider's transaction id (B37).
- Gmail API push (Pub/Sub) not used: OAuth with restricted-scope verification, a Cloud project and a public URL,
  and it still needs a scheduled job.
**Why:** about 20-40 payment emails a day; 3 minutes of delay is acceptable (Abulkalam, 2026-10-10) and polling
survives restarts, deploys and sleep with no extra state.

### D41 — 2026-10-10 — Provider APIs where they exist: Stripe confirmed, later
- Stripe will be integrated through its webhooks and compared with the Stripe email (confirmed by Saad and
  Abulkalam). Not now: after the email pipeline works. Details and prerequisites in B39.
- Any other provider is integrated the same way if it offers a usable API. Zelle is already covered by Plaid
  (spec 5.3). Cash App, Venmo and Chime personal accounts are not known to offer an API for incoming payments;
  check each when we get there, and keep the email path for whichever has none.
**Why:** a provider's own structured data is more reliable than reading its emails; the email stays as the source
that always exists.

### D42 — 2026-10-10 — DKIM: a list of exact domains per provider (Chime signs with two)
- `EXPECTED_DKIM_DOMAINS` gives each provider a list; a signature passes only if its domain equals one entry exactly.
- Checked on all 28 real samples: Zelle `chase.com`, Cash App `square.com`, Venmo `venmo.com`, Stripe `stripe.com`
  on every email type; Chime `account.chime.com` ("sent you money", via SendGrid) AND `chime.com` (requests,
  transfers out, via Amazon SES). Corrects the earlier "Chime signs only `account.chime.com`".
**Why:** with one domain, a genuine Chime email signed by `chime.com` was rejected as unverified; if it were a
payment, it would be missed. Look-alikes (`mail.chime.com`, `evilchime.com`) are still rejected.

### D43 — 2026-10-11 — Staging on Railway: manual CLI deploys into a separate project
- Client's Railway workspace `gonzomobility`, new project `car-rental-staging`: `Postgres` (private network only, no
  public URL), `backend` (`backend-production-1f569.up.railway.app`), `frontend`
  (`frontend-production-29af.up.railway.app`). The old system's project `cheerful-peace` is never touched.
- Deploys are manual from the local folder: `railway up --service backend` / `--service frontend` (no GitHub source
  yet). Commit before deploying so the running code is traceable.
- Backend service settings live in the dashboard because `railway.json` was not applied (B40): start
  `npm run start:prod`, pre-deploy `npm run migration:run:prod` (compiled migrations, every deploy), health check
  `/docs`. Node pinned with `engines: 24.x` in both repos.
- Variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `MAIL_MODE=smtp` (never `log` on a server, D33), a generated
  `JWT_SECRET` never printed; secrets typed in the dashboard only. Dashboard edits are staged until "Apply / Deploy".
- First admin seeded once through a temporary pre-deploy command, then `ADMIN_*` deleted. It is `admin@admin.com`:
  replace with a real address before real use.
- Frontend: Railpack serves the Vite build as a static site (Caddy), deep links work. `VITE_API_URL` is baked in at
  build time, so a backend URL change needs a frontend redeploy.
- Not on staging yet: email intake (no service), `IMAP_*` / `LLM_*` variables.
**Why:** Saad and Abulkalam, 2026-10-11: deploy manually first, automate later; the client's live system stays isolated.

### D44 — 2026-10-11 — Import drivers and applications from the old system's database (changes spec section 1)
- Phase 1 now includes importing data from the old system (the spec said "no data migration"). Source: the Postgres
  of the old Railway project `cheerful-peace`, read-only (Saad's explicit OK, 2026-10-11).
- Safety: every connection to the old database is forced read-only (`default_transaction_read_only=on`); our code
  never writes there. A dry-run report (counts, every conflict with our stricter constraints) comes before any
  import; nothing is dropped silently.
- Imported rows keep the old id, so the import can be re-run while the old system keeps running.
- Imported drivers get no login and no email (only our approval flow creates logins and sends welcome emails).
- Date of birth and address are copied too (Abulkalam, 2026-10-11). They are encrypted in the old database with the
  old system's key, so copying them needs that key and our own encryption at rest (design in the import plan).
- Billing fields wait for M2 and aliases for M1/M4; old aliases come in marked as legacy, for review (spec defect 1).
- Go slowly and with full control: one table at a time, each reviewed.
**Why:** payment matching needs the real drivers and their payment handles; the old database has them.

### D45 — 2026-10-11 — Driver import rules (`npm run legacy:import-drivers`)
- `drivers.legacy_id` (uuid, unique, null for drivers created here) = the old id; re-runs insert new and update
  changed drivers, never duplicate. Until cut-over the old system is the source of truth for imported drivers.
- Mapping: names trimmed; email trimmed and lower-cased; phone to `+1` with `toUsE164`; `terminated` → `inactive`,
  `active` and `paused` → `active` (paused is a billing state, M2); old `created_at` kept (read as UTC).
- Skipped, never guessed: invalid or missing email, non-US phone, email/phone shared by 2+ old drivers, email/phone
  already used by another driver in our system (a driver created here is never overwritten or merged).
- Script: dry run by default; `--apply` writes in one transaction; a remote target also needs `--target=staging`;
  no logins, no email; output has counts and old ids only.
- First run (local, 2026-10-11): 59 read, 54 imported (19 active, 35 inactive), 5 skipped and **left out on
  purpose** (Abulkalam): `e88d5624` (active, no email), `d9b5e265` (paused) + `5706ebb7` (terminated) sharing an
  email, `e192efc4` + `9ae7a39f` (terminated) sharing an email. Payments from the active and paused ones will not
  match until they are added by hand or fixed in the old system and re-imported.
**Why:** our rules (unique email = login, unique US phone) protect matching; 5 rows are not worth weakening them.


### D46 — 2026-10-12 — LLM: Gemini `gemini-3.5-flash-lite` on the FREE key, real emails included (settles B8)
- Payment emails go to Gemini as they are, payer names included, on the existing free API key. Approved by Saad and
  the client (2026-10-12). This replaces the 2026-10-10 rule "free key only with names replaced".
- Known trade-off, accepted: on the free tier Google may use submitted content to improve its products, and rate
  limits are lower. Moving to a paid key (about $1-2 a month at our volume) is a change of `LLM_API_KEY` only.
- OpenAI stays the fallback (the extractor sits behind `LlmJsonClient`).
**Why:** no cost and no billing setup now; the client accepts the data-use terms.

### D47 — 2026-10-12 — Email intake service and the `payments` table (M3)
- `syncNewMessages()` (D40): advisory lock; cursor = highest stored UID for the mailbox and UIDVALIDITY; first run
  only above `IMAP_START_AFTER_UID` (missing → stop with an error); UIDVALIDITY change → stop with an error.
- Dedup by Gmail's permanent id: `inbound_emails.gmail_message_id`, unique per mailbox (the D40 correction).
- A temporary failure (AI, network) stops the run at that email, never skipping it (the cursor would pass it). The
  same email failing 3 runs in a row is recorded `extraction_failed` with the error (count kept in memory).
- One transaction per email: the email row and its payment, or neither.
- `payments` created now with only extraction data, status `unmatched`; driver and match columns come with M4.
  Unique `(source, external_id)` and `(source, transaction_id)`. **Deviation from spec section 4:** no
  `inbound_emails.payment_id`; the link is `payments.external_id` (= the email row id), because `inbound_emails` rows
  are never updated (D37).
- `transaction_id` is kept only if it appears word for word in the email (4+ characters): an invented id must never
  merge two real payments. A second email with a stored transaction id → `duplicate_payment`, no second payment.
- `EMAIL_INTAKE_ENABLED` (default `false`) is the switch until the settings table exists (spec rule 6).
**Why:** never miss an email, never store one twice, enforced by the database where possible.

### D48 — 2026-10-12 — Payment → driver matching: unique identifiers exact, everything else AI (B51, B52, B53)
- **Exact, no AI, only on unique identifiers:** a `payment_aliases` entry of the payment's own method (type-filtered,
  defect 1), or the payer handle equal to a driver's own email or phone (both unique). Two different drivers found →
  no exact match.
- **Everything else goes to the AI, with full context** (Abulkalam, 2026-10-12): payment method, amount, payer name and
  handle; every driver's name, status, email, phone and aliases. Exact NAME equality is not a shortcut (a family
  member or another driver with a close name, e.g. "Abcd" vs "Abcde", would be credited wrongly at 100%); the prompt
  keeps confidence below 0.7 when another driver's name is close. The `name` match method value exists in the
  database from a short-lived version but is no longer used.
- **Thresholds:** AI ≥ 0.7 → assigned (Saad); below → "Needs review" with the suggestion. AI ≥ 0.9 → the payer name is
  also saved as an `ai_match` alias. Constants in `matching.service.ts` until the settings table exists.
- **Manual assign** (`POST /payments/:id/assign`) saves the payer name as a `manual` alias, but never takes an alias
  from another driver (reported back; B54 open).
- **Aliases:** many per driver, one driver per alias (`UNIQUE (type, value_normalized)`); types = payment methods +
  `email`/`phone`; 54 imported from the old system. Driver-added aliases need admin approval (Saad, B53; not built yet).
- **Statuses after matching** follow spec 6.3 / the accepted scope: Zelle → `reported` (bank confirms later, M5),
  others → `confirmed`. Not discussed in chat before building; one-stage for Cash App/Venmo/Stripe/Chime is still
  to confirm with Saad (B3, D39). No ledger yet: nothing is credited.
- Matching runs after every intake run; a rate limit stops it until the next run (B49), any other AI error sends that
  payment to review with the error.
**Why:** an alias, email or phone is a fact someone confirmed; a name is a coincidence until checked with context.

### D49 — 2026-10-13 — One-stage posting: every matched payment is confirmed (Saad; closes B3; changes D8/D39 and spec 6.3)
- Saad: keep it simple for now; all payments are confirmed from their email, change later if required. A matched
  payment (alias, AI or manual) goes straight to `confirmed`; unmatched ones stay `unmatched` ("Needs review").
- The Zelle two-stage design (reported → confirmed by the bank deposit, 72h discrepancy) from the accepted scope and
  spec 6.3 is deferred to the bank check (Plaid, M5). `reported` and `discrepancy` stay in the `payment_status`
  database enum, unused, so M5 needs no enum migration.
- The Payments page no longer shows a Status column (it would read "Confirmed" everywhere). Needs review vs assigned
  is shown in the Driver column and the filters.
- Reasoning recorded: a Zelle "you received money" email comes from Chase itself and passes the DKIM check, so it is
  already the bank's notice. What is given up for now: a net for cancelled/failed Zelle transfers and for forged
  emails that would pass DKIM.
**Why:** the two-stage state was never moved forward (no Plaid yet) and confused the team; Saad asked for the simple model.

### D50 — 2026-10-13 — Quo chat: conversation by phone, local copy of messages, files in our own bucket (changes spec 4 `SmsMessage`)
First Quo feature (chat 03): a chat on the application and driver pages to read and send texts, with the files a
contact texts in shown in a separate Files tab. Chosen by Abulkalam on 2026-10-13; simplest option first.
- **A conversation is a contact phone (E.164) on our one Quo number**, not a `driverId`. An applicant is not a driver
  yet, and the thread must survive approval. Application pages convert the raw phone with `toUsE164()`; driver pages
  use `drivers.phone`. Routes are scoped by application or driver id, so an admin cannot text a free-typed number.
- **Local copy, synced from Quo:** `sms_messages` and `sms_attachments`, filled by our own sends, the Quo webhook
  (`message.received/delivered/failed/undelivered`) and a catch-up sync when a chat opens (so texts sent from the Quo
  app appear too). Every Quo message id is UNIQUE, so a repeated webhook or re-sync inserts nothing twice; status only
  moves forward because delivery order is not guaranteed.
- **Quo facts used:** sending exists only on API v1 (`POST /v1/messages`, text only, no MMS out); history is
  `GET /v1/messages`; webhooks are signed HMAC-SHA256 over `webhook-id.webhook-timestamp.rawBody` (secret `whsec_…`),
  so NestJS needs `rawBody: true`.
- **`SMS_MODE` (`off | dry_run | live`) is an environment variable until the Settings table (M7).** It defaults to
  `dry_run`: the message is saved and shown as "Dry run: not sent", never sent. `off` refuses the send.
- **MMS files are copied into our own S3-compatible bucket** (MinIO locally, Railway Storage Bucket on staging; B45)
  and opened through short-lived signed links. Whether Quo's media links expire is unknown; B57.
- **Deferred:** STOP/opt-out handling (to the reminders milestone), the "more info" status, decision texts, upload
  link (B47), reminders (M6).
**Why:** Abulkalam is short on time and wants send/receive plus a files view first. Quo has no embeddable inbox
(B46), so we build the chat ourselves.

### D51 — 2026-10-14 — Quo chat uses the general line +1 312 736 2939; only known contacts are stored (extends D50)
- The workspace has 9 Quo numbers. The client (2026-10-14) uses **+1 312 736 2939** (`PNlq6NzLQ3`, "Sales / Customer Service"),
  the line advertised on the website and Google, and plans an AI agent on it for new inquiries and phone applications.
  The chat starts on this one line (suggested by Claude, accepted by Abulkalam). `QUO_PHONE_NUMBER_ID` stays a setting.
- **Only known contacts are stored.** The line is public (customers, spam). The webhook stores a text only when the
  sender's phone matches an application or a driver; anything else is logged and skipped. Opening a chat syncs the
  contact's earlier history from Quo, so a person who applies later loses nothing. The webhook is created for this one
  number only (`resourceIds`), so the other eight lines never reach us.
- **Open for later:** the AI agent and staff may reply in the same thread (the agent should stay quiet once a human
  has replied); rent reminders (M6) may move to Payments and Collections (+1 312 300 2032), which then needs the Quo
  number stored per message.
**Why:** one thread per person on the number applicants already know; no new number or registration.

### D52 — 2026-10-14 — Driver login is sent by text, not email (changes D26 and D33; closes B41 for approval)
- When an admin approves an application, the driver gets one text from the business number (+1 312 736 2939) with the
  login link, their email and a temporary password. It is sent through the same `SmsService.send` as every other text,
  so it shows in the application's chat (and later the driver's), follows `SMS_MODE`, and a failure comes back in plain
  words. Wording: `src/drivers/driver-welcome.text.ts`.
- **No email, no confirmation link.** The user is created with `emailVerifiedAt` set: receiving the text is the proof
  that the phone is theirs (Abulkalam, with the client: they mostly use SMS; Saad had agreed to drop confirmation, B41).
  They still must choose their own password at first login (`mustChangePassword`, D33).
- **By mode:** `live` sends; `dry_run` approves and saves the text as "Dry run: not sent" so the admin can read the
  credentials in the chat and pass them on; `off` refuses the approval. If the text fails, the whole approval is rolled
  back, as the email did (D26).
- Why not email: Railway blocks outbound SMTP on non-Pro plans, so no approval could complete on staging (B62).
- **Known trade-offs:** the temporary password sits in our `sms_messages` and in Quo's inbox, readable by anyone with
  access to either; it must be changed at first login. A one-time "set your password" link would avoid putting a
  password in a text (later, if wanted). `MailService` and `MAIL_*` settings are now unused; `POST /auth/verify-email`,
  the unverified-login check and the frontend `/driver/verify-email` page are dead code, to be removed later.
**Why:** simplest thing that works on staging and matches how the client communicates.

### D53 — 2026-10-14 — Text alert to staff for every new application (Abulkalam)
- When the website submits a NEW application (a repeat of the same `request_id` does not count), the system texts one
  staff phone, `APPLICATION_ALERT_PHONE` (+1 224 328 2246): the applicant's name and a link to
  `<WEB_APP_URL>/admin/applications/<id>`, nothing else (an SMS is not a safe place for more personal data).
- **Same rules as every text:** `SMS_MODE` decides (`live` sends, `dry_run` only saves it, `off` skips) and every attempt
  is a row in `sms_messages` (no `sent_by`, since the system sent it). `SmsService.sendAlert` never throws.
- **It never gets in the way of the submission:** the alert starts after the application is saved and is not waited
  for, so the website still gets its success answer if Quo is down (B22).
- **No custom limit** (Abulkalam). If Quo refuses (daily limit, credits, A2P), the plain reason is written on the
  application (`alert_error`; `alerted_at` when really sent) and shown on its page and as "Alert not sent" in the list.
- One number for now; a list and a Settings-page switch can come later (M7). The number is a Quo line ("Primary");
  whether it shows up on a person's phone depends on how that line is set up in Quo (to check on staging).
**Why:** staff must notice new applications without watching the admin; Quo is connected and email is blocked on staging (B62).

### D54 — 2026-10-14 — Applicants' uploaded documents are copied from the website into our own storage (settles B17, B45)
- The gonzocar.com form (Lovable Cloud, Supabase) keeps licence, rating and earnings uploads in a **private** bucket
  `driver-documents`; the application only stores their paths (`license_storage_path` ...). The website also has a
  "Driver document archive" page whose function can list, zip and **delete** old files "to free space", so the website's
  copy may disappear.
- **We copy each file into our own private bucket** (`applications/<applicationId>/<kind>-<id>.<ext>`) and record it in
  `application_documents` (one row per application and kind: pending / stored / failed, plain-language reason, 5 attempts).
  The copier (`ApplicationDocumentCopier`) runs every minute and right after a new application, and first records a
  row for every path that has none yet, so applications that arrived earlier are **backfilled automatically**.
- **How we read the website's bucket:** not with the archive token (it can delete) and not with a service key. The
  website got one small **read-only edge function** `get-driver-document` (Lovable, 2026-10-14): `POST {path}` with the
  header `x-documents-token` (its secret `DOCUMENTS_READ_TOKEN`), answers a 60-second signed link; it never lists, moves
  or deletes. Our settings: `DOCUMENTS_SOURCE_URL`, `DOCUMENTS_SOURCE_TOKEN` (same value as that secret). Without them
  documents stay "pending" and the page says the connection is not set up. A refused token stops the run without using
  attempts, so it recovers by itself once fixed.
- The admin Documents tab shows our copies (pictures, links valid about 10 minutes, "Copying…", or the reason a copy
  failed). Nothing is ever written to or deleted from the website's storage by us.
- The shared file bucket is now one provider (`FileStorageModule`, `FILE_STORAGE`), used by the chat files and these documents.
**Why:** the files are driver licences the admin must be able to see, and the website may clear its storage; we need our own copy.

### D55 — 2026-10-17 — Deleting applications is a hard delete; approved ones cannot be deleted (B66, Abulkalam)
- Client revision (B63): delete applications, one or many. **Hard delete** (Abulkalam: "we don't need them in future"):
  the row is removed for good, no undo, no restore. Its `application_documents` rows go by `ON DELETE CASCADE`; its
  copied files are removed from our bucket **after** the commit (a file that cannot be removed is logged with its reason
  and counted in the answer, `filesNotRemoved`; the delete still stands).
- **Approved applications cannot be deleted** (409, nothing deleted): they are where a driver came from. A driver who
  leaves is made inactive instead (B67).
- **Text history** (Claude's proposal, accepted with the plan): the chat of the application's phone is deleted too,
  **unless** another application or a driver has that phone (then the chat belongs to them as well).
- One route for one or many: `POST /applications/bulk-delete` `{ ids: [...] }` (1–100). POST, not DELETE, because a
  DELETE with a body is poorly supported. All or nothing in one transaction; rows are locked (`FOR UPDATE`, sorted by
  id) so nobody can approve one meanwhile. Unknown ids are ignored (deleting twice is not an error).
- **Known gaps:** no audit log yet (spec 4), so who deleted what is only in the server log. A website retry of the same
  `request_id` after a delete would store the application again (retries come within seconds; low risk).
**Why:** the client asked for delete; hard delete was chosen over archive; blocking approved keeps drivers traceable.

### D56 — 2026-10-17 — Driver statuses: onboarding, active, inactive; three onboarding steps (Abulkalam; B67, B68, B48)
- A driver is **`active` only when contract signed, deposit paid and has a vehicle** (Abulkalam, 2026-10-17). Statuses:
  `onboarding` (approved, steps missing; the default, so approval creates onboarding drivers), `active`, `inactive`.
- **Steps, not one status per combination:** `contract_signed_at`, `deposit_paid_at`, `vehicle_assigned_at`, each with
  the admin who ticked it (`…_by_id`). Any order. Ticked by hand by an admin for now (contracts and vehicles are not
  built; the deposit could tick itself once deposit rules exist, B19). "Has a vehicle" is a yes/no for now.
- **Automatic:** the third tick makes the driver `active`; un-ticking a step of an active driver puts them back in
  `onboarding` (confirm dialog). A CHECK (`drivers_active_is_onboarded`) makes `active` without the three dates
  impossible in the database.
- **Inactive (B67):** deactivate turns the driver's login off (`users.active = false`, same transaction): login refused
  and open sessions end at the next request. Steps are kept and locked (409) until reactivated; reactivate gives
  `active` or `onboarding` from the steps and turns the login back on. Onboarding drivers can log in.
- **Existing drivers:** the migration marked the drivers already active (imported) as onboarded at migration time with
  no admin ("done before this system"); inactive ones keep empty steps. The legacy import does the same for active
  drivers.
- **Effects to come:** billing (M2) and reminders (M6) act on `active` drivers only. Payment matching looks at every
  driver, so a deposit from an onboarding driver still matches them (answers part of B48).
**Why:** the client's rule for when a driver starts; three independent facts would need 8 statuses as one enum.

### D57 — 2026-10-17 — Internal notes on applications: a list, never edited, author-only delete (B74, Abulkalam)
- Client revision (B63): a place for staff notes on an applicant ("insufficient earnings, too far from the service
  area, poor driving history"). **Staff only:** never sent to the applicant, never in the driver portal.
- **A table of notes** (`application_notes`), not one text field: each note keeps its author and time, and two admins
  writing at once cannot overwrite each other. Body 1–2000 characters, not blank (DTO and a database CHECK).
- **Never edited; only the author may delete** a note (403 for anyone else). A wrong note is deleted and rewritten, so
  nobody can change or remove what another admin wrote.
- Author shown as their **email** (admin accounts have no name). Author account removed → `author_id` NULL, note kept
  ("Former admin"). **Deleting the application deletes its notes** (`ON DELETE CASCADE`, consistent with D55).
- Notes stay on the application after approval; not shown on the driver page yet.
**Why:** client request; a list with authors is the honest record of who decided what.

### D58 — 2026-10-17 — Editable approve / decline texts; approval sends two texts; decline asks (B71–B73, Abulkalam)
- **Templates in the database** (`message_templates`, key = primary key), edited by admins in **Settings → Message
  templates** (spec 4 `MessageTemplate`). Placeholders `{firstName}`, `{lastName}`; any other `{word}` is refused on
  save (a typo would be texted word for word). Body 1–1000 characters (DTO + CHECK). Last editor and time kept, no
  version history. Payment reminders (M6) will add their keys and placeholders to the same table.
- **Default wording is placeholder text by Claude** (inserted by the migration) for the client to edit on staging; the
  decline text contains "[add company names and phone numbers here]" so the other companies' numbers are not missed.
- **Approve (B71):** sends the "approved" template, then the login text (D52) as a **second, fixed** text: an edit can
  never break the credentials.
- **Decline (B72):** the Decline button opens a dialog with the filled-in decline text and "Decline and send text" /
  "Decline without text". API: `POST /applications/:id/reject` with optional `{ sendText }` (default false).
- Every text is sent inside the review transaction: a failure rolls the approval or decline back with the reason. A
  text already sent stays in the chat (it really went out). SMS_MODE applies (`dry_run` on staging).
**Why:** the client wants to word these texts themselves; the real wording and the other companies' numbers are not
known yet.

### D59 — 2026-10-17 — Staging deploys from `dev` through two deploy worktrees (Abulkalam)
- Until GitHub can deploy to Railway (repos on Saad's GitHub, Railway on the client's account), staging is deployed by
  hand from **`dev`**, not `main` (`main` still holds the initial commit). Exception recorded under "Branches" in the
  workspace `CLAUDE.md`.
- `deploy-backend/` and `deploy-frontend/` are git worktrees used **only** to deploy: each is moved to
  `origin/dev` (detached HEAD, `git checkout --detach origin/dev`) and `railway up --service <name>` runs there. Never
  from the main checkout or a `wt-*` worktree: `railway up` uploads the folder it runs in, uncommitted files included.
- Order: PRs into `dev` and merges backend first, then deploy backend, then frontend; record both commit hashes in
  `WORKLOG.md`. The full steps are the "Deployment" section of the workspace `CLAUDE.md`.
- Claude gives the commands; it runs push, PR, merge or `railway` only when the developer explicitly asks.
**Why:** several sessions now work in parallel (worktrees); deploying from a clean, pushed commit keeps half-finished
work off staging and never disturbs a working folder.

### D60 — 2026-10-17 — Driver ledger: scope and rules (B77; Abulkalam: "go with the recommendations")
- **Scope now (M1):** ledger entries, payment credits (incl. reassignment), manual charges/credits with a category,
  reversals, balance with running balance, weekly and monthly summaries; admin only. Rent billing (M2), driver portal
  view (B78), manual cash payments (B79) and the old ledger import (B80) come after.
- **One table `ledger_entries`**, append-only: a database trigger refuses `UPDATE` and `DELETE`. Corrections are
  reversals (`reversal_of_id` unique, so an entry can be reversed once; a reversal cannot be reversed).
- **Two dates:** `effective_date` (a calendar `date` in `America/Chicago`: what period the money belongs to) and
  `created_at` (when it was recorded). Summaries group by `effective_date`, so Chicago midnight and daylight saving
  cannot move an entry into the wrong week. Payment credit: the Chicago date of `occurred_at`. Reversal: the date it
  is made (past periods never change because of a correction).
- **Manual entries:** `effective_date` from today back to 90 days, never in the future; amount 1 cent to $10,000;
  reason required (1–500 chars). Fixed categories, a Postgres enum. Charges: `late_fee`, `repair` (e.g. flat tire),
  `damage`, `toll`, `ticket`, `cleaning`, `other_charge`. Credits: `discount`, `goodwill`, `other_credit`, plus
  `opening_balance` (either direction, at most once per driver). The direction comes from the category; the amount is
  always positive. Allowed for every driver status (a damage charge after a driver leaves).
- **Payment credits** are posted in the same transaction that makes a payment `confirmed` (matching or manual assign).
  Reassignment reverses the current credit and credits the new driver. Keys: first credit `payment:<paymentId>`,
  each later one `payment:<paymentId>:after:<reversedEntryId>`. Payment credits cannot be reversed from the ledger,
  only through the payment. Payments already `confirmed` are credited once by an idempotent backfill command.
- **Every retryable write has a unique `idempotency_key`:** manual entries take a key generated by the form (a
  double click creates one entry), reversals `reversal:<entryId>`.
- **Balance = credits − debits**, never stored. Shown as "Owes $X" / "In credit $X". Weeks are Monday–Sunday,
  months are calendar months, both in Chicago. Summary per period: opening, charges, payments, other credits,
  reversals, closing; empty periods included.
- **Deposits** stay out of the ledger until B19. A late fee counts in the balance; days late (M2/M6) will be measured
  from rent, never from the last debit (the old system's weekly rule was reset by any debit).
- No separate audit log: each manual entry and reversal stores who made it and why.
**Why:** spec 3–4 and D6; these are standard ledger practice (immutable journal, reversals, posting date vs record
date, idempotency keys) and avoid the edge cases listed for B77.

### D61 — 2026-10-17 — Manual ledger entries: no categories; charge or credit, amount, date, reason (Abulkalam)
- Replaces the categories of D60: a manual entry is **charge or credit**, an **amount**, the **date it belongs to** and a
  **reason** (free text, e.g. "Late fee, 3 days", "Flat tire, rear left"). No category enum, no opening-balance
  category (an opening balance is a charge or credit with that reason).
- The rest of D60 stands: append-only with database triggers, reversals, request key, today to 90 days back, $10,000
  per entry, payment credits, running balance, weekly/monthly summaries.
- Done before the branch was pushed: the ledger migration was regenerated without the category instead of adding a
  second migration (it had only run on local copies).
**Why:** Abulkalam: the type list adds a step without adding information the reason does not already give.

### D62 — 2026-10-19 — Message templates become a list: many per kind, edited when sending (B81; Abulkalam)
- `message_templates` now has `id` (primary key), `kind` (`application_approved` | `application_declined`) and
  `name`, unique per (kind, name). The old `key` column became `kind`; the one text each kind had is kept and named
  "Default" (so a text the client already edited on staging survives).
- Admins add, edit, rename and delete texts in Settings. The **last** text of a kind cannot be deleted (409), so there is
  always something to send.
- `POST /applications/:id/approve` and `/reject` take an optional `{ message }`: the text the admin picked and edited
  in the dialog. The API fills in `{firstName}` / `{lastName}` and refuses unknown placeholders (400). **Decline**
  without a message sends nothing (replaces `sendText`). **Approve** without a message sends the oldest approved text, so
  approval still always texts (D52). The login text stays fixed in code.
- Edits made in the dialog are for that applicant only; the saved template is not changed.
**Why:** the client asked for several decline texts and for editing before sending, and Abulkalam wanted both for
approved and declined. One table with a `kind` also suits the payment reminders (M6). A separate decline-only table
was planned first and dropped when approve needed the same.

### D63 — 2026-10-19 — Date range filter on the lists; days counted in Chicago time (B82; Abulkalam)
- `?from=YYYY-MM-DD&to=YYYY-MM-DD` (either optional, inclusive) on `GET /applications`, `/drivers`, `/payments`,
  `/inbound-emails`. Filters: applications and email log by received, drivers by created ("Since"), payments by paid.
  `from` after `to` or a day that does not exist is 400.
- A day is a **Chicago day**: from midnight in `America/Chicago` to the next midnight, worked out in SQL
  (`AT TIME ZONE`), so daylight saving is right and it matches the times shown on screen. UTC days would put an evening
  payment on the wrong day.
- The shared `TableCard` shows a range picker (TailAdmin's flatpickr calendar) next to Filter and an "applied filters"
  bar above the table (chips for search, filters and dates, each removable, plus Clear all). The view stays in the URL.
- No presets ("Last 7 days") for now; the driver ledger table has no date filter (it has its own period summary).
**Why:** client revision, batch 2. Chicago days because every time in the app is shown in Chicago (spec 3, rule 4).

### D64 — 2026-10-19 — Driver ledger page: references, filters, aging, credit against a charge, payments by hand (B86, B79; Abulkalam)
- **Page:** `/admin/drivers/:id/ledger`, opened from a "⋯" menu (View ledger, View driver) at the end of each row of the
  Drivers list, and from "Open full ledger" on the driver page. Built from the client's mockup (`gonzocar-ledger.html`),
  in our own TailAdmin look. The old ledger card on the driver page stays as a short view.
- **References:** each entry gets a short number from the database (`entry_no`, an identity column: never repeats, never
  changes). Shown as `CH-1042` (charge), `CR-…` (credit), `PM-…` (payment), `RV-…` (reversal); the search box finds them.
  The number is the entry; the letters are only for reading.
- **List:** `GET /drivers/:id/ledger` takes `type` (charges, credits, payments, reversals), `from`/`to` (the days the
  entries belong to), `search`, `order`. The running balance is worked out over the whole history *before* filtering, so a
  filter never changes a row's balance. The response has totals of the filtered entries and the balance before `from`
  (the opening balance of a statement).
- **Aging** (`GET /drivers/:id/ledger/overview`): what is owed by how old the charges are (0–6, 7–13, 14–29, 30+ days),
  **first in, first out**: all credits form one pool that pays the oldest charges first, by the day each charge belongs
  to (`effective_date`). A reversed entry and its reversal are left out (together they are zero). The four buckets add up
  to what the driver owes; a driver who paid ahead shows none.
- **Credit against a charge** (`appliesToId` on a manual credit): links a credit to the charge it reduces (a waived late
  fee). The charge is locked while the credit is checked, so two admins can never credit more than the charge was; the
  amount is at most what is left. A charge that still has credits cannot be reversed until they are (409), or the driver
  would get the charge back and keep the credit.
- **Payments by hand** (`POST /payments/manual`, B79): a `manual` payment, confirmed at once, credited in the same
  transaction, so it shows on the Payments page. All methods are allowed (cash, check, card, money order, Zelle, Cash
  App, Venmo, Stripe, Chime, other; `payments.manual_method`). A reference is unique among manual payments. A payment
  of the same amount on the driver within three Chicago days is a warning (409 `possible_duplicate`) the admin can
  confirm ("Record anyway"), because Zelle, Cash App and Venmo payments normally arrive by email and are credited by
  themselves. **Void** (`POST /payments/:id/void`): the payment becomes `rejected` and its credit is reversed (a reversal
  entry with the reason); only for manual payments (email payments are reassigned on the Payments page).
- **Statement:** a printable page `/admin/drivers/:id/ledger/statement` (period in the URL, 90 days by default).
- **Left out on purpose (not in the mockup's scope for now):** the AI agent, "Acting as", the Approvals queue and its
  $50 limit (no ledger agent exists); Fleet Balances (belongs to the dashboard, M7); texting the driver about an entry
  (M6); market, vehicle, plate and deposit (not in our data); editable internal notes (entries never change); an
  automatic $25 late fee (spec section 12: no late-fee logic in Phase 1); item presets with default amounts (D61: reason
  only; the form has reason chips that only type text). The billing parts (rate, Pause billing, Run weekly billing, rent
  rows, day credit by rate) come with M2 (B88).
**Why:** the client wants the ledger to work like an account register with a driver's aging at the top. The database
keeps the numbers, the order and the limits (identity, unique keys, CHECKs, the row lock); the screen only shows them.
Allowing every payment method was Abulkalam's choice; the warning and the three-day check are the guard against a double
credit, which is only caught when the manual payment is recorded **after** the email one (B87).

### D65 — 2026-10-19 — "New ledger entry" follows the client's mockup: one window, three tabs, description and internal note (B86; Abulkalam)
- Abulkalam compared our dialogs with the client's mockup and decided to **follow the client's layout and fields**, in our
  TailAdmin look, and to **deviate from D61 where the client's fields need it**. No side drawer: the entry details stay a
  centred window.
- **One window** with three tabs (+ Charge, + Credit, + Payment), opened by the three buttons or the driver page's "Add
  entry". Fields in the mockup's order: reason chips (charge, credit) or **Method** chips (payment); amount (a payment starts at
  what the driver owes); the date; **Description** (shows on the driver statement); **Reference / confirmation #** (payment);
  **Internal note** (staff only); footer "Balance X → Y" and "Post charge / Post credit / Record payment". Method order is
  the client's (Stripe, Zelle, Cash App, Cash, Card (in office), Check) plus Other for anything unusual (Venmo, Chime and
  Money order are not offered; the API still accepts them); the default stays Cash, because the email methods trigger the
  duplicate warning.
- **Description:** for a charge or credit it is the old `reason` (API name kept). For a payment it is optional; empty keeps the
  automatic text. Stored on `payments.description`, used for the ledger credit.
- **Internal note:** `ledger_entries.internal_note` and, for payments recorded by hand, `payments.internal_note` (copied to the
  credit). **Written once, with the entry, never changed** (the ledger stays append-only). Up to 500 characters, not blank
  (database CHECKs). Shown in the entry details and as ✎ in the table, found by the search box, **never on the statement**.
- The footer's "Balance X → Y" adds or subtracts whole cents on the screen for display only (a small exception to "no
  money maths in the UI"); the server decides the real balance.
- **Still left out:** "Text the driver a notice" (needs M6), item presets with default amounts, an automatic late fee.
**Why:** the client's mockup is what they expect to see; the database keeps the limits and the order, the screen only shows
them.

### D66 — 2026-10-19 — Charge and credit presets, configurable in Settings (B86; Abulkalam)
- The client's mockup has preset cards (name and default amount) in the "New ledger entry" window. Abulkalam decided to follow
  it and to make the list **configurable by admins in Settings**. This brings back default amounts, which D61 had removed;
  D61's other rule stays: **no stored category**. A preset only fills in the description and the amount while an entry is
  being made; nothing about it is stored on the entry, so editing or deleting a preset never changes an old entry.
- Table `ledger_presets`: `kind` (charge or credit), `name` (unique per kind), optional `amount_cents` (1 to $10,000, the
  manual-entry cap), `description` (what the Description box is filled with), `position`. Routes `/ledger-presets` (list, add,
  edit, delete, `PUT /order` for the arrows). Settings has a "Ledger presets" card (Charges and Credits) like the message
  templates. No "keep one" rule: with none, the window shows no cards.
- **Starting list** (migration): the client's, from their mockup, plus "Opening balance" (B80). **Not seeded:** "Weekly rent" and
  "Day credit - vehicle down", which need the driver's rate; they come with rent billing (M2, B88).
- Payment methods are **not** configurable: the form offers the client's six plus Other (D65).
**Why:** the client expects the mockup's cards, and the list will change over time (new fee types); admins can now do that
without a code change.

### D67 — 2026-10-19 — One ledger: the page only, no Weekly / Monthly tabs; the search finds amounts (B86; Saad, Abulkalam)
- **Context:** after the ledger page shipped, Saad asked that the small ledger on the driver's detail page be removed ("only one
  detailed ledger"), and Abulkalam that the Weekly and Monthly tabs are not required. Saad also asked that the search can
  find an amount and show the entries of exactly that amount.
- **Decision:** the driver detail page no longer has a ledger card; it has a "View ledger" button next to Deactivate. The ledger
  page has only the register (no Weekly / Monthly tabs). This supersedes the card and the weekly / monthly summaries of D58.
  The backend route `GET /drivers/:id/ledger/summary` stays (unused by the UI for now); the UI code for it was deleted.
- The ledger search (`?search=`) also matches an amount: `85`, `85.5`, `$85.00` and `1,250` find the entries whose amount is
  **exactly** that (in cents, integer maths), in addition to the existing text matches. Not "contains": `85` does not find $850.
**Why:** one place for the ledger avoids two screens that must be kept in step; the weekly and monthly views were not asked for
by the client's mockup flow in use.
### D68 — 2026-10-19 — An admin adds a driver by typing in an application; documents can be uploaded (B85; Abulkalam)
- **No separate "create driver" path.** The admin adds an **application** (`POST /applications/manual`, admin only; the
  public `POST /applications` stays for the website) and approves it from its page like any other. Approval already
  makes the login, sends both texts and follows `SMS_MODE` (D52, D56), so a hand-added driver gets all of that, plus the
  chat, notes and onboarding steps, with no second code path.
- **Same form as gonzocar.com, one page (no steps), in its three sections** (Basic info, About you, Final verification),
  with inline errors under each field (shown once the field is visited; Save marks the rest). Same questions and rules,
  confirmed on 2026-10-20 by walking through the live 3-step form (stopped before Submit) and on 8 real staging
  applications: phone, ZIP, age 25 or older, years driving, other companies (optional); first and last name, email,
  street and number, apt (optional), city, start date, at least one platform; violations and accidents (0, 1, 2, 3+),
  lease length, first week + deposit (yes/no; **only when No, "how much do you have to get started" is asked and
  required**), insurance now and in the last 45 days, referred by, driver rating and its screenshot (optional),
  licence photo required, weekly earnings and earnings documents (optional). **No vehicle preference**: on the website
  it is a hidden value filled by the "I want this one" buttons, not a question, so the admin form does not ask it
  (the field is accepted on website applications only). Stored in the website's own shape (payload keys and values, e.g. lease length as
  `corto` / `mediano` / `largo`, `platforms` as a list) plus `source: "admin"`, so every screen shows both alike.
  Choices are in `src/applications/manual/website-form.ts` and the frontend's `websiteForm.ts` (keep them equal).
- **`applications.created_by_id`** (nullable FK to `users`, `SET NULL`): which admin added it; null = from the website.
  The page shows "Added by <email>".
- **The alert text to the staff phone (D53) is sent** for hand-added applications too (Abulkalam).
- **Idempotent:** the form makes the `request_id` once; the same id twice stores nothing new (`created: false`).
- **Documents:** three slots as on the website (licence, rating, earnings), one file each, JPG / PNG / PDF, at most
  10 MB, **checked by the file's first bytes**, not by its name or the type the browser says. Stored in the same bucket
  and table as the website copies (`application_documents`): new `origin` (`website` | `admin`), `source_path` may be
  null for an admin file, `uploaded_by_id`; a CHECK ties them together. `PUT /applications/:id/documents/:kind` fills
  or **replaces** a slot, a website copy included (the old object is removed after the row points at the new one).
  The `*_storage_path` columns stay null on a hand-added application so the copier never looks at it.
- **The copier never overwrites an admin upload:** its two updates apply only while the row is still the pending
  website copy; if an admin replaced the slot during a slow copy, the copier removes its own file.
- File fields end in `_file` (`license_file`...) because `earnings` is already a text field (weekly earnings).
- Files are not covered by a database transaction: check, then store, then insert; if the insert fails the files are
  removed again (a failed removal is logged as an error).
- **Not done here:** aliases on the driver page (part 2, B52); several earnings files (B89).
**Why:** keeps one way to create a driver (approval), so nothing about drivers' logins, texts or onboarding is written
twice; the client's revision was about being able to add drivers who did not use the website.

### D69 — 2026-10-20 — An admin adds and removes payment aliases on the driver page (B52, part 2 of B85; Abulkalam)
- `POST /drivers/:id/aliases` ({ type, value }) and `DELETE /drivers/:id/aliases/:aliasId`, admin only. Types are the
  seven we have: Zelle, Cash App, Venmo, Chime, Stripe, Email, Phone. Saved with `source = manual`.
- **Same normalisation as matching** (`normalizeAliasValue`): lower-case, spaces collapsed, `$` / `@` dropped for Cash App
  and Venmo, phones as `+1XXXXXXXXXX`. Phone and email values must look like a US phone / an email.
- **One alias, one driver** (D48): an alias another driver already has is refused with `409` naming that driver; the
  same driver adding it twice is also `409`. Nothing is taken from another driver: moving one is B54, still open. The
  database's `UNIQUE (type, value_normalized)` decides when two admins add it at the same instant.
- **Remove works on any alias**, imported, AI-learned or manual: it is the fix for a wrong alias. Payments already matched
  through it stay as they are; later payments from that payer are matched without it. Asked first (confirm dialog).
- **Not included:** payments already in "Needs review" are not matched again after an alias is added (matching tries each
  payment once; the admin assigns them, which also saves the alias); driver-added aliases with approval (B53) wait for the
  driver portal.
- No audit-log table exists yet, so who added or removed what is written to the server log.
**Why:** the client wants every name or handle a driver pays from recorded (B52), and a wrong alias must be fixable.

### D70 — 2026-10-20 — Module 2 signing provider: firma.dev (client, via Saad; Abulkalam)
- **Context:** contracts are signed through PandaDoc today. Compared 2026-10-19/20: DocuSeal ($20/month + $0.20 per contract
  through the API), PandaDoc (contracts made by hand are covered by the seat plan, but contracts our system creates need paid
  usage credits or the $40/month API plan for 40 a month; webhooks only on Business), signNow (API is a separate paid plan),
  firma.dev (about €0.049 per envelope, no monthly fee, API, templates and webhooks included, free test mode).
- **Decision:** firma.dev (the client: "Let's go with this one"). One envelope = one contract, however many signers.
- **Risks accepted:** a very young company (founded 2026, small team); data hosted in the EU (AWS Paris); compliance
  (ESIGN, UETA, SOC 2) is the vendor's own claim.
- **Checked in firma's docs (2026-10-20):**
  - **Prefilling works:** each field takes a locked `read_only_value`.
  - **Anchor tags:** firma finds marker text such as `{{LESSEE_NAME}}` in an uploaded PDF and puts a field there, so the
    client's Google Doc exported as PDF with markers is the template. Use PDF, not DOCX: DOCX is re-laid-out and loses images.
  - **Organization seal:** an automatic company countersignature, free on all plans (one credit per send covers it).
  - **Webhooks:** HMAC-SHA256 header `X-Firma-Signature: t=<unix>,v1=<hex>` over `<t>.<raw body>`, 5-second reply limit.
    Only **3 attempts** (now, +5 min, +1 h), so step 4 also needs a scheduled status check for missed events.
  - **Other:** reminders and expiry can be set per request; the signed PDF and certificate come through the API; test keys
    are free and watermark every document.
- **How we limit the risk:** firma sits behind one service interface (like Quo and the LLM), so a switch to DocuSeal is a
  contained change; every signed PDF and audit trail is copied into our own storage (step 4), so no record depends on firma.
**Why:** cheapest per contract with no subscription, and the API covers templates, signing and webhooks.

### D71 — 2026-10-20 — Contract rate calculation follows the client's Illinois rate sheet (Module 2 step 1; Saad)
- The admin types only the **total rate** (weekly or daily). Five lines are calculated from it as the sheet does: base 42%,
  insurance 30%, unlimited miles 13%, maintenance 10%, taxes 5%. Cents are integers: insurance, miles, maintenance and taxes
  are rounded half up from the percentage; **base takes the remainder**, so the five lines always add up to the total
  (our rule; the sheet only ever had whole-cent results).
- **Our reading, to confirm (B91 question 2):** the weekly or daily payment equals the total rate; one-time total = the sum of
  the one-time charges; amount due at pickup = first payment + one-time total; end date = start date + term months (default
  18, clamped to the month's last day: 2026-08-31 + 6 = 2027-02-28); the recurring Total row = payment + excess mileage + insurance excess + other recurring (the sheet's Total row). The received sheet types these by hand and they disagree with its own total, so we calculate them.
- The percentages apply to Illinois. California and Tennessee wait for the client (B91 question 3).
**Why:** one typed number drives everything, as the client asked ("an applet ... others driven by formulas as a % of the
total rate"), and calculated totals cannot drift like the hand-typed ones in the samples.

### D72 — 2026-10-21 — The company signature is the entity name, preprinted on each contract; client confirms firma.dev (Module 2; client, via Saad)
- **Client wording:** "The signature will be the name of the entity, not the person. So the signature will say Evergreen Holdings LLC or
  Gonzo, or Silver Pine, etc and it will bear the signature first. In fact, it can be preprinted on each contract." She also said
  she likes firma.dev (its "nearly free electronic signature API" article), which confirms D70.
- **Decision:** nobody at the company signs each contract and there is no company signer in the envelope: the driver is the only
  signer. The company signature is the entity name, which comes from the company chosen on the draft (step 2), printed before the
  driver signs. This answers B91 question 1.
- **Our reading, to check in step 3 (simplest option first):** a locked text field in the signing PDF, filled with the chosen
  entity name in a script-style font, in the Lessor's signature block (the PDF template marker approach of D70). firma's
  automatic organization seal stays a fallback if the text field looks wrong.
**Why:** removes the countersigning step and the wait for a second signer, so a contract is complete the moment the driver signs.

### D73 — 2026-10-21 — Contract details: a fixed company list, the rest typed on the draft with no rules (Module 2 step 2; Abulkalam, from planning chat 07)
- **Company:** table `contract_companies` (`name`, `address`; no state column, no active flag), seeded by the migration with the five
  "Lessor:" lines of the sample contracts, names as the spec has them. Unique on name + address because Gonzo Enterprises Inc has two
  addresses. The name is printed as the company's signature (D72). No screen to change the list yet (B93).
- **Vehicle, purchase option, driver details:** typed on the draft: vehicle model, VIN, plate, plate state; purchase option price (cents);
  the driver's address (one line), licence number, licence state, date of birth. The driver record and the website form do not hold the
  licence number, licence state or date of birth, so nothing changes there; the driver's name, email and phone are read from the driver
  when the contract is sent (step 3).
- **No rules the client did not ask for:** every new column is optional; text is trimmed and an empty box is stored as nothing; the only
  checks are the database's own (a length limit per column, the date of birth a real day, the purchase option a whole non-negative number
  of cents the column can hold, the company one of the list). No VIN, plate or state format, no list of states, no price cap, no age rule,
  no address prefill from the application. Completeness is checked when sending (step 3).
- **Personal data:** licence number and date of birth are in the single-draft response only (the admin edits them there), never in a list
  response and never in a log line; a test checks the drivers list and the driver page. They are stored as plain text for now;
  **encryption is planned (B94)** and comes before real driver data is typed into a contract. Demos use made-up values.
- **Step 1's checks stay** (the $10,000 caps, 1 to 60 months, one draft per driver): already deployed, removing them needs a migration for
  no gain. `MODULE2_SPEC.md` section 4 lists them as "our suggestion".
**Why:** the client asked for the values on the contract, not for rules about them; fewer rules means nothing to explain or defend in the
demo, and the data we hold about drivers' identity stays as small and as quiet as possible.

### D74 — 2026-10-21 — Sending a contract for signing: PDF with anchors uploaded per send, plain locked values, one lock, Illinois only (Module 2 step 3; Abulkalam, planning chat 07)
- **Spike passed (2026-10-21, firma test key, our own email):** the template PDF uploaded with anchor tags puts a locked text field on each marker, readable and not overlapping neighbours, and the driver's signature box works. Then a real send from the page, a signature and Finish: firma showed the request `finished`.
- **How it works:** `POST /contracts/:id/send` uploads `src/contracts/templates/illinois-lease.pdf` (base64) to firma's `create-and-send` with one recipient (the driver, `designation: Signer`, `id: temp_1` which the anchors name) and one anchor per marker (`contract-template.ts`, `contract-values.ts`). The firma id and a frozen copy of every value (`sent_values`, with the template name and recipient) are saved on the contract. The key's own kind (test or live) decides the mode: `FIRMA_API_KEY` unset means 503 "Signing is not set up".
- **What firma's docs did not say, found by trying (each is handled in code):**
  - A marker printed twice **on the same page** cannot be told apart ("selective occurrence among same-page duplicates is not supported"), so `COMPANY_NAME` (heading, Lessor line, signature block) and `START_DATE` (effective date, lease term) share one box each, sized for the tightest place.
  - `remove_anchor_text` leaves the tails of the braces and the underscores showing under a field; with `add_white_background: true` and a field at least as wide as its marker and a little taller, nothing is left. A value therefore sits centred in the marker's width, so a short value leaves a gap on both sides (the PDF text does not reflow).
  - On the Email / Phone line firma puts the fields about 1.6% right of the marker; the table of placements takes that back off (measured).
  - Font: only `font_size` reaches an anchored field. A value longer than its marker shrinks (to 8 pt at least); beyond that firma cuts it with "..." (an email over about 28 characters).
  - A text field's grey box and the centred text are firma's look; a signature box needs a negative `y_offset` to sit above the "Lessee" label.
- **Left as it is (cosmetic):** a few small marks stay beside the repeated markers (", ," after the effective date and the Lessor name; the tips of the heading's braces). Distinct markers in the Google Doc would remove them (B95).
- **The sample driver's licence photo** was on the last page of the PDF we were given (a real person's licence, number, date of birth and address, as an image). It was removed from the template with the image object deleted (checked: no image data left, no personal text) before the file was stored; the heading "Driver License:" stays with nothing under it. The original PDF and DOCX stay outside both repos. One test request with the photo reached firma's test account before this was noticed.
- **One envelope per contract:** the send runs in one transaction with `SELECT ... FOR UPDATE` on the contract, so two clicks make one request (the second waits, then finds it sent: 409), and a unique index on the firma id backs it. If firma refuses, nothing is saved, the contract stays a draft and the admin sees firma's own message (502). If firma may have received the request but we got no answer (timeout), the message says so and to check firma's dashboard before sending again. If saving fails after firma accepted, the log names the firma id.
- **Frozen:** a `sent` contract refuses edit and delete (404 "Draft not found", as for any non-draft); the page shows it read-only with "Sent on ... to ...". `GET /drivers/:driverId/contract` replaces `contract-draft`: the open draft, else the contract sent last.
- **Illinois only:** `contract_companies.state` (IL for four rows, CA for the Ukiah row); another state is refused with 409 until its template exists.
- **Privacy:** the frozen copy holds the licence number and date of birth as plain text (B94); never in a list or a log (logs carry only contract id, firma id, admin id).
**Why:** firma's own templates cannot take anchors, and the client's Google Doc is the template (D70); the lock and the unique index make a double send impossible; the plain signature is the simplest thing that works (D72 said to check).

### D75 — 2026-10-21 — Tracking a sent contract and filing the signed copy: firma is asked, webhooks only trigger (Module 2 step 4; Abulkalam, planning chat 07)
- **One function decides the status:** `ContractTrackingService.refreshFromFirma(contractId)` asks firma for the signing request (the authority) and applies the answer. The webhook (`POST /webhooks/firma`) and a job every 5 minutes only trigger it. A repeated, late, replayed or lost webhook is therefore harmless and there is no event table. firma delivers an event only 3 times (now, +5 minutes, +1 hour), so the job is required, not optional.
- **Spike findings (2026-10-21, firma test key; these corrected the plan):**
  - `GET /signing-requests/:id` gives `status` as **flags** (`sent`, `finished`, `cancelled`, `declined`, `expired`), not a word, and `sent` stays true after every later state. We resolve them by priority: finished, declined, cancelled, expired, else sent. Times: `timestamps.finished_on`, `declined_on`, `cancelled_on` (no `expired_on`: `expires_at`, else the last change). The list endpoint has another shape (`in_progress`, `*_date`): never used.
  - **"Viewed" is visible by polling:** `GET /signing-requests/:id/audit` has signer events; the first `document_viewed` appears seconds after the driver opens the signing page (before they accept the terms). It costs one extra call and is made only while the contract is `sent`.
  - **Files:** about 20 seconds after the signing `certificate.generated` turns true and the links fill; before that they are null ("not ready", not an error). The links are pre-signed, work for an hour and need **no** `Authorization` header (the key is never sent to them); every GET mints new ones, so they are never stored. `final_document` is 7 pages (the 6-page contract plus firma's certificate page, 2.4 MB), `certificate_only` 1 page.
  - **Declined:** `status.declined`, `timestamps.declined_on`, the user's `decline_reason`. **Cancelled:** `POST /signing-requests/:id/cancel` (`reason`, `notify_signers`) gives `status.cancelled`, `cancelled_on`. **Expired:** checked after the build with a request sent with a 1-hour expiry (a sent request cannot be edited, so it cannot be forced): within a minute of `expires_at` (sent time + 1 hour) firma showed `status.expired: true`, with no `expired_on`, so the time we keep is `expires_at`.
- **Statuses:** `contract_status` gains `viewed`, `signed`, `declined`, `expired`, `cancelled` (migration `AddContractTracking`; no CHECK uses a new value in the same migration). `nextContractStatus` (pure, unit tested): a contract only moves forward (sent, viewed, then an end state); **an end state never changes** (a signed contract never turns expired or cancelled); `viewed` never replaces an end state. firma `finished` means `signed` (the driver is the only signer, D72). `status_updated_at` and `signed_at` are firma's own times, not ours.
- **Auto-tick of "Contract signed" (D56):** in the same transaction as the status change, `DriversService.recordContractSigned` locks the driver and, only if the step is empty, sets the date to the signing time with **no admin** (the system). An admin's earlier tick keeps its date and admin. The status follows D56 (`active` only when all three steps are done), **except for an inactive driver**: they get the date and stay inactive (reactivating works the status out). An admin may un-tick later; that does not touch the contract and is never re-applied (an end state is not looked at again).
- **Webhook:** `@Public()`, verified with `X-Firma-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 of `<t>.<raw body>` with `FIRMA_WEBHOOK_SECRET` used as written; `X-Firma-Signature-Old` is accepted too (rotation). **No timestamp tolerance** (firma's example makes it optional): its docs do not say whether a retry after 5 minutes or 1 hour is signed again, and a tolerance could refuse the very retries the schedule exists for; replay is harmless because the body is never believed. Events whose type does not start with `signing_request.`, or whose request is not ours, answer 200 "ignored"; a failed look-up answers 500 so firma retries; no secret set answers 503; a bad signature 401 before the body is parsed. The look-up has a 3-second limit per call (firma wants an answer within 5).
- **Filing the files:** a separate job step (advisory lock key `7_302_003`) for signed contracts with no files yet: it asks firma for fresh links, downloads both, checks they start with `%PDF-`, puts them in the private bucket as `contracts/<id>/signed.pdf` (firma's final document) and `certificate.pdf` (certificate alone), then saves both keys together (CHECK `contracts_documents_shape`). A failure is saved in `documents_error`, shown on the contract page, logged, and retried; with no bucket nothing is done. `GET /contracts/:id/documents` mints 10-minute links per request (admin only, like application documents); the contract itself shows only `documentsSaved` and `documentsError`, never keys.
- **Privacy:** logs carry only the contract id, the firma id and the status, never the webhook body, the key or the values. The signed PDF holds the licence number and date of birth (B94): private bucket, short-lived links.
**Why:** asking firma instead of trusting events makes every duplicate or forged delivery harmless; a monotonic status means a late event can never undo a signature; doing the tick in the same transaction means a signed contract and its driver step cannot disagree.

### D76 — 2026-10-24 — The lease PDFs: one per state, boxes that cover whole markers, amounts aligned by padding, the driver's licence drawn in (Module 2 fixes and the California contract; Abulkalam)
- **What firma really does (measured 2026-10-24 with the test key, signed PDFs read with pymupdf):** it **never removes** a marker's text on our PDFs (its answer says "not removed", the PDF fonts are CID encoded, with the original file too): the field's white background is the only thing that hides the marker. Everything outside the box shows. That was the cause of the marks in the first signed contract: ", ," and ". ." were the uncovered parts of markers printed twice on a page (`COMPANY_NAME` x3, `START_DATE` x2, and `TOTAL_RATE` x2, which D74 had missed), and the brace tails below the signature and date boxes. firma also **left-aligns** text inside a field (the text starts about 0.32% of the page, 2 pt, inside it; D74 assumed centred), **keeps leading spaces and non-breaking spaces**, and **shrinks the font** when the text is wider than the field (seen: 6 pt). Its font is Noto Sans: digits and `$` are 0.572 em wide (all the same), `.` `,` `:` 0.268, space 0.26, `-` 0.322, `/` 0.372.
- **Templates (the contract wording is unchanged):** each marker is now printed once per page: `COMPANY_HEAD`, `COMPANY_LSOR`, `COMPANY_SIGN`, `EFFECTIVE_DATE`, `TERM_START`, `PAYMENT_AMT`; the long names that made lines wrap are shorter (`DL_NUMBER`, `DL_ST`, `DOB_DATE`, `PLATE_NO`, `PLATE_ST`, `TM`, `TERM_START`, `TERM_END`, `AMOUNT_DUE`); one line break before "Plate:" because model, VIN, plate and state do not fit on one line (the "|" there was only a separator). The edited Word copies are in `contract-template-work/` (outside both repos) and were exported to PDF by Google Docs, as the first template was; the sample driver's licence picture is replaced by one white pixel, which keeps its box: that box is the licence slot. The value names (`VALUE_KEYS`, stored in `sent_values`) did not change: a placement says which marker shows which value, so several markers can show the same one.
- **Alignment:** an amount is right-aligned on one line (`moneyRightPct`): the field starts on or before its marker (so it covers it), the value is padded on the left with non-breaking spaces from the real glyph widths, and the field's own start takes the remainder, so the decimals line up to the hundredth of a point (checked: every value lands within 0.01% of where it was asked, except two cells off by 0.1 to 0.4%). Layouts: `inline`, `money`, `right` (a number right before a word, "18 months"; its box must not pass its marker or it hides the word's first letter), `center` (a label). An end-of-line marker covers 0.6% more on its right (the last brace reaches past its box); a marker with text right after it must stop at the marker. The email and phone line of the Illinois template sits 1.55% and 1.64% right of where it is asked (as in D74); California has no such shift.
- **Per state (`TEMPLATES`, `templateFor(company.state)`):** Illinois and California; a state with no template answers 409 "There is no contract for <state> yet." (replaces "Only the Illinois contract is built yet."). The measured tables are `src/contracts/templates/*-placements.ts`; `template-kit.ts` holds the types and helpers. If a PDF changes, measure again (pymupdf), then send one test request: firma refuses a send whose marker is missing, so a mismatch cannot reach a driver.
- **California:** built from the client's California sample (Google Doc "Gonzo Enterprises Inc:CA Contract Template") the same way: its 38 values became markers by a script that prints counts only, the sample's signature picture and licence photo were removed, and a check found no real value left in the file; the California text stays as the client wrote it (arbitration, tolls, fees, "Manager, ..." in the signature block; a stray "4" in the table's first cell and a card "Information" heading are the sample's own). Page 1 has the same layout as Illinois plus an "Address:" label and "Email :" / "~". **D71 follow-up:** the California disclosure table was checked line by line against D71: base, insurance, miles, maintenance and taxes are exactly 42 / 30 / 13 / 10 / 5 % of the total and amount due is total + deposit, so the split and the reading are the same and `contract-math.ts` did not change. The sample's one-time "Total" row repeats the amount due (a typing quirk, as in the Illinois sample).
- **The driver's licence:** firma has no read-only picture field (anchor types are text, signature, date, checkbox, dropdown...), so `placeLicence` (`pdf-lib`) draws it on the last page inside the template's licence slot, scaled to fit, never stretched. The file is the driver's application's licence document (`application_documents`, kind `license`, status `stored`), read from our bucket (`FileStorage.get`, new). Any picture is first made upright, at most 1600 px and JPEG with `sharp` (firma answers 413 for a PDF of 11.5 MB; ours is about 0.7 MB); a licence that is a PDF has its first page drawn; the markers still match after `pdf-lib` saves (checked). California's slot runs 44 pt past the page bottom in the sample, so the picture is cut to the page less 24 pt. No licence file, a pending one, an unreadable one: 409 with a message that never carries the file; no bucket: 503; the bucket fails: 502; nothing reaches firma. `sentValues.licenseDocumentId` records which file was used (jsonb, no migration); the picture itself is not copied anywhere else. **Allowed by Abulkalam (2026-10-24):** the licence photo goes to firma and into the signed PDF; the client can ask to change it. HEIC is not read (B98).
**Why:** the first signed contract looked bad (marks, ragged table) and had an empty licence page; California was the next contract the client uses. Measuring firma's real behaviour, not assuming it, is what made the fixes small.

### D77 — 2026-10-24 — The webhook saves the signed files itself, about 30 seconds after the signing (Module 2 step 4 follow-up; Abulkalam)
- **Found on staging:** a contract signed at 12:01 said "The signed contract is being saved." until the 12:05 run of the 5-minute job. The webhook only decided the status (it must answer within 5 seconds, and firma makes the signed PDF and certificate about 20 seconds after the signing), so only the job saved the files: 20 seconds to 5 minutes of waiting.
- **Change:** when the webhook sees a contract turn signed it starts `saveDocumentsSoon` in the background (not awaited): tries `saveDocuments` after 30 s, then 30 s and 60 s later if firma has no links yet or the download failed, and stops at the first success. One loop per contract (a second event is ignored). `saveDocuments` is unchanged, so a race with the job is harmless (same keys, the file is overwritten).
- **The job stays.** The waits are timers in the server's memory: a deploy or restart inside those 2 minutes drops them, and a missed webhook never starts them. The 5-minute job is what cannot be skipped (D75); this only makes the usual case fast.
- **Screen:** the contract query also looks again every 15 s while a contract is signed and its files are not saved, so the banner turns to "saved" and the links appear without a reload (before, it looked again only while the contract waited for the driver).
**Why:** a driver or admin who has just signed should see the file in about a minute, not up to five, and without reloading. No new state is stored, so no migration.

### D78 — 2026-10-24 — The login text (email and temporary password) is no longer sent on approval (changes D52; Abulkalam)
- Approving an application (from its page, or by "Add driver", D79) sends **one** text: the approval template. The second, fixed text with the driver's
  email and temporary password is gone for now. Removed from `ApplicationsService.approve`; `driver-welcome.text.ts` stays, unused, so bringing it back is a
  small change (B99). No setting: the client asked to skip it for the time being, and a switch nobody asked for is not built.
- **Consequence:** the driver's login is still created (role `driver`, `mustChangePassword`, email verified) with a random password nobody sees, so **a driver
  approved now cannot log in**. There is no password-reset or "set your password" route yet. `dry_run` no longer shows credentials in the chat either.
- `SMS_MODE` still governs the approval text: `off` refuses the approval, `live` really sends it (also on staging). `ConfigService` / `WEB_APP_URL` are no
  longer used by `ApplicationsService` (the login link was the only use); the env variable itself stays.

### D79 — 2026-10-24 — An admin-added application is approved on save; "Add driver" on the Drivers page (partly replaces D68; Abulkalam, the client's request)
- The client wants to add a driver quickly, so `POST /applications/manual` now **approves the application it saves**, through the same `approve()` (one code
  path, as D68 wanted). The response gains `driverId`. The same form serves "Add application" (Applications page) and "Add driver" (Drivers page,
  route `/admin/drivers/new`); both approve, and after saving the admin lands on the new driver's page.
- **Checked before anything is stored:** a valid, textable US phone, no driver with this email or phone, no login with this email (`assertCanBecomeDriver`,
  shared with `approve`), so a bad form saves nothing and uploads no files.
- **Approval still fails after saving** (the approval text could not be sent: Quo down, `SMS_MODE=off`): the application stays `pending`, the answer is the
  approval's error prefixed "Application saved, but not approved:", and sending the same `request_id` again (the form keeps it) retries the approval
  without storing anything twice. Approving from the application's page also works.
- The approval text is the first "approved" template (no choice or edit dialog on this path). The staff alert text for a new application still goes out
  as before (D53).
- **Known trade-off:** saving the form is final (no review step), and with D78 the new driver has no way to log in yet.

### D80 — 2026-10-25 — Approval is only a status; the driver is created by "Start onboarding"; archive is a flag (changes D26, D56, D79; client video 2026-10-24, B100; Abulkalam)
- **Why:** many approved applicants never pick up a car, so approving must not create a driver (and a login). Before, `approve()` created the login and the `drivers` row in one go.
- **Approve** now only sets the status `approved` and sends the approval text. The migration drops the CHECK `applications_approved_has_driver` (approved <=> has a driver) and keeps the one-way rule `applications_driver_only_if_approved` (a driver means approved).
- **Start onboarding** (`POST /applications/:id/start-onboarding`, the old creation code moved) creates the login (D26, D78) and the driver in `onboarding` (D56) and links `applications.driver_id`. Refused if the application is not approved, archived, already started, or a driver or login has the email or phone. Our button for the client's two triggers (a deposit, or the applicant going ahead).
- **Where the onboarding steps live (the design question): on the driver, unchanged.** Contract, deposit, ledger, payments, aliases and the signed contract all hang on `drivers.id` (`contracts.driver_id` is NOT NULL). Moving them onto the application (the other option) would have touched Module 2, the ledger, payments and matching, and a deposit could not be matched to an applicant. Trade-off accepted: a `drivers` row exists for people who started onboarding and may still walk away; they are archived, and never shown on Drivers while `onboarding`.
- **Pages:** *Approved applications* (`GET /applications/approved`) = approved, not archived applications whose driver does not exist yet or is in `onboarding`, with the progress (x of 3). When the driver turns `active` it leaves that page and is on *Drivers*, which lists only `active` and `inactive` (`GET /drivers?onboarding=false`; without the flag every status is returned, as the payment pickers need).
- **Archive = `archived_at timestamptz NULL`** on `applications` and `drivers`, not a status, so Unarchive restores exactly what it was (a driver stays `active` or `inactive`). Lists hide archived rows; `archived=true` shows only them. Delete stays separate and unchanged (B66, D55); drivers are archived, never deleted.
  - Application archive: any status. An approved one whose driver is in `onboarding` is archived together with that driver (one transaction); if the driver is `active` or `inactive`, 409 "archive the driver instead".
  - Driver archive: `active` or `inactive` directly (no deactivate first); a driver in `onboarding` is refused (archive the approved application). Status, steps and login are not touched.
- **Shown as a status (Abulkalam, 2026-10-25):** the flag stays (a dedicated `archived` status was weighed and rejected: it would lose what the row was, and Unarchive would have to guess; the cost is that every billing / reminder query must also test `archived_at IS NULL`, now the first test of those jobs). To avoid an archived driver looking live, every status badge shows **Archived** with the old status as small text ("was Active"); same for applications and the Approved applications page (`ArchivedBadge`).
- **Archived drivers:** no billing and no reminders (client, 2026-10-25): PHASE1_SPEC sections 7 and 8 now say `active` and not archived; the jobs do not exist yet (M2, M6), so there is no code to change today (B103). Payment matching and the AI matcher still see archived drivers, so money from a former driver is not lost to "unrecognised".
- **"Add application" / "Add driver" (D79):** both approve on save; approving creates no driver, so "Add driver" (`?startOnboarding=true`) also starts onboarding and lands on the driver's page as before; "Add application" ends approved (no driver). The checks for a driver's email and phone run first only for "Add driver".
- **Existing data:** every application approved before this has a driver, so nothing is migrated; the migration only adds the two columns and swaps the CHECK. Reverting is refused while an approved application has no driver.

### D81 — 2026-10-26 — Leaving a driver: how they left is a field on an inactive driver; collections is a flag (client video 2026-10-24, B100 item 5b, B104; Abulkalam)
- **Why:** the client wants the ways a driver leaves (deactivate, archive, send to collections) and "we always have to note how they left"; the Collections area is where he messages drivers about a past-due balance.
- **`status` is unchanged** (`inactive` = left, D56). New columns on `drivers`: `left_reason` (enum `driver_left_reason`: `contract_ended`, `bad_driver`, `cooperative_returned_car`, the client's three), `left_at`, `left_by_id`, and `sent_to_collections_at`, `sent_to_collections_by_id`. Weighed and rejected: a fourth status `collections` (the enum, its CHECK, `statusFromSteps`, login on/off and every `status =` filter would change, and a status forgets what the driver was); a separate departures table (keeps history across reactivations, more than asked).
- **CHECKs:** `drivers_left_shape` (reason and date come together; only an inactive driver has one), `drivers_collections_shape` (collections only when inactive **and** with a reason: "always note how they left" holds in the database).
- **Deactivate** now needs the reason (400 without). Deactivating a driver who already left keeps the first reason and date; an old inactive driver (no reason) gets it noted then.
- **Send to collections** (`POST /drivers/:id/collections`): active or inactive, not onboarding (409). A driver with no reason must be given one, and an active driver is deactivated in the same transaction (login off). It does not check the balance (the client said "typically" owing). **Remove from collections** (`POST /drivers/:id/remove-from-collections`) is manual; the driver stays inactive with the reason. **Reactivate** clears the reason and the collections flag (the old values go to the application log).
- **Where they are listed (Abulkalam, 2026-10-26):** a driver in collections is on the Collections page and **not** on Drivers (`?collections=false`, like an archived one). The default (no flag) lists every driver, because the payment pickers must still be able to assign money to a driver in collections.
- **"Driver" means active or inactive (Abulkalam, 2026-10-26):** someone in onboarding is not a driver yet. The Drivers page filter defaults to **Active** (no `status` in the URL); Inactive is `?status=inactive`, and `?status=all` lists both. On the page of someone in onboarding (driver page, ledger) the back link goes to Approved applications and the line reads "Onboarding since", not "Driver since". The links to a person's page read "View details".
- **Archive** is allowed in collections (D80 rules): hidden everywhere, `Archived only` shows them, Unarchive restores.
- **Billing:** rent is for `active` drivers (spec 7), so a driver who left is not billed; what they still owe stays in the balance. No automation touches collections (no reminders, no auto-removal when paid).
- **Collections page:** `GET /drivers?collections=true` (same list code and balance as Drivers), newest sent first, the date range filters the day sent. Existing inactive drivers keep empty reasons (the migration changes no data).
- **Migration timestamp** `1792620000000` sits between the archive migration (`1792600000000`) and the contract-charge one in flight on `feature/contracts-ledger` (`1792640000000`), because TypeORM refuses to run an older pending migration after a newer one.

### D82 — 2026-10-26 — The deposit amount paid is typed when "Deposit paid" is ticked (client video 2026-10-24, B100 item 5; Abulkalam)
- **Why:** the client wants the deposit amount paid as one more card above the ledger entries, for the later refund (B101). He did not say where the number comes from.
- **Chosen:** `drivers.deposit_paid_cents` (integer), typed in the tick dialog, required the first time the step is ticked, cleared when un-ticked. CHECK `drivers_deposit_amount_shape`: an amount only with the step ticked and above zero; the only upper limit is what the column holds. Ticking an already-ticked deposit with an amount records or corrects it (the way to fill in drivers ticked before this: they show "Not recorded").
- **Weighed:** the contract's security deposit (the agreed amount, not what was paid; none for imported drivers); a sum of ledger credits applied against the security-deposit charge of Module 2 step 5 (always consistent, but needs that feature merged and the admin applying payments to that charge).
- **Known consequence:** the typed number is separate from the ledger, so it can differ from the payment actually posted there. The card says "Deposit paid", shows "Not recorded" for an old tick and "Not paid" with no tick. The printable statement does not show it.

### D83 — 2026-10-26 — Contract charges go on the ledger when the driver signs, and rent is billed from the signed contract (Module 2 step 5; Saad, Abulkalam, planning chat 07 and chat 12)
- **Request (Saad, WhatsApp, 2026-10-21, client-confirmed):** when a driver signs a contract, its costs (daily or weekly rent and whatever else is in the contract) must go on the driver's ledger; he shows the whole flow to the client soon. Scope PDF: "starts the rent schedule in Module 1 on the contract start date". Source rows are in `MODULE2_SPEC.md` section 4; open items in B105.
- **Billing comes from the signed contract only (Abulkalam, 2026-10-26).** Rate, schedule and start date are on the signed contract and cannot change after sending (D74). There are no manual billing settings: B88's driver-level Pause / Resume, "Billing active", "Run weekly billing" and the per-driver due-day input (B100 item 5) are dropped. Drivers without a signed contract (the imported ones) are not billed by the job.
- **At signing (pickup charges),** in the same transaction as the `signed` status and the "Contract signed" tick (D75), one **debit per non-zero charge**, dated the contract start date: Security deposit (refundable), Documentation fee, Insurance policy start fee, Other one-time charge, Hold vehicle payment, and the first rent. All or nothing: if posting fails the contract stays `sent`, the error is logged and the 5-minute job (or firma's webhook retry) tries again. A posting that could never succeed (none expected: amounts are 1 to 1,000,000 cents) would leave a signed contract `sent`, logged each run. A driver who then pays the amount due at pickup ends at $0.00.
- **Overrides, confirmed by Abulkalam 2026-10-21:** (1) **D60's "deposits stay out of the ledger until B19"** no longer holds for contract deposits: without a debit the deposit payment would show as "in credit" and hide missed rent. Refund or applying it at the end is a manual credit entry for now (B19, B101 stay open). (2) **Spec 7's "onboarding drivers are never billed"** holds for recurring rent only; the pickup charges are posted at signing whatever the driver's status, because the contract says they are due at pickup.
- **Recurring rent** (job `ContractRentJob`, hourly, advisory lock `7_302_004`, one transaction per driver with the driver row locked, errors logged never swallowed): for each driver with `status = 'active' AND archived_at IS NULL` (D56, D80) and a signed contract, **every due date up to today in `America/Chicago`**, never before the driver's `rent_from`. Each due date is billed by the signed contract in force that day: a contract bills from start date + one period (7 days weekly, 1 daily; the start date itself is the first rent posted at signing) until the day before the next contract's start date, where that contract's own first rent takes over, so a rate change leaves no gap and no double day. Two contracts with the same start date: the one signed last bills. The weekly due day is the weekday of the start date (first payment at pickup): our suggestion, confirmed with the client in the demo. The job does not stop at the lease end date: the contract auto-extends weekly, so billing stops when the driver is deactivated, archived or in collections (inactive).
- **`drivers.rent_from` (our addition, confirmed by Abulkalam 2026-10-26).** A date set to today (Chicago) by `DriversService` whenever a driver becomes `active`: the last onboarding step is done (by an admin or by signing), they are reactivated, or unarchived. The job never posts a due date before it, so the days a driver was inactive or archived are never billed back when they return, and a due date before they became active is never billed. The migration fills it for drivers already active (the Chicago date of their latest onboarding step). Weighed and rejected: accepting the back-rent after a gap (wrong money would land on the ledger by itself), a cap on the catch-up days (arbitrary).
- **Idempotent by unique keys (spec rule 3):** `contract:<contractId>:security_deposit`, `:documentation_fee`, `:insurance_start_fee`, `:other_one_time`, `:hold_vehicle`; rent is `rent:<driverId>:<YYYY-MM-DD>` for the first rent and for every job run, so signing and the job can never post the same due date twice, and a re-run, a double run, a restart or catching up after downtime posts each missing date exactly once. Inserts use `ON CONFLICT (idempotency_key) DO NOTHING` (`LedgerService.postSystemDebits`). A reversed entry keeps its key, so it is never posted again.
- **Entry shape:** `direction debit`, `effective_date` the due date, `created_by_id` null (the system), integer cents from `contractNumbers()` (the code that printed the PDF). Kind: a new enum value **`contract_charge`** (migration `AddContractChargeKind`) for the one-time charges; `rent` (reserved for M2 since D60) for rent. The kinds that count as charges (rent, adjustment, contract_charge) live in one constant (`CHARGE_KINDS` in `ledger-entry.entity.ts`) used by every ledger query: credit against a charge, the charges filter and total, aging, entry details.
- **Not posted automatically (shown on the contract page as "Not posted automatically yet", never silently dropped):** excess mileage per mile (needs mileage, Module 3), insurance excess per month, other recurring (no client rule). **Late fees** are not built (spec 12, B10).
- **Privacy:** logs carry contract id, driver id and counts only; entries hold amounts and descriptions, never the licence number or date of birth.
**Why:** the client's scope lists the pieces and wants them connected; the contract already holds every number, so the ledger follows the contract, and the unique keys, the single transaction and `rent_from` make a double or wrong charge impossible by construction.

### D84 — 2026-10-27 — An application and its driver are archived and unarchived together; applications of active or inactive drivers leave the default list (changes D80; client feedback 2026-10-27 "fix the delete/archive function for approved drivers"; Saad and Abulkalam, 2026-10-27)
- **Why:** D80 made the Archive button on an application fail with 409 "archive the driver instead" when its driver was `active` or `inactive`, and the Drivers page refused a driver in `onboarding`. Neither refusal was asked for: the client's video said approved applicants and drivers who left both go to the archive. A button that can only fail on a screen, and the same person listed on two pages, read as a defect. Saad objected that the application stays and a driver is created too; Abulkalam answered that they are separate entities in separate tables (the application holds the submitted data, documents and chat; the driver holds onboarding, ledger, contract, billing).
- **Data model unchanged:** two tables, `applications.driver_id` stays. Moving the onboarding or ledger onto the application was weighed in D80 and rejected for the same reasons.
- **Archive and unarchive act on the pair, from either page, in one transaction:** `ApplicationsService.setArchived` and `DriversService.setArchived` set `archived_at` on both rows (the same time); the 409s are gone. A driver with no application (imported, D44) is archived alone. Archiving still stops billing and reminders (D80); unarchiving an `active` driver sets `rent_from` to today (D83), whichever page was used (`startBilling` is exported from `drivers.service.ts` and reused).
- **Lock order is application first, then driver, in both services,** so two admins pressing Archive on the two pages at once cannot deadlock (covered by a test that fires both at once).
- **Because the pair is archived together, nothing else changed in the list rules:** `archived=true` lists archived applications whatever their driver.
- **The Applications list (Saad, 2026-10-27):** applications whose driver is `active` or `inactive` leave the default list, since that person is on Drivers; an applicant with no driver or a driver in `onboarding` stays (they are on Approved applications too). New query `becameDriver=true` and a **Show: Became drivers** filter list exactly those; `becameDriver` with `archived` is a 400. `ApplicationListItemDto.driverStatus` and `DriverDto.applicationId` carry the link both ways (list, detail pages: "View driver", "View application"). The Approved applications page is unchanged.
- **Confirm dialogs (our addition):** archiving an application whose driver is active or inactive, or a driver who has an application, asks first and says what else is archived and that billing and reminders stop. The row Archive buttons on the Drivers and Collections lists do not ask.
- **Backfill:** migration `LinkedArchiveBackfill` (`1792660000000`, data only) copies `drivers.archived_at` to the application of every driver archived before this change. The other direction needs nothing (an application could not be archived while its driver was active or inactive). `down` does nothing.
- **Not changed:** Delete (approved applications still cannot be deleted, D55); the driver's login; payment matching still sees archived drivers.
**Why:** one archive for one person, no dead button, no duplicate in the default list, and no way to leave the pair half archived.

### D85 — 2026-10-28 — An admin adds a driver directly, without an application; the profile lives on the driver (changes D68, D79, D80; client message via Saad 2026-10-28; Abulkalam)
- **Request:** the client's list of fields for adding a driver by hand: first / middle / last name; street, apartment, city, state, ZIP; phone; email; date of birth; age; driver licence upload; earnings screenshot upload; current insurance Y/N; payment method; payment ID; payment alias. Saad also suggested a manual contract (recurring charges, a photo of the paper copy, the deposit): that is step 2 and 3 of this feature, not built here (B109).
- **A second way to create a driver.** "Add driver" on the Drivers page no longer saves an application and approves it (D79); it opens its own form and calls `POST /drivers` (admin, multipart). "Add application" on the Applications page is unchanged (D68). `POST /applications/manual?startOnboarding=true` stays in the API but no screen uses it (B110).
- **Required: first name, last name, email, phone** (the table needs them: the unique email and phone, matching, the chat). Everything else is optional and checked only for length (the date of birth for being a real day in the past): the client asked for the values, not for rules. The website form's age-25 rule is not applied.
- **No login, no approval text, no staff alert** for a driver added directly (`user_id` null, as for imported drivers, D44). Nothing is texted or emailed. Status `onboarding`, like every new driver (D56).
- **The profile is on the `drivers` row, read from there in both flows (Abulkalam).** New nullable columns: `middle_name`, `street`, `apt`, `city`, `state`, `zip`, `date_of_birth`, `has_insurance` (boolean). "Start onboarding" copies what the application holds (street, apartment, city, ZIP and the yes / no insurance answer, `profileFromApplication`); the website has no middle name, state or date of birth (it asks the age, which goes stale), so those stay empty. The migration `AddDriverProfileAndDocuments` (`1792680000000`) backfills drivers that already exist from their application. One-way copy: after it the driver's values are the live ones, the application keeps what was submitted.
- **Age is not stored.** The API computes it from the date of birth (Chicago day). Date of birth and address are plain text for now (MVP; B94 still open) and are returned **only on the driver detail** (`DriverDetailDto.profile`), never in the list and never logged.
- **Edit profile (our addition):** `PATCH /drivers/:id/profile` changes the profile fields; a field sent empty is cleared. Without it a driver from an application could never get a middle name, state or date of birth. Names, email and phone are not editable (B110).
- **Files: one row, one owner.** `application_documents.driver_id` (nullable FK, `RESTRICT`) and a nullable `application_id`; the CHECK `application_documents_one_owner` makes a file belong to an application or to a driver, never both (a driver's file is an admin upload). A driver's documents are its own rows, or its application's when it came from one; `GET` / `PUT /drivers/:id/documents[/:kind]` use the application's slot in that case, so both pages always show the same file. Contract `drawLicence` finds the licence by the driver's own row or its application's. Weighed and rejected: copying the files at Start onboarding (the copier creates rows late, a replaced file deletes its old object, and a copy duplicates licence images); one row with both owners (the same lateness).
- **Payment method + ID + alias:** one repeatable row "method + value", each saved as a payment alias through the D69 rules (`prepareAlias` / `insertAlias`, shared with the driver page); an alias another driver owns is a 409 and **nothing at all is saved**. Assumption until the client says what "Payment ID" means (B109).
- **Order of a create:** check the phone, files, aliases and that email and phone are free, then put the files in the bucket, then one transaction (driver, file rows, aliases); on failure the files are removed again. Sending the form twice makes one driver (the second gets 409); the loser's files are removed.
- **Where they are listed:** a driver in `onboarding` with no application is not on Approved applications, so the Drivers page has the status option **"Onboarding (added directly)"** (`?status=onboarding`, API `withoutApplication=true`). Drivers from an application stay on Approved applications only. Archive works (D84).
- **Sources (every field, where it comes from):**

| Field or step | Source | Status |
|---|---|---|
| First, middle, last name; street, apt, city, state, ZIP; phone; email; date of birth; age; licence upload; earnings screenshot upload; current insurance Y/N; payment method, payment ID, payment alias | The client's list, relayed by Saad, 2026-10-28 | client-confirmed |
| Only name, email and phone required | Our reading: the driver table needs them | our suggestion |
| Age computed, not stored | Our choice: it goes stale | our suggestion |
| Payment rows saved as aliases | Our assumption about "Payment ID" (B109) | our suggestion, to confirm |
| Edit profile; the "Onboarding (added directly)" list option | Ours: needed to fill the gaps and to find the driver | our addition |
| Manual contract, recurring charges, paper copy, deposit | Saad's suggestion, 2026-10-28 | not built yet (step 2 and 3) |

### D86 — 2026-11-02 — The contract's driver details are read from the driver's licence by AI (B121; Abulkalam, client request)
- **What:** `POST /drivers/:driverId/contract/licence-details` (`LicenceReaderService`) sends the driver's licence file (the same file drawn on the contract, D76: the driver's own or the application's) to the AI already used for payments (Gemini, `LLM_API_KEY` / `LLM_MODEL`) with a JSON schema, and answers with address, licence number, licence state (two letters) and date of birth (`YYYY-MM-DD`). Nothing is saved. The draft page calls it by itself when those four boxes are empty, and a "Read licence with AI" button calls it again; filled boxes say "Read by AI from the licence. Check it." until the admin changes them. The values are saved with the draft as if typed.
- **Never trusted as is:** `validateLicenceDetails` drops a malformed value (null, the box stays empty) instead of passing it on: real past calendar date, two-letter state, the contract fields' length limits. "Not a licence" is a 409. The AI is told to use null rather than guess.
- **Privacy (accepted by Abulkalam, 2026-11-02):** the licence (name, address, date of birth, licence number, photo) goes to Google. This departs from spec 5.2's "no PII in the LLM call", which is about payment emails. On Gemini's free tier Google may use what is sent to improve its products; **before real licences go through it on staging or production, use a paid key (or have the client's consent)**. Only the driver's id is logged, never the file or the values.
- **Files:** a PDF licence is sent as a PDF; a picture is normalised as for the contract (upright, at most 1600 px, JPEG); HEIC is refused (B98). The AI client (`LlmJsonRequest.file`) can now carry one file.
- **Checked:** unit tests for the checks; a made-up licence image (no real person) read correctly end to end by `gemini-3.5-flash-lite`, month-first date turned into `YYYY-MM-DD`.

### D87 — 2026-11-02 — Dark "ledger" redesign, by re-colouring TailAdmin's tokens (B112; Abulkalam; replaces D20's "light theme only")
- **Look:** taken from a design sample the client's side shared (a ledger page): deep navy page, navy cards, burnt orange as the one accent, muted status colours with dark tints, small spaced capitals for labels, monospaced figures for money and references, flat bordered cards, squarer corners. Its navy top bar is not used (we keep the sidebar). Built one module at a time; step 1 is the shell, shared parts and Applications.
- **How:** `src/index.css` re-colours the tokens behind TailAdmin's class names instead of adding `dark:` classes (D20's rule against `dark:` still holds: there is no light theme to switch to). The grey scale is inverted (gray-50 page, gray-900 brightest text); `brand` is burnt orange; status scales are dark at 25-200 and light at 500-950, so existing pairs like `bg-error-50 text-error-600` still read. `white` stays white (text on orange buttons); cards use a new `surface` colour (every `bg-white` became `bg-surface`), floating panels are `gray-100` with a strong shadow, overlays use `scrim`. `color-scheme: dark` and explicit `select`/`option` colours make native controls dark. Fonts: Archivo (headings), IBM Plex Sans (body), IBM Plex Mono with tabular figures (`num` utility); `eyebrow` utility for small-caps labels.
- **Why tokens:** almost every screen restyles at once, and feature branches built in parallel need few or no merge fixes; anything built later is dark by itself.
- **Shared pieces:** `DataTable` (dark header row in small capitals, zebra rows, warm hover); `BackLink` (TailAdmin's chevron-left in an outline button) on every page with a back link.

### D88 — 2026-11-06 — The dashboard is worked out on the server, one card per card of the old system's dashboard (spec section 10, M7; Abulkalam; feature `dashboard`)
- **Source:** the client's existing "Operations Dashboard" (the live page and `gonzocar/admin/src/pages/Dashboard.tsx`, read 2026-11-05). Saad demos to the client, so every card of it has a counterpart; where our data model differs the card is adapted, and what was left out is listed below. Nothing here was asked for by the client beyond that page.
- **Where the maths is:** `GET /dashboard` (`src/dashboard/`) returns every figure in one response: integer cents, Chicago days, whole-number percentages. The old page downloaded every payment and driver into the browser and added them up there (floats, mixed time zones); ours does not, and the browser only formats.
- **Rent due today:** worked out with `rentSchedule`, the function the hourly rent job posts with (for `active`, not archived drivers with `rent_from` on or before today), so the card can never disagree with the billing. The daily / weekly split and the weekday spread come from the signed contract in force today (`contractInForce`, the same choice `rentSchedule` makes).
- **Populations:** payments = `confirmed` (money that reached a ledger) plus the `unmatched` queue; `rejected` never counts. Balances (fleet balance, distribution, watchlist, owed by inactive / in collections) = drivers who are `active` or `inactive` and not archived: onboarding drivers are not "drivers" yet (D81) and their pickup charges would swamp the figures; archived ones are hidden everywhere (D80). Drivers in collections are counted (the money is still owed). Applications exclude archived ones.
- **Adapted:** "Weekly cycle since Mon 9AM NY" (an arbitrary New York cut-off) became **This week** (Monday to today, Chicago); "Vetting pending" became **Applications pending**; "Paused / Terminated exposure" (the rates of paused drivers) became **Owed by inactive drivers** and **In collections**; the weekly due-day card counts active drivers only (inactive ones are not billed); "Payment parser" became **Email intake**, and its "missed windows" (the old cron's idea) was dropped.
- **Left out on purpose:** discrepancies (the status is reserved for the bank check, M5; always 0 until then), days late / overdue (not built anywhere, spec section 7; the watchlist and the total outstanding cover it), and any live call to Gmail or Quo (a slow or failing outside call must never break the page).
- **Intake run log (Abulkalam chose it):** a mailbox that cannot be read was only a log line, and spec 5.1 says that must be visible. Table `email_intake_status` holds exactly one row (CHECK `id = 1`) that every run overwrites: last run, outcome (`ok` / `failed` / `off`), emails stored, when it last worked, and the error text (CHECK: set only when `failed`). One row because a history of runs was not asked for and it can never grow. Unlike `inbound_emails` (never updated, D37) this row is meant to be updated. The scheduler records `ok`, `failed` (with the cause chain, cut at 500 characters) and `off`; a run that finds another still working records nothing; a failure to write the status is logged and never stops payment matching.
- **Charts:** TailAdmin's bar and donut (`apexcharts`, `react-apexcharts`, Abulkalam agreed), re-coloured to the dark tokens (D87), loaded lazily so other pages do not download them. The page keeps the last figures on screen when a refresh fails and says how old they are.

### D89 — 2026-11-07 — Seeding named old-system drivers into staging by hand (Abulkalam; extends D44, D45)
- The client sent a list of 7 drivers missing from the system. Found: 4 only in the old database, 1 (Elizabeth) already on staging but archived in `onboarding`, 1 (Corey) already on staging mid-onboarding, 1 (Jesus Galindo) nowhere.
- **Rules used (same as D45) with one change:** a phone shared by two old drivers no longer blocks an import, because several drivers may share a phone (B117). Cesar and Jhonny share one number; it is kept as it is (Cesar's is on his application, Jhonny's is probably a copy; the client is asked, B124).
- **An existing staging driver is fixed, not duplicated:** Elizabeth's row is linked to the old record (`legacy_id`), unarchived and made `active`, because the old system has her active and the client asked for her. Her login is kept. This overrides D45's "a driver created here is never overwritten" for this one row, on Abulkalam's explicit yes (2026-11-07).
- **A driver in onboarding is not a missing driver:** Corey is left in the onboarding flow; making him active means finishing the deposit and vehicle steps, which is the client's call.
- **Old money is not copied.** The four owe one week's rent in the old system; our billing starts from a signed contract (D83), so no ledger rows were written (old ledger import is B80).
- Done as one-off scripts through the staging tunnel (dry run, then one transaction, every update asserted to touch one row); nothing added to the repo.
**Why:** the client expected these drivers in the Drivers list and in payment matching; rebuilding the importer for seven people is not worth it.

### D90 — 2026-11-08 — A signed contract file on every driver, in the driver's own document slot (feature `driver-contract-file`; Abulkalam)
- **Why:** the client sent signed rental agreements for 7 drivers that were not made through firma, and the system had nowhere to keep a contract file. Abulkalam chose (2026-11-07) a new document kind over building the paper contract (B109 step 2): one file per driver, viewable, replaceable, no effect on rent, deposit or ledger.
- **Step 1, the slot.** `application_documents.kind` gains `contract` (migration `AddContractDocumentKind`). The route is the existing `PUT /drivers/:id/documents/contract`. **A contract always belongs to the driver, never to the application**, even for a driver who came from one: application rows are deleted with the application (`ON DELETE CASCADE`), a signed contract must outlive it (`driver_id` is `RESTRICT`). The application route refuses `contract` (400). The driver's list is the application's files plus the driver's own contract row. The file keeps the usual rules (JPG, PNG or PDF by content, at most 10 MB) and key pattern `drivers/<driverId>/contract-<uuid>.<ext>`. The database holds only the key; the page gets a signed link that lasts 10 minutes.
- **Step 2, firma fills the same slot** (Abulkalam, 2026-11-08: "the same field for the firma-generated as well as regular contracts"). A **copy**, never the same object: `contracts/<id>/signed.pdf` stays where the contract page reads it, so replacing the slot can never break that page. Rules (`decideFiling`): empty slot is filled; the same contract again does nothing; **an admin upload is never overwritten**; a newer signing replaces an older firma copy; a copy whose contract is unknown is replaced. An admin upload over a firma copy takes the slot and clears the link. Migration `AddFirmaContractCopy`: `contract_id` (unique, `SET NULL`, only on a driver-owned row), origin `firma`. The two checks that named `'admin'` became "not the website" so they never name a value added in the same transaction (`migration:run` runs all pending migrations in one); TypeORM compares checks by name only, so these were written by hand. A separate job (`ContractFilingJob`, every 5 minutes at :30, own advisory lock) files new signings and the ones signed before this existed; a failure is logged with the contract id and retried. The sweep's SQL leaves out contracts that would not be filed, so a settled contract is never looked at again.
- **Deliberately not built (additions to propose first):** several contracts per driver or a history (one slot; a re-signed lease replaces the copy, the contract page keeps every original); reading data out of the PDFs; billing from a paper contract (B109 step 2); filing right after the signing instead of within about 5 minutes.
- **Known harsh edge:** replacing a contract deletes the previous file from the slot (same flow as licences). The Replace dialog says so, and says when the current file is a firma copy whose original stays on the contract page.
- **The filing code lives in the contracts module** (`ContractFilingService`), not with the document service, so no module imports the other.

### D91 — 2026-11-08 — The client's updated contract templates: one PDF and one measured table per company, no date under the signature (feature `contract-templates`; Abulkalam, B114)
- **Why:** on 2026-10-26 the client sent five updated templates (Gonzo IL, Gonzo CA, Evergreen, Ashwood, Silver Pine; B114). Their text changed (a shorter insurance paragraph with an authorisation clause, a "full list of charges and fees" sentence with a link, a card-on-file note on the signature page, no "Date:" line under the Lessee signature) and every page reflowed, so every marker position had to be measured again. Sent contracts keep their old text (frozen at send, D74).
- **Answers that settled B114 (Abulkalam, 2026-11-08):** (a) the insurance paragraph ended "...charge its cost to Lessee as provided in." with nothing after "in"; the client's answer is to end it after "Lessee" with a full stop, so "as provided in." is removed (our copies are fixed; the client's own files still end "as provided in."). (b) The Stripe card feature is skipped; **the card-on-file note stays as the client wrote it** ("A credit or Debit card is required to be kept on file ... Please enter the card information ...") although nothing in our app collects a card. (c) No date under the signature is fine, the date is at the top (Effective Date).
- **One template per company, not per state (supersedes D76's "one per state").** The five documents differ in their page-1 lines (Ashwood has no phone line and an "Email Address:" line, Silver Pine its own wording, Evergreen / Illinois / California their own breaks), so one measured table cannot serve several of them. `templateFor({ name, state })` looks up `<company name>|<state>`; Gonzo Enterprises Inc has two rows (IL, CA). Files: `src/contracts/templates/<gonzo-il|gonzo-ca|evergreen|ashwood|silver-pine>-lease.pdf` and `-placements.ts`; the old `illinois-*` and `california-*` files are removed. A company with no template (a state added later) still answers 409 "There is no contract for <company> (<state>) yet."
- **How the files were made (same method as D76, nothing hand-typed in the PDFs):** the client's .docx files (outside the repos, in `contract-templates/`, never committed: they hold real sample drivers) were turned into marker versions by a script that asserts every replacement matches exactly once and prints only counts; the repeated lease-term row that Google Docs prints at the top of Ashwood's page 2 (repeated table header) was switched off for that file; a scan found no sample name, address, email, phone, date of birth, VIN or date left. The marker documents are in `contract-template-work/new/` and were exported to PDF by Google Docs. The placement tables were generated from the PDFs with pymupdf; the method was first checked against the old Illinois and California PDFs (every left, width, height, font size and maximum width matched, and the money column's centre is the same 68.5%, so `moneyRightPct` stays 72.2).
- **Differences between the templates, followed as the client wrote them:** (1) **no `LESSEE_DATE` marker and no date anchor**: the signature page has only the signature box; `date` is gone from `ContractTemplate` and `buildAnchors`. (2) **A new value `RECURRING_TOTAL`** (the "Total" row ending the recurring charges in Illinois, Evergreen, Ashwood and Silver Pine): payment + insurance excess + other, never the per-mile charge (the same sum as B119's `recurringTotalCents`). (3) **California and Silver Pine have no "Excess Mileage Charge (Per Mile)" row**, so that value is not printed there (and California has no recurring Total row). (4) **Ashwood has no phone line**, so the driver's phone is not printed on an Ashwood contract. (5) Silver Pine has its own text (transfer fee, shops "by contacting us", "Insurance Start Fee"). Each absence is listed in `NOT_SHOWN` in `contract-template.spec.ts`, so a lost marker cannot go unnoticed.
- **Kept from the old templates:** the "(Lessor)" and "(Lessee)" tags that follow the company and driver names are not printed (the value field needs the room; as before); the client's own oddities stay as written (a stray "4" line in the Illinois-family tables, "Email :" and "~" on California's page 1).
- **Licence slot:** the box of each template's sample picture, as in D76 (it runs past the page bottom in Illinois and California, and the picture is cut to the page less 24 pt, as before). **Silver Pine has no picture box in the client's file**, so its slot is Illinois's size placed at Illinois's distance from the "Driver License:" label (assumed, to be checked on a real send).
- **Measured on real signed test contracts (2026-11-09, firma TEST key, one per template, sent to Abulkalam's address; made-up driver data; the signed copies carry firma's "NOT LEGALLY BINDING" test watermark):** every value lands within 0.01% of where it was asked except (a) the email and phone lines, which firma puts to the right of the marker as in October: **`driftXPct` 1.55 (email) and 1.67 (phone) in the Illinois, Evergreen and Silver Pine templates, 1.9 (email) in Ashwood's** (the pattern is a line with two spaces before "Phone:" or a long space run after the label; California's " ~ " line has none); the placements take it back off; (b) "18 months" and the payment label differ by 0.33% and 0.22% (glyph-width estimates, not firma; left as in October). **No leftover marker text, commas or brace tails:** a pixel check of every marker box in the five signed PDFs found no ink that is not the printed value (the same check lights up 40 of 40 on the unsigned template), and the header, signature and licence areas were looked at by eye. Silver Pine's assumed licence slot lands neatly under the "Driver License:" label. The values written into the tables (drift) have NOT been re-checked with a second send.

### D92 — 2026-11-11 — Dashboard page 1, daily operations: every list worked out on read from the ledger and the contract (feature `dashboard-page1`; Abulkalam; client's financial-dashboard redesign of 2026-11-08)
- **Why:** the client split the dashboard in two. Page 1 is what staff look at every day: who pays today, who is late, who should be deactivated, what was collected this week, deposits, collections. Page 2 (the statistics cards, D88) is a later chat. `GET /dashboard/daily-operations` (admin only) returns all of Page 1 in one response; the page is the new `/admin` index, the old D88 page moved unchanged to `/admin/statistics` ("Statistics" in the menu) until Page 2 takes its cards.
- **Nothing "late" is stored.** Lists, days late and hours late are computed at read time from the ledger and the signed contract (same idea as the aging tiles). Nothing is ever deactivated automatically: Should Be Deactivated is a list, staff open the driver and decide. The pure rules are in `src/dashboard/daily-ops.ts` (constants `EARLY_WARNING_DAYS=1`, `WEEKLY_DEACTIVATION_DAYS=2`, `DAILY_DEACTIVATION_COUNT=2`, `DEPOSIT_DEACTIVATION_DAYS=7`); the SQL in `daily-ops.service.ts`.
- **Answers that settled it (Abulkalam, 2026-11-11, four questions):** (1) **deposit due = the contract start date (pickup)**, not the signing date (D83 posts the deposit debit on the start date and the contract says "due at pickup"; the brief assumed the signing date: tell the client); (2) **"paid" = oldest-first**, the ledger aging rule: all credits form one pool that pays the oldest charges first, so a charge is *open* by what is left of it; (3) **the old dashboard stays**, the new page is the default; (4) **a driver with no due time is late at the end of the due day** (from 12:00 AM next day).
- **Rules, written once.** *Who is listed:* rent rules for `active` drivers, not archived, not in collections (inactive and collections drivers are on Collections); the deposit rule for `active` and `onboarding`. *Only `rent` charges count as late payments* (deposit and fees are not rent). *Due moment* of a rent charge = its `effective_date` + the driver's `rent_due_time` as a Chicago wall clock, turned into a UTC instant (`chicagoInstant`, correct on both DST days); late when now is strictly after it. *Days late* are counted on the Chicago clock (same clock time on the next day), *hours late* are real elapsed hours; the two differ only on the two DST days. *Early Warning* = oldest open late rent charge at least 1 day late. *Should Be Deactivated*, any one reason is enough and several can show: `daily_late` (daily driver, 2 or more open late rent charges), `weekly_late` (weekly driver, oldest open late charge 2 or more days late), `deposit_unpaid` (the contract asks for a deposit, the "Deposit paid" step is not ticked, 7 or more days after the contract start date). A driver **on a payment plan** is left out of Should Be Deactivated only, and stays on Late and Early Warning with a "Plan" badge. *Due today*: active drivers with a rent charge dated today (Chicago); weekly group and daily group; status Paid / Not yet paid / Late.
- **Weekly total (D5):** confirmed payments (`status = 'confirmed'`) grouped by Chicago day into Monday to Sunday weeks (`date_trunc('week')`); this week and 25 earlier (`WEEKS_SHOWN = 26`), newest first; the arrows only choose a week in the browser. **Deposits collected (D6):** a record of the drivers whose step is ticked, with the amount typed then (D82); it is **not** a sum of ledger entries because ticking does not credit the ledger (B106). A tick from before D82 has no amount: listed ("Not recorded"), not in the total. **Deposits pending (D7):** deposit asked by the contract and step not ticked; amount = the contract's deposit. **Collections (D9):** the existing D81 list shown on the page, with a link to it; nothing new.
- **Two new driver columns (migration `AddDriverRentDueTimeAndPaymentPlan`, no data change):** `rent_due_time` (`time`, nullable, Chicago wall clock, whole minutes by CHECK `drivers_rent_due_time_minute`) and `on_payment_plan` (`boolean NOT NULL DEFAULT false`). Set by `PATCH /drivers/:id/rent-settings` (admin; audited by driver id only) and, for the time, optionally on Add driver (`POST /drivers`). The driver page has a "Payment settings" card: due-time dropdown (12, 1, 3, 6, 8 PM, Other, Not set) and an "On payment plan" switch that saves at once.
- **Sources (every field and list; "client" = the financial-dashboard redesign document of 2026-11-08):**

| Field / list | Source | Status |
|---|---|---|
| `drivers.rent_due_time`, the due-time dropdown | Client doc, driver setup (due time per driver, D11/D12) | client-confirmed |
| `drivers.on_payment_plan`, the Plan badge | Client doc, payment plan exception (not on Should Be Deactivated) | client-confirmed |
| Drivers due today (weekly group, daily group) | Client doc D1 | client-confirmed |
| Late payments, Early Warning (24+ h) | Client doc D2, D3 | client-confirmed |
| Should Be Deactivated and its three rules, red badge, list only | Client doc D4 | client-confirmed |
| Weekly total with prior weeks (Mon to Sun) | Client doc D5 | client-confirmed |
| Deposits collected, Deposits pending | Client doc D6, D7 | client-confirmed |
| Collections on the page | Client doc D9 (existing D81 feature) | client-confirmed |
| Deposit due = contract start date | Abulkalam, 2026-11-11 | our suggestion, to tell the client |
| "Paid" = oldest-first | Abulkalam, 2026-11-11 (the aging rule) | our suggestion |
| No due time = late at the end of the due day | Abulkalam, 2026-11-11 | our suggestion |
| 26-week window; "Statistics" menu entry; due time on Add driver; lists not paginated (a fleet of about 40 to 76) | none | our addition |

- **Not built, and not blocked:** D8 refunds, D10 rate history, D19b, D20, Page 2, SMS reminders. **Open, waiting for Saad (B126):** D13 (late-fee on/off), D15 (late fees $7 and $45 with a 90-minute grace) and D17 (a manual Late / On Time override). The row objects are plain classes, so `lateFeeCents` or `overridden` can be added later without changing anything here.
- **Known limits:** the system holds no payment-plan schedule, so "a missed plan payment brings the normal rule back" cannot be seen: staff switch the flag off (B127). The client wrote "12:01 AM Monday"; weeks are whole Chicago days, one minute of difference (B128).

### D93 — 2026-11-11 — Dashboard page 2, financial views: collections per month / week / day / range and revenue per driver, worked out on read from the confirmed payments (feature `dashboard-page2`; Abulkalam; client's financial-dashboard redesign of 2026-11-08)
- **Scope (Saad, 2026-11-11: build what is in scope, nothing extra):** monthly, weekly, daily and custom-range collection views, a week selector, revenue per driver, the existing statistics moved onto the page, and payment records showing amount, date and time received, driver. **Not built (on hold, flagged):** revenue per vehicle (D19b), CSV upload (D20), deposit refunds (D8), rate history (D10), late fees, the late-fee toggle and the Late / On Time override (D13, D15, D17, B126), SMS reminders. The On Time / Late status and the fee part of a payment record wait for B126.
- **What "collected" counts (our reading of the client's "total collected"):** payments with `status = 'confirmed'`, grouped by `payments.occurred_at` as a **Chicago day**. That is the money page 1 and the D88 page already count, and the same days `GET /payments?from&to` keeps, so a total can never disagree with its list. The ledger is not summed: a payment can only leave "collected" by being voided (`rejected`) or reassigned to another driver (a payment credit cannot be reversed from the ledger), and both change `payments` itself. **Not collected:** the unmatched queue, rejected payments, manual adjustments (credits and discounts are not money received), and the "Deposit paid" tick (it never touches the ledger, B106). A deposit that arrives as a payment is collected like any payment.
- **Revenue per driver** = the same confirmed payments grouped by the driver they are assigned to, for all time or a range of days. It is money **received**, not rent billed. It includes inactive and archived drivers (money received stays revenue; D88 hides archived drivers only for balances), shown with an Inactive / Archived badge.
- **Two endpoints, admin only, paginated on the server:** `GET /dashboard/collections?view=monthly|weekly|daily&from&to&page&limit` and `GET /dashboard/revenue-by-driver?from&to&page&limit`. Both return the totals of the whole filter next to the page. Money is `bigint` summed in SQL and returned as integer cents; periods are listed newest first from the first payment (or `from`) to today (or `to`, never later), and a quiet period is a row of 0, like page 1's weekly total. The periods themselves are built in TypeScript (`src/dashboard/collections.ts`, pure and tested over both daylight-saving Sundays, month and year edges and a leap February); Postgres only adds up the money per period. A range cuts a month or week at its edge: the row holds only its days inside the range. `from` after `to` answers 400. No migration, no new table.
- **Page structure (D92's open choice):** Page 2 **is** the route `/admin/statistics` (menu entry renamed "Financial views"; page 1 stays the index). Three tabs: **Collections** (Monthly / Weekly / Daily / Custom range), **Revenue per driver**, **Statistics** (the D88 page, untouched, `GET /dashboard` unchanged). The weekly view has the week selector (arrows, or a click on a week of the list; the selected week's total is asked of the same endpoint limited to that week's days). The custom range shows the total, the number of payments and every payment collected (amount, date and time received, driver) through the existing `GET /payments` list, so no list was built twice.
- **Cut on purpose to stay in scope (Abulkalam, 2026-11-11):** records under every month, week and day row (only the custom range lists payments), a "jump to week" picker, average / largest tiles, a per-day breakdown inside the custom range, a search box on revenue per driver.
- **Sources (every field and list; "client" = the redesign document of 2026-11-08):**

| Field / list | Source | Status |
|---|---|---|
| Monthly, weekly, daily collections | Client doc, Page 2 "Collection views" (D18) | client-confirmed |
| Custom date range (start, end, all collections in it) | Client doc, "Custom date range ... high priority" (D18) | client-confirmed |
| Week selector | Client doc, "settings control to select or switch between weeks" (D18) | client-confirmed |
| Revenue per driver | Client doc, "Revenue per driver" (D19) | client-confirmed; what it counts: our reading |
| Existing statistics moved to this page | Client doc, "Existing statistics" (D21) | client-confirmed |
| Payment records: amount, date and time received, driver | Client doc, Business Rules (D22, D23) | client-confirmed (status and fee wait for B126) |
| "Collected" = confirmed payments by Chicago day; revenue includes inactive and archived drivers | Abulkalam, 2026-11-11 | our reading |
| Date range on revenue per driver; menu label "Financial views"; 8 rows per page | none | our addition |


### D94 — 2026-11-12 — Ledger entries are edited IN PLACE; the append-only rule bends in one controlled place (feature `fleet-revisions`; Abulkalam; client's Fleet Command Revisions of 2026-11-09, section 5, then his answer "no, because payments and things are sometimes logged incorrectly")
- **What the client asked:** first "no ledger delete" (our proposal), then, when asked, he wants entries **editable** because payments and charges are sometimes entered wrongly. **Built: edit (amount, date, description, memo). Not built: delete, Divide Payment** (separate quotes, B133).
- **History of this decision (same day, before anything was merged):** first built as the textbook way, a reversal of the old entry plus a corrected entry. **Abulkalam rejected that: the client wants the entry itself changed, not two extra entries ("it is not standard practice, but the client wants it").** So the edit now changes the row in place. This **deliberately bends spec rule 2 and the workspace rule "ledger is append-only"**, which Abulkalam owns; both are amended to say so.
- **How it stays safe:** `PATCH /drivers/:id/ledger/entries/:entryId` runs in one transaction that (1) locks the entry, (2) checks the rules below, (3) switches the edit on for that transaction only (`set_config('app.ledger_edit', 'on', true)`), (4) updates the row, (5) writes the audit line. The database trigger `ledger_entries_append_only` (migration `AllowLedgerInPlaceEdit`) was **narrowed, not removed:** DELETE is always refused; an UPDATE is refused unless the switch is on **and** only `amount_cents`, `effective_date`, `description` or `internal_note` changed. Driver, direction, kind, payment, reversal link, key and creation time can never change. A stray UPDATE from a console, a script or a bug is still refused.
- **The audit log is the only history of an edit (D95):** the ledger no longer shows the old value, so every edit writes `ledger_entry.edit` with who, when and the old and new values, in the same transaction. There is no screen for it yet (database only); if the client wants to see "edited" on an entry or the old values, that is a small follow-up (B136).
- **A payment is edited on the payment row** (amount, date, memo; the text too for a payment recorded by hand) and its credit is updated in place to match, so a payment and its credit never disagree and the collected totals (which read `payments`) follow. A payment that came from an email keeps the text its sender gave it (400 if a text is sent).
- **Rules (409/400, plain words):** a reversal cannot be edited; an entry that was **reversed** is cancelled and cannot be edited (the reversal's amount has to keep matching it); a charge cannot be edited **below** the credits already applied to it (its date, text and memo can change); a credit applied to a charge cannot grow past what is left on that charge; nothing changed; a date in the future or not a real day. **Editing a charge that has credits is now allowed** (the first version refused it).
- **What it does to the numbers:** the balance, the aging tiles, Late payments and the reminders all read the ledger, so they change the moment an entry is edited. The date edit moves a rent charge's due date as well as its look; staff should know that.
- **Reversal still exists** for cancelling an entry and keeping it in the history (a mistake that should not count at all, a refund).
- **Gotcha found on the first deploy (2026-11-12):** adding entities changed the import order, and the compiled ESM then failed with `Cannot access 'SmsMessage' before initialization` (entity import cycle; `design:type` metadata reads the class when the decorator runs). A relation property typed with another entity in a cycle must use `Relation<T>`. Vitest and the dev server do not catch it: run `npm run build && npm run migration:run:prod` locally before deploying.

### D95 — 2026-11-12 — A minimal audit log (who and when), the application delete log, and approved applications can be deleted (feature `fleet-revisions`; Abulkalam; client section 5)
- **`audit_logs` table** (append-only by trigger, like the ledger): `actor_id` and `actor_email` (the admin; the email is kept even if the account is later removed), `action`, `entity_type`, `entity_id`, `details` (jsonb), `created_at`. It is written with `recordAudit(manager, lines)` **inside the acting transaction**, so a change and its log line stand or fall together. Spec section 4 already named an AuditLog; this is its first use. **No read endpoint and no screen** (the client asked that it be logged, not shown): read it in the database.
- **Logged today:** `application.delete` (one line per deleted application: who, when, the applicant's name and status) and `ledger_entry.edit` (D94: who, when, old and new values; the ledger itself keeps only the new ones).
- **Deleting an application, approved ones included.** Before, an approved application could not be deleted. Now it can, because the client wants a log of deletes "including approved ones". **The driver the approval made stays**, and the application's stored documents (website files) are **handed to the driver** (`driver_id` set, `application_id` cleared, so they are not removed with the application). The one-owner check on `application_documents` is relaxed for website-origin rows (migration `AllowWebsiteDocumentsOnDriver`). The Delete buttons and the confirm text say so.
- **Why hand the files over:** an approved applicant's licence is needed for the contract and for the driver's Documents card; losing it with the application would break a signed-contract flow.

### D96 — 2026-11-12 — Driver documents: licence back and five labelled "Other" slots (feature `fleet-revisions`; client section 5)
- New document kinds `license_back` and `other` (slot 1-5 plus a label of up to 60 characters typed by staff; migration `AddDriverDocumentSlots`). **Both are always driver-owned** (they belong to the driver, never an application). The existing kinds are unchanged (licence front = `license`, earnings, signed contract). The driver page's Documents card shows licence front, licence back, earnings, contract, then "Other documents" with five named slots.
- **"Other required documents" is an open client question (B134):** the client wrote it as a category, not a list. Nothing was invented: the five slots are labelled by staff.

### D97 — 2026-11-12 — Memo on any payment, account notes, Ledgers page, payment logos, Add driver inside Assign payment, clickable dashboard (feature `fleet-revisions`; client section 5)
- **Memo (`internal_note`) on every charge, credit and payment** and never on the driver's statement or in a message (the statement view does not read it). The old database check allowed a memo only on manual payments; migration `AllowMemoOnEveryPayment` relaxes it so a payment from an email can carry one.
- **Account notes** on the driver's ledger page: the same card as the application's internal notes (B74, D57): newest first, 10 at a time, never edited, you delete only your own. New table `driver_notes` (migration `CreateDriverNotes`), `GET/POST /drivers/:id/notes`, `DELETE /drivers/:id/notes/:noteId`.
- **Ledgers page** (menu entry directly under Payments, `/admin/ledgers`): every driver who has been through onboarding, with balance and status, search, a Status filter and the Archived filter, 8 per page, on the shared table. It reuses `GET /drivers` (no new endpoint). Clicking a row opens that driver's ledger. **"View ledger" links** are on Collections rows (already there), Drivers rows (already there), Payments rows (when the payment has a driver), and the Late payments, Early warning and Should be deactivated lists on the dashboard.
- **Payment-method logos** for Zelle, Cash App, Venmo and Stripe (Stripe added at Abulkalam's request, 2026-11-12) are inline SVG (no image files, no library): simplified marks in each brand's colour, shown next to the method name on the Payments list, the ledger's payment details and header, the driver's recent payments and the alias groups. **They are not the official artwork** (B135).
- **"+ Add driver" in the Assign payment dialog** reuses the minimal Add driver form (name, email, phone) and the same `POST /drivers`, then assigns the payment to the new driver, which saves the payer's name as the alias like any assignment. B100 item 8 had skipped this on 2026-10-26; the client asked again, so it is built.
- **Dashboard:** an "Add driver" quick action next to Refresh; the six headline tiles are links that scroll to their card; every driver row in every list already opened the driver.
- **Not built:** nothing from "Do NOT build" (ledger delete, Divide Payment, card on file / Stripe, Incoming Vehicles, Reservations, employee logins, vehicle database, forgot password, automatic credits, late fees, On Time override).

### D98 — 2026-11-12 — Payment reminders (spec section 8 with the client's own rules): pure rules, one text a day, a log of everything, switched off until staff switch it on (feature `fleet-revisions`; client section 6)
- **Pure rules** in `src/reminders/reminder-rules.ts` (no database, no clock of their own), fed by `RemindersService` from the ledger and the dashboard's lateness rules (`DailyOperationsService.driverFigures`, the same code as Late payments, so a driver the dashboard calls late is the one the reminder texts). Order of precedence for one driver at one moment: (1) a **payment-received** confirmation (not held back by an earlier text that day; only when something is still past due); (2) if anything went out **today (Chicago)**, stop; (3) **high balance**, daily drivers at exactly 2, 3, 4 or 5 payments behind, each tier once per stretch of being behind; (4) **late**, once, the first missed payment of a stretch; (5) **balance**, past due **over $100**, every **72 real hours**, a payment restarts the clock; (6) **upcoming**, weekly drivers, from 48 hours before the due moment.
- **"Behind" stretch (episode):** `drivers.late_episode_started_at` is set when a driver first has a late rent charge and cleared when nothing is late. Dedupe keys include it, so a driver who pays up and falls behind again is warned again, but never twice for the same stretch.
- **48 hours = two Chicago days earlier at the same wall-clock time**, so on the two daylight-saving nights the text still arrives at the time the driver expects (47 or 49 real hours). Balance reminders use 72 real hours.
- **Per-driver switches:** `upcoming_reminders_enabled` and `balance_reminders_enabled` (default on), on the driver's Payment settings card; a driver who replied **STOP** (`sms_opted_out`, set by the Quo webhook, cleared by START) is never texted. Archived, inactive, in-collections and onboarding drivers are left out.
- **One table, `reminder_logs`:** every reminder composed, sent or failed, with its text, the past-due and balance amounts and (for a failed one) the reason. A **unique dedupe key per mode, excluding failed rows**, makes a double text impossible even if two runs overlap, while a failed send can be retried. **Failed sends are visible** on the driver's Payment reminders card.
- **Texting mode is respected (spec section 3.7):** `off` composes nothing, `dry_run` composes and saves (status "composed", nothing sent), `live` sends through Quo. Switching reminders on records `reminders_enabled_at`; a payment confirmation is sent only for payments made after that moment, so no old payment is confirmed. Drivers already behind at that moment are texted by the normal rules (late, balance), at most one text a day.
- **Settings (`app_settings`, key/value):** `reminders_enabled` (**default OFF**, set only in Settings > Payment reminders, which asks for confirmation), `reminders_enabled_at`, and `payment_link` (**default empty**, B132). The five texts are editable in Settings (message templates of the new kinds `reminder_*`, one each; the placeholders each may use are listed in the editor). A placeholder with an empty value drops **its whole line** from the text, so a `{paymentLink}` line vanishes cleanly while the link is empty.
- **Job:** every 15 minutes (`0 */15 * * * *`) under a Postgres advisory lock (key 7302005), like the other jobs.
- **Sources (client = Fleet Command Revisions, section 6):**

| Field / rule | Source | Status |
|---|---|---|
| Upcoming text 48 h before due, weekly drivers, per-driver switch | Client section 6 | client-confirmed |
| Late text once | Client section 6 | client-confirmed |
| High balance daily at 2, 3, 4, 5 payments behind | Client section 6 | client-confirmed |
| Balance text every 3 days when over $100, a payment restarts the clock | Client section 6 | client-confirmed |
| Confirmation after a payment, with what is still past due | Client section 6 | client-confirmed |
| One text per driver per day; high balance wins over the balance text | Client section 6 ("send only one") | client-confirmed |
| Per-driver balance-reminder switch; reminders visible on the driver's page | Client section 6 | client-confirmed |
| Editable texts in Settings; switch off by default | Client section 6 | client-confirmed |
| Optional payment link | Client section 6 | open (B132) |
| Order of precedence among the other kinds; episode tracking; STOP / START; 15-minute run; confirmations only for payments after switch-on; confirmation not held back by a text that day | Abulkalam / spec section 8 | our suggestion |
| Ledger entry edit in place (amount, date, description, memo) | Client's answer, 2026-11-12; in place: Abulkalam, 2026-11-12 | client-confirmed |
| Application delete log (who, when), approved applications deletable | Client section 5 | client-confirmed |
| Licence back, five labelled Other documents | Client section 5 | client-confirmed (the list of "other required documents" is open, B134) |
| Memo on charge, credit and payment; account notes; Ledgers page; View ledger links; logos; Add driver inside Assign payment; Add driver on the dashboard; clickable dashboard items | Client section 5 | client-confirmed |
| Menu entry "Ledgers" below Payments; 8 rows per page; the Status filter on Ledgers | Client section 5 / none | client-confirmed / our addition |

### D99 — 2026-11-12 — Investor-demo mode: hide the money screens with a build-time flag; logo, sign-in title, orange focus ring (frontend feature `investor-demo-mode`; Abulkalam, relaying the client)
- **Why:** the client wants to show the app to investors "for a short time" and asked to hide financial information: the Financial views and Payments menu entries, "Collected this week", and all financial information on the dashboard. **Temporary and reversible on purpose.**
- **How:** `VITE_HIDE_FINANCIALS=true` (a Railway variable on the frontend service, read at build time like `VITE_API_URL`). `src/demoMode.ts` exports `HIDE_FINANCIALS`. When true: the menu entries "Financial views" and "Payments" are not listed and their addresses redirect to the dashboard; the dashboard drops the "Collected this week" and "Deposits pending" tiles, the weekly total, deposits collected and pending, and Collections cards, and the Rate, Amount due, Amount past due and Balance columns. **To switch back: delete or change the variable and redeploy the frontend** (a rebuild is needed). It only hides screens; the API and the data are unchanged, so anyone with a token can still read the numbers.
- **Not hidden (not asked, flagged to Abulkalam):** the Ledgers page, the balance column on the Drivers and Collections lists, the driver pages and ledger pages. Hide them too if the client says so.
- **Logo:** from the client's `logo(pdf).pdf` (the wordmark was vector artwork, redrawn as `src/assets/gonzocar-logo.svg`; a compact "G" + "C" mark, `gonzocar-mark.svg`, for the collapsed sidebar). Shown on a light plate because the wordmark is navy and purple and the app is dark. Upper left on the sign-in page, in the sidebar and in the mobile header. The sign-in page also shows "Fleet Command Center" above the card, as in the client's mock-up.
- **Focus ring:** the client asked to remove "the white line" (the browser's keyboard-focus outline). Removing it hurts keyboard users, so it is brand orange instead (`:focus-visible`); the sidebar's is drawn inside the item because the scrolling list clipped it.

