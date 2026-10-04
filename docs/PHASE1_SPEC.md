# Phase 1 Spec — Payments, Ledger and SMS Reminders

Fleet operations platform for a rideshare rental fleet (~40 vehicles, Chicago + LA).
Drivers rent cars and pay rent daily or weekly. Admins need every payment to land on
the right driver's ledger, and drivers who fall behind to be reminded by SMS.

**The one rule that outranks everything:** a driver must never be chased for money
they already paid. When in doubt, the system flags for a human instead of guessing.

---

## 1. Scope

**In Phase 1**
- Admin web app (login). Only admins log in; drivers are records and do not log in (D24)
- Drivers, their payment handles (aliases), billing settings
- Append-only driver ledger
- Recurring rent charges and arrears
- Payment intake: Gmail (Cash App, Venmo, Zelle notifications) and Plaid (Zelle deposits in the Chase account)
- LLM-based extraction and matching, with an unrecognised bucket for manual assignment
- Two-stage posting for Zelle (reported → confirmed)
- SMS reminders via Quo (formerly OpenPhone), inbound replies and delivery status
- Payments dashboard, message templates, settings and automation switches

**Not in Phase 1:** contracts and e-signature, vehicle condition / check-in, driver
mobile app or portal, data migration from the existing system.

**Reference system.** An existing app (FastAPI + Postgres) handles parts of this today.
Use it as a reference for real-world behaviour and edge cases only — do not copy code.
It lives at `gonzocar/` in the workspace root and is read-only. Useful files:
`gonzocar/app/services/gmail_parser.py`, `gonzocar/scripts/parse_payments.py`,
`gonzocar/scripts/midnight_billing.py`, `gonzocar/app/services/billing.py`,
and everything in `gonzocar/tests/`. (Paths here are relative to the workspace root.)
Known defects there that this build must NOT repeat are listed in section 9.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Backend | NestJS (TypeScript) |
| Frontend | React + Vite + TypeScript, React Router, TanStack Query |
| UI | TailAdmin React Pro (Tailwind CSS) — components copied in as needed, never the whole template (D15) |
| Database | PostgreSQL via TypeORM (migrations only, `synchronize` off) |
| Scheduling | `@nestjs/schedule`, with a Postgres advisory lock per job so runs never overlap |
| Local dev | `docker-compose` for Postgres |
| Hosting | Railway — one service per repo, Railway Postgres. `main` deploys to staging. |
| Tests | Vitest (unit + e2e against a test database) |

Two repos, side by side in one workspace: `car-rental-backend-nestjs` (NestJS, owns this spec in `docs/`)
and `car-rental-frontend-reactjs` (React). Deployed separately.

**API contract:** `car-rental-backend-nestjs` publishes an OpenAPI document (via `@nestjs/swagger`).
`car-rental-frontend-reactjs` generates its typed API client from it rather than hand-writing request types,
so the two repos cannot silently drift apart.

---

## 3. Core rules (non-negotiable)

1. **Money is integer cents** (`Int`). Never floats, never strings in arithmetic.
2. **Ledger is append-only.** No updates or deletes. Corrections are reversal entries.
3. **Every write that can be retried is idempotent**, enforced by a unique key in the database, not just by application logic.
4. **Store UTC; bill in `America/Chicago`.**
5. **No silent failure.** Every parse failure, rejected email, failed SMS or sync error is recorded with a reason and visible in the admin UI. Never `catch` and discard.
6. **Automation is switchable.** Every automated action has an off switch in settings.
7. **SMS has three modes: `off`, `dry_run`, `live`. Default is `dry_run`.** In `dry_run` the message is fully composed and logged but not sent.

---

## 4. Data model (conceptual — translate to TypeORM entities)

**User** — an account that can log in. `email` (unique), `passwordHash`, `role` (`admin` | `driver`, no default),
`active`. Only `admin` logs in in Phase 1; `driver` is reserved for a future portal (D24).

**Driver** — `firstName`, `lastName`, `phone` (E.164), `email`, `status` (`active` | `inactive`),
`billingType` (`daily` | `weekly`), `billingRateCents`, `billingDueWeekday` (weekly only),
`billingActive`, `smsOptedOut`.

**PaymentAlias** — links a payment identity to a driver.
`driverId`, `type` (`zelle_name` | `zelle_contact` | `venmo` | `cashapp` | `email` | `phone`),
`valueNormalized` (lowercased, trimmed, whitespace collapsed), `createdById`, `source` (`manual` | `assignment`).
Unique on `(type, valueNormalized)`. **Lookups always filter by type.**

