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
