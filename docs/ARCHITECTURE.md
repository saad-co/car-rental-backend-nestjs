# Architecture

> **Status 2026-10-13: partly built.** Built: API scaffold, Postgres + TypeORM, admin auth, OpenAPI export; driver
> applications and drivers (with logins); payment email intake (IMAP, DKIM, AI extraction), payments, payment aliases
> and automatic matching, admin Payments / Email log / Drivers pages; staging on Railway (D43); the Quo chat (send,
> receive, files) on the application and driver pages, tested locally, not yet live on staging (D50, D51). Not built:
> ledger, billing, Plaid, SMS reminders and opt-out, settings. The rest describes the target design.
> As components are built, update this file to match the code. Where they differ, the code wins.

## Components
| Component | Repo | Role |
|---|---|---|
| API | `car-rental-backend-nestjs` | NestJS. Business logic, scheduled jobs, webhooks, OpenAPI document. |
| Admin web app | `car-rental-frontend-reactjs` | React + Vite. Uses TailAdmin Pro components, copied in as needed. Admin-facing only. |
| Database | Railway Postgres (local: docker-compose) | Accessed only by the API, via TypeORM. |

The web app never talks to the database or to external services directly — only to the API,
through a client generated from the API's OpenAPI document.

## External services
| Service | Used for | Direction |
|---|---|---|
| Gmail (IMAP) | Zelle, Cash App, Venmo, Stripe and Chime notification emails in `gonzobilling@gmail.com` (D38) | API polls every 3 minutes |
| Plaid | Zelle deposits in the Chase business account | Webhook + scheduled sync |
| LLM | Extracting payment data from emails; matching payments to drivers | API calls |
| Quo (formerly OpenPhone) | Chat with applicants and drivers on the general line (built); later reminders. Sends on API v1 (text only); history read on v1; inbound texts, files and delivery status by signed webhook | API calls + webhooks |
| S3-compatible bucket | Copies of files texted in by contacts (MinIO locally via docker-compose, Railway Storage Bucket on staging); opened only through 10-minute signed links | API writes, admin browser reads via signed link |

## Payment data flow
```
Gmail ──► allow-listed sender + DKIM ──► LLM extract + validate ──► Payment (unmatched)   [built, D47]
Payment ──► match: alias / email / phone exact, else LLM (70% assign, below → review) ──► Payment (confirmed)   [built, D48, D49]
Plaid ──► filter: incoming, posted, Zelle ──► Payment (bank check, M5)                      [not built]
Confirmed Payment ──► LedgerEntry (credit, same transaction; reassign = reversal + new credit)   [built, D60]
Admin ──► LedgerEntry (manual charge/credit by category, reversal)                         [built, D60]
Billing job (America/Chicago) ──► LedgerEntry (rent debit)
Reminder job ──► effective balance check ──► Quo SMS (off / dry_run / live)
```
Full rules: `PHASE1_SPEC.md` sections 5–8.

## Backend modules (payment side)
| Folder | Role |
|---|---|
| `src/email-intake/` | Module, 3-minute scheduler, `EmailIntakeService` (lock, cursor, one transaction per email), email log API. Subfolders: `mailbox/` (IMAP reader behind an interface), `verification/` (DKIM, sender allow-list, parser, `EmailProcessor`), `extraction/` (LLM prompt and answer validation) |
| `src/llm/` | `LlmJsonClient` interface, Gemini adapter, `LlmTemporaryError` (rate limit 429 and overload 5xx; shared by intake and matching) |
| `src/payments/` | `payments` table, admin list, manual assign |
| `src/aliases/` | `payment_aliases` table, normalisation |
| `src/matching/` | `MatchingService`, `AliasIndex`, AI driver matcher |
| `src/ledger/` | `ledger_entries` (append-only: database triggers refuse UPDATE/DELETE and check reversals), `LedgerService` (manual entries, reversals, `syncPaymentCredit` called by payments and matching in their transaction, balance, history with running balance, weekly/monthly summaries by Chicago `effective_date`), routes `/drivers/:id/ledger…`, `ledger:backfill` command (D60) |
| `src/sms/` | Quo chat (D50, D51): `sms_messages` / `sms_attachments`, `SmsService` (send by `SMS_MODE`, list, history sync, webhook apply), admin routes `/sms/...`, `POST /webhooks/quo` (signature-checked). Subfolders: `quo/` (client behind an interface, signature check, event parser), `storage/` (S3-compatible bucket behind an interface), `attachments/` (copies texted-in files into the bucket) |

`scripts/` holds developer tools (not part of the API): IMAP peek, extraction evaluation, old-database report and imports.

## Security model
- JWT bearer-token authentication for admins and drivers; a global guard protects every route unless marked
  public; the user is re-read from the database on each request (D25). A second global guard makes routes
  admin-only unless opened to drivers, and blocks everything until a temporary password is changed (D32, D33).
- Drivers must confirm their email (one-time link, hashed token) before logging in (D33). Ledger adjustments and reversals are admin-only.
- The admin web app keeps the token in `localStorage` and sends it as a bearer header; its route guard is
  display-only, the API enforces access (D28).
- Only origins in `CORS_ORIGINS` may call the API from a browser (D27).
- Emails only trusted with `dkim=pass` and an exact expected sender domain.
- Plaid access token encrypted at rest.
- Webhooks (Plaid, Quo) verified by signature before processing.
- Secrets only in environment variables, never committed.

## Environments
| Environment | Where | Branch |
|---|---|---|
| Local | Developer machine, Postgres in docker-compose | any |
| Staging | Railway | `main` |
| Production | Not defined yet | — |

## Reference system
`gonzocar/` (workspace root) is the existing FastAPI system. It runs side by side with this build
during evaluation. Read-only. See `PHASE1_SPEC.md` section 9 for its known defects.