**InboundEmail** — one row per Gmail message processed.
`gmailMessageId` (unique), `fromAddress`, `subject`, `receivedAt`,
`authDkimPass`, `authDkimDomain`, `provider` (`cashapp` | `venmo` | `zelle_chase` | `unknown`),
`status` (`processed` | `rejected_unverified` | `extraction_failed` | `not_payment`),
`statusReason`, `bodyText` (only for allow-listed payment senders), `paymentId` (nullable).

**Payment** — a money event from any source.
`source` (`email_cashapp` | `email_venmo` | `email_zelle` | `plaid_zelle` | `manual`),
`externalId` (Gmail message id or Plaid transaction id), unique on `(source, externalId)`.
`amountCents`, `senderName`, `senderHandle`, `occurredAt`,
`status` (`reported` | `confirmed` | `unmatched` | `rejected` | `discrepancy`),
`driverId` (nullable), `matchMethod` (`alias` | `llm` | `manual`), `matchConfidence` (0–1),
`matchExplanation` (short), `pairedPaymentId` (links a Zelle email to its Plaid deposit).

**LedgerEntry** — `driverId`, `direction` (`debit` | `credit`), `amountCents`,
`kind` (`rent` | `payment` | `adjustment` | `reversal`), `description`,
`paymentId` (nullable), `reversalOfId` (nullable, unique), `createdById` (nullable = system),
`idempotencyKey` (unique, e.g. `payment:<id>`, `rent:<driverId>:<YYYY-MM-DD>`), `createdAt`.
Balance = sum(credits) − sum(debits). Never stored.

**PlaidItem** — `itemId`, `accessTokenEncrypted`, `institutionName`, `syncCursor`, `lastSyncedAt`, `status`.

**SmsMessage** — `driverId`, `direction` (`outbound` | `inbound`), `body`, `templateKey`,
`mode` (`dry_run` | `live`), `status` (`composed` | `sent` | `delivered` | `failed` | `received`),
`quoMessageId`, `error`, `reminderTier`, `createdAt`.

**MessageTemplate** — `key`, `body` with placeholders `{firstName}`, `{balance}`, `{daysLate}`, `{rate}`.

**Setting** — key/value for switches, thresholds, tier timings, SMS mode.

**AuditLog** — who did what for every manual action (assignment, adjustment, reversal, setting change).

---

## 5. Payment intake

### 5.1 Gmail
- OAuth to the business mailbox, read-only scope.
- Query **only allow-listed senders**. Never `in:anywhere` — the default search already excludes spam and trash, and that exclusion is a defence, not a limitation. Sender addresses go in config and are confirmed from real samples.
- **Verify every message** from the `Authentication-Results` header: require `dkim=pass` **and** `header.d` exactly equal to the expected domain for that provider. Anything else → `rejected_unverified`, never credits anyone.
- **Dedup on `gmailMessageId`.** If already in `InboundEmail`, skip it completely. Never reprocess, never overwrite its status.
- Poll every few minutes with a received-time watermark plus a small overlap window.

### 5.2 Extraction (LLM)
- For each verified email, send the cleaned body text to the LLM and require structured output:
  `{ is_payment, provider, amount_cents, sender_name, sender_handle, occurred_at, confidence }`.
- **Validate before trusting:** the amount must literally appear in the email text; provider must match the verified sender; reject anything that fails schema validation. Failure → `extraction_failed` with reason.
- Send only the email body. No driver phone numbers or other PII in this call.

### 5.3 Plaid (Zelle via Chase)
- Plaid Link from the settings page to connect the Chase account. Access token encrypted at rest.
- Use `/transactions/sync` with the stored cursor. Trigger on the `SYNC_UPDATES_AVAILABLE` webhook, with a scheduled fallback sync.
- **Plaid sign convention: negative amount = money in** for depository accounts. Only money-in counts.
- Filter strictly: incoming, posted (not pending), and identified as Zelle. Everything else — deposits, checks, ACH, bill pay — is ignored before it reaches the payment pipeline.
- Handle `modified` and `removed` from sync. A removed transaction that already confirmed a payment → mark `discrepancy` for review. Never auto-reverse.

---

## 6. Matching and posting

### 6.1 Matching order
1. **Exact alias lookup**, filtered by alias type. Hit → `matchMethod=alias`, confidence 1.0.
2. **LLM match** against the active driver list (ids, names, handles only). Must return a driver id from the provided list or null, plus confidence and a one-line explanation. Any id not in the list is treated as null.
3. Confidence ≥ threshold (setting, default 0.9) → matched. Otherwise → `unmatched`, into the unrecognised bucket.

### 6.2 Manual assignment
An admin assigns an unmatched payment to a driver. This posts the payment and **creates an alias** from the sender handle/name, so the same sender matches automatically next time. Logged in AuditLog.

