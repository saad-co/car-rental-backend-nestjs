# Architecture

> **Status 2026-10-06: partly built.** Built: API scaffold, Postgres + TypeORM, admin auth, OpenAPI export;
> frontend app shell, generated API client, admin login and protected routes. The rest describes the target design.
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
| Gmail API | Cash App, Venmo and Chase Zelle notification emails | API polls |
| Plaid | Zelle deposits in the Chase business account | Webhook + scheduled sync |
| LLM | Extracting payment data from emails; matching payments to drivers | API calls |
| Quo (formerly OpenPhone) | Outbound SMS reminders; inbound replies and delivery status | API calls + webhooks |

## Payment data flow
```
Gmail ──► verify sender (DKIM) ──► LLM extract + validate ──► Payment (reported / confirmed)
Plaid ──► filter: incoming, posted, Zelle ──► Payment (confirmed) ──┐
                                                                     ├─► match (alias → LLM → bucket)
                                                                     └─► LedgerEntry (credit)
Billing job (America/Chicago) ──► LedgerEntry (rent debit)
Reminder job ──► effective balance check ──► Quo SMS (off / dry_run / live)
```
Full rules: `PHASE1_SPEC.md` sections 5–8.

## Security model
- JWT bearer-token authentication for admins and (later) drivers; a global guard protects every route unless
  marked public; the user is re-read from the database on each request (D25). Ledger adjustments and reversals are admin-only.
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
