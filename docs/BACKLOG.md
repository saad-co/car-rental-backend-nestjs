# Backlog

Ad-hoc requests, feedback, open questions and follow-ups. Mark done with a date; never delete.

## Open
| # | Item | Raised | Notes |
|---|---|---|---|
| B1 | Write access to both repos for Abulkalam | 2026-10-02 | Requested from Saad. Blocks pushing. |
| B2 | Branch protection on `main` and `dev`, both repos | 2026-10-02 | Saad. Require PRs. |
| B3 | Confirm Cash App / Venmo one-stage posting (D8) | 2026-10-02 | Saad. |
| B4 | Exact sender addresses for Cash App, Venmo, Chase Zelle emails | 2026-10-02 | Confirm from real samples. Needed for M3. **Start early:** blocks payment parsing, which follows step A (D30). |
| B5 | Real sample payment emails | 2026-10-02 | Raw emails exist in the reference system's `inbound_emails` table. Needed for M3. **Start early:** blocks payment parsing, which follows step A (D30). |
| B6 | Gmail OAuth for the new system | 2026-10-02 | Separate authorization from the client. Restricted scope — check verification path. Needed for M3. **Start early:** blocks payment parsing, which follows step A (D30). |
| B7 | Plaid production access | 2026-10-02 | Requires a security questionnaire and company details. Needed for M5. |
| B8 | Choose LLM provider and model | 2026-10-02 | Cheap, fast, structured output. Needed for M3. **Start early:** blocks payment parsing, which follows step A (D30). |
| B9 | Reminder tier defaults and wording | 2026-10-02 | Needed for M6. |
| B10 | Late fees | 2026-10-02 | Client expects them in the driver portal (2026-10-06). Need the rule: amount and when it applies. |
| B12 | Real logo and favicon from the client | 2026-10-02 | Sidebar/header use a text logo "Car Rental"; favicon is Vite's default. |
| B13 | Dark mode | 2026-10-02 | Deliberately left out of the frontend (D20). Add later if wanted. |
| B14 | Check TailAdmin Pro licence terms cover this use | 2026-10-02 | Components are copied into a client project. |
| B15 | Old-system driver features to add when their phase arrives | 2026-10-04 | Encrypted date of birth and address, applications, portal token, vehicle assignments, deposit fields, `paused`/`terminated` billing states. Reference: `gonzocar/app/models/models.py`. |
| B16 | Verify Cloudflare Turnstile on `POST /applications` | 2026-10-06 | Needs the client's Turnstile secret. A token verifies only once, so not possible while the old backend also receives it. Add rate limiting meanwhile. |
| B17 | Access to the client's Supabase `driver-documents` bucket | 2026-10-06 | Applications store only file paths; showing licence and screenshots in the admin needs read access. |
| B18 | Production email sender | 2026-10-06 | Nodemailer uses a personal Gmail for now; switch to a business address before go-live. |
| B19 | Deposit rules, vehicles and rentals, rental extensions | 2026-10-06 | Needed for the driver portal. Client has not answered how extensions work. |
| B20 | Swagger `/docs` exposure on staging | 2026-10-06 | Public locally; decide whether to hide or protect it when deployed. |
| B21 | Token storage before go-live | 2026-10-06 | Admin token is in `localStorage` (D28). Consider an httpOnly cookie (needs cookie auth and CSRF protection in the API). |
| B22 | Connect the gonzocar.com form to `POST /applications` | 2026-10-07 | Last step (D31). Needs: API deployed; `https://gonzocar.com` in `CORS_ORIGINS`; rate limiting (B16); the website's call to us must not block or break its submission if our API fails. **Blocked by B24.** |
| B24 | Access to the client's Railway account | 2026-10-08 | **Blocks deployment.** Needed to deploy backend, frontend and Postgres to staging. Until then everything runs locally. |
| B25 | Security hardening (deferred) | 2026-10-08 | After the features: rate limiting on `POST /applications`, `/auth/login`, `/auth/verify-email`; Swagger `/docs` exposure (B20); token storage (B21); strong production secrets and `MAIL_MODE=smtp` on staging; Turnstile (B16). |

## Done
| # | Item | Done | Notes |
|---|---|---|---|
| B11 | `.gitattributes` with `* text=auto eol=lf` | 2026-10-02 | Both repos. |
| B23 | Expired token during use | 2026-10-08 | A 401 from any API call logs out and returns to login (frontend, step B). |
