# Backlog

Ad-hoc requests, feedback, open questions and follow-ups. Mark done with a date; never delete.

## Open
| # | Item | Raised | Notes |
|---|---|---|---|
| B1 | Write access to both repos for Abulkalam | 2026-10-02 | Requested from Saad. Blocks pushing. |
| B2 | Branch protection on `main` and `dev`, both repos | 2026-10-02 | Saad. Require PRs. |
| B3 | Confirm Cash App / Venmo one-stage posting (D8) | 2026-10-02 | Saad. |
| B4 | Exact sender addresses for Cash App, Venmo, Chase Zelle emails | 2026-10-02 | **Zelle confirmed 2026-10-09:** `no.reply.alerts@chase.com`, `header.d=chase.com`. Cash App and Venmo still unconfirmed (not in `payashwood@`; find which mailbox receives them). Needed for M3. **Start early:** blocks payment parsing, which follows step A (D30). |
| B5 | Real sample payment emails | 2026-10-02 | **One real Zelle email saved 2026-10-09** in `mail-samples/` (workspace folder outside both repos; real data, never commit). Read with `npm run imap:peek`. Need Cash App and Venmo samples. Raw emails exist in the reference system's `inbound_emails` table. Needed for M3. **Start early:** blocks payment parsing, which follows step A (D30). |
| B6 | Gmail OAuth for the new system | 2026-10-02 | Separate authorization from the client. Restricted scope — check verification path. Needed for M3. **Start early:** blocks payment parsing, which follows step A (D30). |
| B7 | Plaid production access | 2026-10-02 | Requires a security questionnaire and company details. Needed for M5. |
| B8 | Choose LLM provider and model | 2026-10-02 | Cheap, fast, structured output. **2026-10-09, Saad:** OpenAI is okay for production; a free Gemini API key exists for now (development). Free tiers may use submitted content to improve the provider's products, so send only synthetic or redacted emails to it; production needs a paid key (client's account). Keep the extractor behind the `PaymentExtractor` interface so the provider can change. Needed for M3. **Start early:** blocks payment parsing, which follows step A (D30). |
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
| B26 | Mailbox access for intake | 2026-10-08 | Client mail server is Mailcow (`mail.gonzocar.com`), so IMAP likely replaces Gmail OAuth (B6). Ask Saad: which mailbox, a dedicated IMAP login (credentials go in `.env` only), and the Mailcow admin login (Abulkalam's attempt failed 2026-10-08). |
| B27 | How payments reach the mailbox | 2026-10-08 | Reference system receives forwards from `payashwood@`, `paysilver@`, `payevergreen@`, `gonzopay@gonzocar.com`. Auto-forward (keeps original DKIM) or manual `Fwd:` (signed by `gonzocar.com`, fails the DKIM rule)? Need real headers. **Checked in Mailcow admin 2026-10-09:** the four `pay*` addresses are real mailboxes (`gonzopay@` 206 messages, others 3-15), no aliases, no sync jobs, no filters. So no server-side forwarding; providers probably email each address directly (SOGo per-user forwarding not visible to admin). **Confirmed 2026-10-09:** `gonzopay@`'s active sieve filter is `keep; redirect "gonzobilling@gmail.com";`, so it keeps a copy and redirects the original to Gmail (what the old system reads). **Also confirmed 2026-10-09:** `payashwood@`, `payevergreen@`, `paysilver@` have the same filter (`keep; redirect "gonzobilling@gmail.com";`). So each pay mailbox keeps its own copy and nothing collects into `gonzopay@`. Still to check: which providers send to which address, and what a real email's sender and `Authentication-Results` look like. Server also hosts unrelated `@flyinvest.co` mailboxes: never touch. |
| B28 | Scope questions from the reference system | 2026-10-08 | Drop Chime and Stripe parsers (not in spec)? Must we record which of the four pay inboxes (entities) received a payment? From what date should intake start, given no data migration and the old system running alongside? |
| B29 | Real sample emails contain driver names | 2026-10-08 | Decide where they live and whether to redact before they become test fixtures in the repo (extends B5). |
| B30 | Amount check can be fooled by other amounts in the email | 2026-10-09 | Real Zelle email (2026-08-21) has a memo with several dollar amounts besides the payment (e.g. lease minus tire fix minus bulb). `validateExtraction` only checks the extracted amount appears somewhere, so a wrong one from the memo would pass. Decide a stricter rule (e.g. amount must be the one after the "Amount" label, per provider) before M3 is done. Zelle body also has no sender email/handle, only the name (`zelle_name` alias). |
| B31 | Cash App and Venmo emails are not in any Mailcow pay mailbox | 2026-10-09 | Read all four with `imap:peek`: only `no.reply.alerts@chase.com` (Zelle) payment mail. `gonzopay@` 203 Chase emails (about 2/day, latest 2026-10-08); `payashwood@` 11; `payevergreen@` and `paysilver@` only setup and test mail. So Cash App/Venmo notifications probably go straight to `gonzobilling@gmail.com`, or are not used. Ask client/Saad: which email are the Cash App and Venmo accounts registered with, and how many rent payments arrive that way? Ask Saad for counts per source from the old system's `payments_raw`. If they only reach Gmail, reading Mailcow alone would miss them (the "never miss a payment" rule). |
| B25 | Security hardening (deferred) | 2026-10-08 | After the features: rate limiting on `POST /applications`, `/auth/login`, `/auth/verify-email`; Swagger `/docs` exposure (B20); token storage (B21); strong production secrets and `MAIL_MODE=smtp` on staging; Turnstile (B16). |

## Done
| # | Item | Done | Notes |
|---|---|---|---|
| B11 | `.gitattributes` with `* text=auto eol=lf` | 2026-10-02 | Both repos. |
| B23 | Expired token during use | 2026-10-08 | A 401 from any API call logs out and returns to login (frontend, step B). |
