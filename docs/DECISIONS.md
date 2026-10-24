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