### 6.3 Posting rules
- **Zelle — two stages.**
  - Chase Zelle email → payment `reported`. Suppresses reminders. No ledger credit yet.
  - Plaid deposit → pair with a `reported` email payment (same amount, within 72 hours, matching sender) → `confirmed` → ledger credit.
  - Plaid deposit with no email → matched and `confirmed` directly → ledger credit.
  - `reported` with no deposit after 72 hours → `discrepancy`, shown for review.
- **Cash App and Venmo — one stage.** That money does not reach the bank as individual transactions, so there is nothing to confirm against. A verified, validated, matched email → `confirmed` → ledger credit.
- Ledger credit uses `idempotencyKey = payment:<paymentId>`. A payment can never credit twice.

---

## 7. Billing and arrears

- Daily job in `America/Chicago`: rent debit for every driver with `billingActive`.
  - `daily`: one debit per day.
  - `weekly`: one debit on `billingDueWeekday`.
  - `idempotencyKey = rent:<driverId>:<date>` — re-running a day never double-bills.
- **Effective balance for reminders** = ledger balance + sum of `reported` (unconfirmed) payments.
  This is what stops a driver being chased for money they just sent.
- Days late: daily drivers = `ceil(-effectiveBalance / rate)`; weekly = days since the unpaid due date.
- Reference rule from the existing system: daily drivers are late at 2+ days behind, weekly at 48+ hours. Make both thresholds settings.

---

## 8. SMS reminders (Quo)

- Send via Quo REST API (API key header). Inbound messages and delivery status via webhooks; **verify webhook signatures** (NestJS needs raw body enabled for this).
- Tiers, each with its own template and timing (settings): `upcoming`, `due`, `overdue_1`, `overdue_2`, `overdue_3`.
- **Before every send, recompute the effective balance.** If the driver is no longer behind, do not send.
- Maximum one reminder per driver per day.
- Never message a driver with `smsOptedOut`. Inbound `STOP` (and common variants) sets it.
- Inbound replies stored and shown on the driver's page.
- Respects SMS mode: `off` composes nothing, `dry_run` composes and logs, `live` sends.

---

## 9. Defects in the reference system — do not repeat

1. Alias lookup ignored alias type, so a Venmo handle could match a Zelle alias for a different driver.
2. Every fetched email was reprocessed each run, overwriting its status to "duplicate" and erasing the real outcome.
3. Gmail query used `in:anywhere`, pulling spam and trash into payment processing.
4. Zelle detection trusted the subject line alone, with no sender verification — a forged email could credit a driver.
5. Every email in the mailbox was stored, including personal mail.
6. Parser errors were printed and swallowed, so failures were invisible.
7. The unrecognised payments endpoint had no pagination.
8. Amounts passed through floats.

---

## 10. Admin UI

- **Login.**
- **Dashboard** — received today / this week, pending review, unrecognised count, discrepancies, overdue drivers, total outstanding.
- **Drivers** — list with balance and late status; detail page with profile, billing settings, aliases (add/remove), ledger history, SMS history.
- **Payments** — filterable by status and source. Unrecognised bucket with assign-to-driver. Discrepancy list.
- **Email log** — every processed email with its outcome and reason (verified? extracted? matched to whom?).
- **Ledger actions** — manual debit/credit with required reason; reverse an entry. Admin only.
- **Settings** — Plaid connect, Gmail connection status, SMS mode, automation switches, reminder tiers and timings, templates, LLM confidence threshold.
- All lists paginated server-side.

---

## 11. Milestones

Each milestone ends with passing tests and something demonstrable.

| # | Milestone | Done when |
|---|---|---|
| M0 | Two repos (NestJS API + React app), TypeORM + Postgres, auth, roles | Admin can log in; protected routes reject requests without a valid admin token |
| M1 | Drivers, aliases, ledger, manual adjustments and reversals | Balance correct from entries; reversal cancels; duplicate key rejected |
| M2 | Billing job and arrears | Re-running a billing day creates no new debits; days-late correct for both billing types |
| M3 | Gmail intake, DKIM verification, LLM extraction | Unverified email rejected; seen message skipped; extraction validated |
| M4 | Matching, unrecognised bucket, assignment → alias | Assigned sender auto-matches next time; type-filtered lookup tested |
| M5 | Plaid Zelle sync and two-stage posting | Non-Zelle and outgoing transactions ignored; pairing works; 72h discrepancy fires |
| M6 | Quo SMS, tiers, webhooks, opt-out | Paid or reported driver is not messaged; dry_run sends nothing |
| M7 | Dashboard, settings, email log, hardening | All section 10 screens working on real data |

---

## 12. Open items (do not block; use the default and flag)

- Exact sender addresses for Cash App, Venmo and Chase Zelle emails — confirm from real samples.
- Reminder tier defaults and wording.
- Late fees — not defined yet; no late fee logic in Phase 1.
- LLM provider and model — choose one cheap, fast model with structured output support.
