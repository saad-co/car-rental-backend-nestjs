# Worklog

Newest entry at the top. One dated entry per task: what changed, where, how verified, what is not done, branch.

---

### 2026-10-25 — Feature 13: Approved applications page, archive / unarchive (D80, B100, B102, B103)
- **Branch** `feature/approved-archive` in both repos, worktrees `wt-approved-archive-backend` / `-frontend` (slot 1; backend :5001, frontend :5174,
  databases `car_rental_approved_archive` / `_test`; during the walkthrough something else held :5001, so the API ran on :5002 and the frontend `.env` pointed there). Created from `origin/dev` `8a45fec` (backend) / `c7ed624` (frontend). **Not committed, pushed or merged yet** (waiting for Abulkalam's yes).
- **Backend:** migration `AddArchiveAndApprovedWithoutDriver` (`archived_at` on `applications` and `drivers`; CHECK swapped); `approve()` is a status + the approval text only; new `startOnboarding`, `archive` / `unarchive` for applications and drivers, `GET /applications/approved`; list queries gain `archived` (and drivers `onboarding`); `POST /applications/manual?startOnboarding=`; `openapi.json` re-exported.
- **Frontend:** sidebar item and page **Approved applications**; **Start onboarding** (list row and application page), **Archive / Unarchive** on the three lists and on both detail pages, **Show: Archived only** filter (`archivedFilter.ts`); Drivers lists only active and inactive; "Add driver" passes `startOnboarding`; `RowActionsMenu` accepts actions with `onClick`; client regenerated from the worktree's `openapi.json`; icon `check-circle.svg` from TailAdmin.
- **Verified:** migration run, revert, run, no drift; backend lint (3 old warnings), build, unit 276, e2e 440 (new `approved-archive.e2e-spec`: 24 cases; `application-approve` and `application-manual` rewritten for D80); frontend lint (2 old warnings), build. **UI walkthrough** (throwaway local admin, test applications, SMS `dry_run`): sidebar and page; approve creates no driver (dialog wording changed); Start onboarding lands on the new driver (Onboarding 0/3), who shows on Approved applications and not on Drivers; archiving an onboarding applicant archives the driver too, the **Archived only** filter and its chip list it, Unarchive brings it back (from the detail page); Archive / Unarchive an active driver from the Drivers row menu; console clean.
- **Archived rows read "Archived · was Active"** (Abulkalam, 2026-10-25, after seeing an archived driver badged Active): `ArchivedBadge` in `ApplicationStatusBadge` and `DriverStatusBadge`; checked in the browser on Drivers and Approved applications.
- **Not done:** B100 items 5, 5b, 6 (ledger charge column and deposit card, leaving options and Collections, more onboarding steps); bulk archive; the check on staging after deploy.
- **Before deploy:** backend then frontend as always; one migration (adds two nullable columns, no data change). **Shared files with the ledger feature (slot 3):** `drivers.service.ts`, `DriverDetail.tsx`, `schema.d.ts`, `openapi.json`; whichever merges second merges `dev` first and regenerates the client. The two rows B100 and B101 were uncommitted in the main checkout's `BACKLOG.md`: they are carried in this branch's `BACKLOG.md`; discard or merge that local edit when this merges.

---

### 2026-10-24 — Quick fixes: no login text on approval, admin-added drivers approved on save (D78, D79, B99)
- **Branch** `fix/quick-fixes` in both repos, worktrees `wt-quick-fixes-backend` / `-frontend` (slot 2: backend :5002, frontend :5175, databases
  `car_rental_quick_fixes` / `_test`). Rebased on `origin/dev` `693a451` (backend) / `08698b1` (frontend) on 2026-10-24. Merged into `dev` 2026-10-24 (backend PR #34 `595d997`, frontend PR #25 `c7ed624`).
- **Backend:** `approve()` sends only the approval text (login text paused, D78; `driver-welcome.text.ts` kept, unused); `ConfigService` removed from
  `ApplicationsService`. `createManual()` approves what it saves (D79): `assertCanBecomeDriver` (shared with `approve`) and a textable-phone check run
  before files are stored; a failed approval leaves the application pending ("Application saved, but not approved: ...") and a repeat of the same
  `request_id` retries it; the response has `driverId`. `openapi.json` re-exported. No migration.
- **Frontend:** "Add driver" button on the Drivers page (route `/admin/drivers/new`, the same form as "Add application", both approve; lands on the new
  driver's page); drivers lists refreshed after saving; Settings text no longer promises a second text; `schema.d.ts` regenerated from the worktree's
  `openapi.json`.
- **Verified:** backend lint (3 old warnings), build, unit 276, e2e 407 (approve: one text, no password; manual: approved on save, duplicate email / phone
  and bad phone store nothing, approval failure then retry); frontend lint, build. **Not done:** UI walkthrough in the browser; real `live` send.
- **Note:** drivers approved now cannot log in (B99).
- **Deployed to staging 2026-10-24** (by the deploy steps, backend then frontend): backend `595d997`, frontend `c7ed624`. No new migration ("No migrations are pending"); both deployments SUCCESS, backend started with no errors in the log, frontend login page 200, backend `/docs` 200 and `/applications` 401 without a token. Staging `SMS_MODE` is `live`: a test "Add driver" there sends a real approval text.

---

### 2026-10-24 — Signed files saved soon after the signing (D77)
- **Branch** `feature/contracts-save-files` in both repos (slot-1 worktrees `wt-contracts-fixes-backend` / `-frontend`, removed after the merge). **Merged into `dev` 2026-10-24 (backend PR #33 `693a451`, frontend PR #24 `08698b1`); deployed to staging 2026-10-24 (staging is now at the quick-fixes deploy, backend `595d997`, frontend `c7ed624`, which contains it).**
- **Why:** on staging the signed contract waited for the 5-minute job ("being saved" for up to 5 minutes, and the page did not refresh).
- **Backend:** `ContractTrackingService.saveDocumentsSoon` (tries after 30 s, +30 s, +60 s; one loop per contract; never throws) called by the firma webhook
  when a contract turns signed, not awaited; the job is unchanged and stays the fallback. **Frontend:** the contract query looks again every 15 s while
  a signed contract's files are not saved.
- **Verified:** backend lint (same 3 old warnings), build, e2e `contracts-track` 42 (6 new: first try, second try, gives up and the job still saves,
  skipped cases, one loop per contract, the webhook answers at once); frontend lint (2 old warnings), build. Full unit and e2e re-run before the PR.
- **Not done:** the timers are in memory, so a restart inside the first 2 minutes leaves it to the job; no migration. The staging check (sign a contract, the page shows "saved on file" within about a minute without a reload) is Abulkalam's to confirm.

---

### 2026-10-24 — Contract fixes and the California contract (D76, B95, B98)
- **Branch** `feature/contracts-fixes` in both repos, worktrees `wt-contracts-fixes-backend` / `-frontend` (slot 1: backend :5001, frontend :5174,
  databases `car_rental_contracts_fixes` / `_test`). **Merged into `dev` (backend PR #32 `5953e67`, frontend PR #23 `d1529ea`); deployed to staging 2026-10-24, a California contract sent from the staging UI to a temp inbox, signed and filed.**
- **Why:** the first signed contract on staging had stray marks (", ," ". ."), a ragged disclosure table, wrapped lines, an empty "Driver License"
  page, and California was refused. Spike first (S1-S6, D76): firma never removes marker text (the box is the only cover), left-aligns text, keeps
  spaces, shrinks too-long text; `pdf-lib` and `sharp` are safe; an 11.5 MB PDF is refused.
- **Backend:** per-state templates (`template-kit.ts`, `contract-template.ts`, `templates/illinois-placements.ts` / `california-placements.ts`,
  `california-lease.pdf`, a new `illinois-lease.pdf`); distinct and shorter markers; boxes that cover whole markers; amounts right-aligned by padding;
  `contract-licence.ts` (`placeLicence`: pdf-lib + sharp); `FileStorage.get` (+ S3 and the test fakes); `ContractsService.sendForSigning` picks the
  template by the company's state and draws the application's licence (409 / 502 / 503 as in D76); `sentValues.licenseDocumentId`; `pdf-lib` and
  `sharp` added; `openapi.json` re-exported. No migration.
- **Frontend:** `schema.d.ts` regenerated from the worktree's `openapi.json`; one comment. The send error shows the API's own sentence, so the
  licence messages need no screen change.
- **California:** from the client's sample by a script that prints counts only; no real value left (checked); the rate split is the same as Illinois
  (checked line by line, D71 follow-up in D76). Source: the client's California sample and Abulkalam's decision (MODULE2_SPEC Sources).
- **Verified:** backend lint (same 3 old warnings), build, unit 276, e2e 404 (send: California sends with its own anchors, a state without a template
  is refused, the licence is drawn / missing / pending / unreadable / bucket down / no bucket); frontend lint (2 old warnings), build. **Real test-mode
  sends** (firma test key, made-up data, signed on firma's page, PDFs read): Illinois and California, 41 of 41 anchors accepted with no warning; every
  value lands where asked; no stray mark; amounts right-aligned; one line each for the licence, vehicle, plate and email lines; the licence picture in its
  slot; Illinois email and phone keep their 1.55% / 1.64% shift, California none. **UI walkthrough** (local backend :5001 and frontend :5174, throwaway admin, two fake drivers, local MinIO, firma test key): a driver with no licence file gets "The driver's licence is not on file: add it to the application first." in the send dialog and nothing reaches firma; a driver with a licence sends a California contract ("Sent for signing", `california-lease.pdf`, `licenseDocumentId` saved); console shows only the expected 409 / 502.
- **Not done:** HEIC licences are refused with a message (B98); the licence picture is not encrypted (B94); Tennessee has no template; the check on staging after deploy. Docs: D76, B95, B91, B93, B98, MODULE2_SPEC Sources.
- **Before deploy:** backend then frontend as always; no migration; `S3_*` must be set (the licence is read from the bucket).
- **Shared files:** backend `contracts.*`, `contract-template.ts` and the new files, `sms/storage/*`, five e2e fakes, `openapi.json`, `package.json`;
  frontend `schema.d.ts`, `contracts.queries.ts`. The ledger work (slot 3) touches none of them.

---

### 2026-10-24 — Staging deploy of Module 2 steps 3 and 4
- Backend `73e6c1e`, frontend `71aa5aa` deployed to staging by hand from `dev`; `FIRMA_API_KEY` (test key) and `FIRMA_WEBHOOK_SECRET` set, the
  webhook created in firma (`https://backend-production-1f569.up.railway.app/webhooks/firma`; viewed, completed, expired, cancelled, recipient declined).
- **Verified by Abulkalam:** a contract for Saad's email was sent, signed, the status and the signed files followed, "Contract signed" ticked by itself,
  **the real webhook worked**. Found afterwards: the cosmetic problems fixed in the entry above.

---

### 2026-10-21 — Module 2 step 4: track a sent contract and file the signed copy (D75, B96)
- **Branch** `feature/contracts-track` in both repos, worktrees `wt-contracts-track-backend` / `-frontend` (slot 3: backend :5003, frontend
  :5176, databases `car_rental_contracts_track` / `_test`). **Merged into `dev` (backend PR #31 `73e6c1e`, frontend PR #22 `71aa5aa`); deployed to staging 2026-10-24, the real firma webhook verified.**
- **Spike first (passed, plan corrected, all in D75):** firma's `status` is flags; "viewed" is visible by polling (`/audit`, first signer
  `document_viewed`); the PDF links need no key, work 1 hour and fill about 20 seconds after signing; declined, cancelled and expired seen.
- **Backend:** migration `AddContractTracking` (5 statuses, `status_updated_at`, `signed_at`, `signed_pdf_key`, `certificate_key`,
  `documents_error`, CHECK `contracts_documents_shape`); `FirmaClient.getSigningRequest` + `download`; `nextContractStatus` (forward only, end
  states fixed); `ContractTrackingService.refreshFromFirma` (one place that decides), `saveDocuments`, `getDocuments`;
  `DriversService.recordContractSigned` (system tick, same transaction); `ContractTrackingJob` (every 5 minutes, advisory lock
  `7_302_003`); `POST /webhooks/firma` (signature `X-Firma-Signature`, trigger only); `GET /contracts/:id/documents`; `FIRMA_WEBHOOK_SECRET`
  (optional); `ContractDto` gains `statusUpdatedAt`, `signedAt`, `documentsSaved`, `documentsError`; `openapi.json` exported.
- **Frontend:** a banner per status on the contract page (sent, opened, signed with **Open signed contract** and **Certificate**,
  declined, expired, cancelled), the contract page refreshes every 30 s while it waits, the driver's Contract card shows status, date and
  **Open signed contract**, the Onboarding row says "automatic, from the signed contract"; client regenerated from the worktree's `openapi.json`.
- **Verified:** migration run, revert, run, no drift; backend lint (3 old warnings), build, unit 249, e2e 397 (new `contracts-track.e2e-spec`:
  webhook good / bad / old-secret / no-secret / unknown id / not-ours events, status moves, replay changes nothing, the job catches missed
  finished, declined, expired, signed never turns expired, files saved once, retried when links are empty, failed download recorded and
  cleared, not a PDF, no bucket, tick: system, admin's earlier tick kept, inactive driver stays inactive, webhook + job at once = one tick,
  rollback when the tick fails, documents links, admin-only route); frontend lint (2 old warnings), prettier, build. **Real test-mode
  walkthrough** (throwaway local admin, drivers "Sim ...", made-up values, firma test key): send; the job showed "Opened by the driver" (firma's
  own time) after the page was opened; signed on firma's page, the next job run marked it `signed` and saved both files, the page showed
  "Signed on ..." with working links (the saved PDF opens: 7 pages, values filled, test watermark), the driver's step ticked "automatic",
  card shows Signed; declined and cancelled banners; a signed `curl` webhook (made-up secret) marked a real just-signed contract `signed` within
  seconds, the same event again changed nothing, a wrong secret and no header gave 401, an unknown request and a non-signing event gave 200
  "ignored"; logs hold only ids and statuses. Expiry: a request with a 1-hour expiry showed `expired: true` right after `expires_at` (D75).
  Console clean; the repeated refetches seen in the pane come from window focus (`refetchOnWindowFocus`) flapping in the pane, also on the drivers list.
- **Not done:** cancel / resend from our app, reminders (B96); the real firma webhook cannot reach a laptop: set it up on staging (B96 item 4,
  `FIRMA_WEBHOOK_SECRET`). The walkthrough sent test-mode emails to the developer's address (the first contract) and to `example.test` addresses.
- **No timestamp tolerance** on the webhook signature (firma does not say whether retries are re-signed): see D75.
- **Before deploy:** `FIRMA_WEBHOOK_SECRET` in Railway staging, the webhook created in firma with its master switch on, `S3_*` present; `FIRMA_API_KEY` as for step 3.
- **Shared files:** backend `contracts.*`, `contract.entity.ts`, `dto/contract.dto.ts`, `firma/*`, `drivers.service.ts` / `drivers.module.ts`,
  `env.validation.ts`, `.env.example`, `openapi.json`, the migration, docs; frontend `schema.d.ts`, `queryClient.ts`, `contracts.queries.ts`,
  `ContractDraft.tsx`, `DriverDetail.tsx`. No other feature in flight. Local only: the worktree `.env` holds a throwaway admin and a made-up webhook secret.

---

### 2026-10-21 — Module 2 step 3: send a contract for signing (D74, B95)
- **Branch** `feature/contracts-send` in both repos, worktrees `wt-contracts-send-backend` / `-frontend` (slot 3: backend :5003, frontend
  :5176, databases `car_rental_contracts_send` / `_test`). **Merged into `dev` (backend `556f082`, frontend `eedf3d0`); deployed to staging 2026-10-24 with step 4.**
- **Spike first (passed):** five anchors on the real PDF with the firma test key, then the full build. Findings and firma's limits are in D74.
- **Template:** the Ashwood PDF with markers, stored at `src/contracts/templates/illinois-lease.pdf` (copied into `dist` by `nest-cli.json`
  `assets`). Its last page held a real driver's licence photo as an image: removed before storing (checked, no image data or personal text left).
- **Backend:** `src/firma/` (`FirmaClient` interface, `FirmaHttpClient`, `FirmaError`; same pattern as Quo); `FIRMA_API_KEY` optional in
  `env.validation.ts` and `.env.example`; migration `AddContractSending` (status `sent`; `sent_at`, `sent_by_id`, `firma_signing_request_id`,
  `sent_values`; CHECK `contracts_sent_shape`; unique index on the firma id; `contract_companies.state`); `contract-values.ts`,
  `contract-template.ts` (placements measured from the PDF); `ContractsService.sendForSigning` (transaction with a row lock);
  `POST /contracts/:id/send`; `GET /drivers/:driverId/contract` replaces `contract-draft`; `ContractDto` gains `sentAt` and `sentValues`;
  `openapi.json` exported.
- **Frontend:** "Send for signing" button (enabled once the draft is saved and unchanged) with a confirm dialog (a refusal shows the list
  of empty values, or firma's message); a sent contract is read-only with a green "Sent on ... to ..." banner; the driver's Contract card
  shows "Sent <date>"; `useDriverContract`, `useSendContract`; client regenerated from the worktree's `openapi.json`.
- **Verified:** migration run, revert, run, no drift; backend lint (3 old warnings), build (template present in `dist`), unit 184, e2e 361
  (new: `contracts-send.e2e-spec` 32 tests: sends once and freezes, two at once = one firma call, 503 without a key, 404, Californian
  company 409, each empty value named, firma failure leaves a draft and can be retried, frozen contract refuses edit and delete, the
  CHECK and the unique index); frontend lint (2 old warnings), prettier, build. **Real test-mode walkthrough** (throwaway local admin,
  driver "Sim Tester" with your own email, made-up values): the page, refusal with "Vehicle VIN, Date of birth", fill and save, firma's
  refusal shown in the dialog (found the same-page duplicate limit), send (200), banner and read-only form, driver card "Sent ...", the
  firma request with 41 fields (one per marker occurrence, every value right), signed on firma's page, firma shows `finished`. Layout
  checked on three more email-less requests (`send_signing_email: false`) with short and very long values.
- **Not done:** nothing is tracked after sending (step 4); cosmetic marks beside the repeated markers and the open items in B95;
  the signing page was checked in the pane only (not on a phone). The spike and the walkthrough sent real test-mode signing emails (and firma's finish email) to the developer's address.
- **Before deploy:** set `FIRMA_API_KEY` (test key) in Railway staging; no other new setting.
- **Shared files:** backend `contracts.*`, `contract*.entity.ts`, `dto/contract.dto.ts`, `env.validation.ts`, `.env.example`, `nest-cli.json`,
  `openapi.json`, the migration; frontend `schema.d.ts`, `queryClient.ts`, `contracts.queries.ts`, `ContractDraft.tsx`, `DriverDetail.tsx`.
  No other feature in flight. Local only: `.claude/launch.json` in the workspace root now starts the slot 3 `contracts-send` servers.

---

### 2026-10-21 — Module 2 step 2: contract details (D73, B93, B94)
- **Branch** `feature/contracts-details` in both repos, worktrees `wt-contracts-details-backend` / `-frontend` (slot 3: backend :5003,
  frontend :5176, databases `car_rental_contracts_details` / `_test`). **Not committed, not merged, not deployed.**
- **Backend:** table `contract_companies` (`name`, `address`; no state, no active flag) seeded with the five "Lessor:" lines by migration
  `AddContractDetails`; ten optional columns on `contracts` (company FK, vehicle model / VIN / plate / plate state, purchase option cents,
  address, licence number, licence state, date of birth); `GET /contracts/companies`; `POST /contracts/calculate` now takes only the
  numeric fields (`ContractNumbersInputDto`), the saved draft takes the details too (blank = nothing, trimmed, length limits, a real date
  of birth, a whole non-negative purchase option, a company from the list). `openapi.json` exported. No format rules, caps or prefill (D73).
- **Frontend:** three cards on the contract page (Company with its address under the choice, Vehicle with the purchase option price,
  Driver details); `ContractCard` shared; `useContractCompanies`; `readContractForm` also returns `numbersInput`, so typing a detail never
  asks for new numbers; client regenerated from the worktree's `openapi.json`.
- **Docs:** `MODULE2_SPEC.md` step 2 row fixed and a new section 4 "Sources" (flow, step 1 fields, step 2 fields; step 1's caps and the
  one-draft index listed as "our suggestion"); D73; B93 (companies screen, CA / TN rows); B94 (encrypt licence number and date of birth).
- **Verified:** migration run, revert, run, and `migration:generate` finds no drift; backend lint (3 old warnings), build, unit 149, e2e 329
  (23 new in `contracts.e2e-spec`: the five companies, save and reload, update clears, unknown company, trimming, no format rules, 13
  refusals, edges, the drivers list and driver page hold no licence number or date of birth, a used company cannot be deleted); frontend
  lint (2 old warnings), prettier, build. Real requests: `GET /contracts/companies` and `POST /contracts/calculate` give 401 without a
  login. **Browser** (throwaway local admin, driver "Sim Test", made-up values only): three cards; five companies, the two Gonzo ones told
  apart by address; "abc" as purchase option marks the box and blocks Save; nine detail edits send no extra `calculate`; save (201), reload
  keeps every value, database row correct (`2500000` cents); phone width with no sideways scroll; delete; driver page shows no licence number
  or date of birth. Console clean, no failed requests.
- **Not done:** nothing is sent to firma (steps 3, 4). A company cannot be un-chosen once chosen (the list has no empty option); only
  changed to another. Workspace `CLAUDE.md` "Current focus" to update when merged.
- **Local only:** `.claude/launch.json` in the workspace root (not in either repo) starts the two slot 3 servers; the worktree `.env` holds
  a throwaway admin (`qa-admin@test.local`), not Abulkalam's.
- **Merge order / shared files:** no other feature in flight; backend first, then frontend. Backend shared: `contracts.module.ts`,
  `data-source.ts`, `openapi.json`, `contracts.service.ts`, `contracts.controller.ts`, `contract.entity.ts`, `dto/contract.dto.ts`, the
  migration, the docs. Frontend shared: `schema.d.ts`, `queryClient.ts`, `ContractDraft.tsx`, `contractForm.ts`, `contracts.queries.ts`.

---

### 2026-10-20 — Staging deploy: contract draft and rate calculator (Module 2 step 1, D71)
- **Merged:** backend PR #26 (`8a823bc`) and frontend PR #19 (`9166de4`) into `dev`, branch `feature/contracts`.
- **Deployed** to Railway staging by hand from the `deploy-*` worktrees (detached at `origin/dev`, clean): backend `8a823bc`,
  frontend `9166de4`. The pre-deploy step ran migration `CreateContracts` (confirmed in `railway logs`).
- **Checked on staging (read only):** frontend `/admin` 200, backend `/docs` 200, `POST /contracts/calculate` without a token 401;
  the new routes are mapped; the frontend bundle contains the contract page; no errors in the backend logs.
- **Not done:** nothing was written on staging (no draft created). Next: step 2 (company, vehicle, purchase option, B91).

---

### 2026-10-20 — Module 2 step 1: contract draft and rate calculator (D71)
- **Branch** `feature/contracts` in both repos, worktrees `wt-contracts-backend` / `-frontend` (slot 3: backend :5003, frontend
  :5176, databases `car_rental_contracts` / `_test`). **Not committed, not merged, not deployed.**
- **Backend:** new `src/contracts/` (entity, `contract-math.ts`, DTOs, service, controller, module); migration `CreateContracts`
  (table, two enums, CHECKs, partial unique index `contracts_one_draft_per_driver`; reverts cleanly); five routes (calculate, get
  draft, create, update, delete); `openapi.json` exported. The calculated numbers are not stored.
- **Frontend:** page `drivers/:id/contract` (inputs left, live "Lease disclosure summary" right, Save / Delete draft), a Contract
  card on the driver page, `contracts.queries.ts` (numbers debounced 300 ms), `useDebouncedValue`; client regenerated from the
  worktree's `openapi.json` (the npm script reads the main checkout's).
- **Verified:** backend unit 147, e2e 240 (22 new: numbers, one draft per driver, two creates at once = one draft, update, delete,
  404s, DTO limits, database CHECKs), lint and build clean; frontend lint, prettier, build clean. Browser (test driver "Sim Test"):
  weekly $399 + $200 deposit gives 167.58 / 119.70 / 51.87 / 39.90 / 19.95 and $599 due at pickup; daily $61 gives 25.62 / 18.30 /
  7.93 / 6.10 / 3.05; bad total shows a hint and clears the summary; save, card line, reopen, edit ($250 gives $649), delete, card
  back to "Create contract"; no failed requests.
- **Not done:** company, vehicle and purchase option (step 2); nothing is sent to firma (steps 3 and 4). Totals follow our reading
  until the client corrects it (B91 question 2).
- **Merge order / shared files:** `app.module.ts`, `data-source.ts`, `openapi.json`, frontend `schema.d.ts`, `App.tsx`,
  `DriverDetail.tsx` (the add-driver branch also touches `App.tsx`; the second to merge merges `dev` first and re-runs
  `openapi:export` + `api:generate`).

---

### 2026-10-20 — Staging deploy: add an application by hand, payment aliases (B85, B52, D68, D69)
- **Merged:** backend PR #24 (`14128c4`) and frontend PR #18 (`fe5021c`) into `dev`.
- **Deployed** by Abulkalam with the Deployment steps from the `deploy-*` worktrees (detached at `origin/dev`): backend
  `14128c4`, frontend `fe5021c`. The deploy also carried the ledger page work already on `dev` (D64-D67; migrations
  `LedgerPageRefsAndManualPayments`, `LedgerNotes`, `CreateLedgerPresets`) together with `AddManualApplications`.
- **Checked on staging (read-only, signed in as `admin@admin.com`):** the Applications list has "Add application"; the form
  page has the three sections and no vehicle field; the API returns `origin` / `uploadedByEmail` on documents,
  `createdBy` on an application and `id` on aliases (so the migration ran); an empty `POST /applications/manual` and an
  empty `POST /drivers/:id/aliases` answer 400 and create nothing; a real driver's page shows its Zelle alias with a remove
  button and the add form with the seven methods. `GET /sms/status`: `live`, Quo and the file bucket configured.
- **Not checked on staging:** a real save. Staging texts are `live`, so a test application sends a real alert text to the
  staff number (D53), and approving one texts its phone; the client tests it by hand. Locally the whole flow (save, files,
  replace, approve, aliases) was walked through (see the two entries below).
- **Local clean-up still to do (only when asked):** worktrees `wt-manual-add-driver-backend` / `-frontend` and the
  databases `car_rental_manual_add_driver` / `_test`.
- **Next:** rent billing (M2).

---

### 2026-10-20 — Payment aliases on the driver page: add and remove (B52, D69; part 2 of B85)
- **Branch** `feature/manual-add-driver` (same PRs as part 1: backend #24, frontend #18), as separate commits.
- **Backend:** `POST /drivers/:id/aliases` ({ type, value }) and `DELETE /drivers/:id/aliases/:aliasId`, both return the
  updated driver; `DriverAliasDto.id`. Saved as `manual`, normalised as matching compares them (case, spaces, `$` / `@`,
  phone as `+1XXXXXXXXXX`, email lower-case); a US-phone / email format check; `409` when the driver has it already, or
  when another driver has it (the message names them; an alias belongs to one driver). Removal works on any source.
  The admin and the change go to the server log (there is no audit-log table yet).
- **Frontend:** `DriverAliasesCard` on the driver page: chips per payment method with a x (confirm dialog), an "Add an
  alias" form (method, name or handle) with the API's message shown under it; damaged imported aliases are in a
  collapsible list and can be removed.
- **Verified:** 17 new tests (`driver-aliases`), the drivers-list test updated for the new `id`; backend lint, build,
  all unit + e2e pass; frontend lint (2 old warnings) and build. Browser: add (spaces tidied), same alias again, bad
  phone and email, empty, another driver's alias (names Browser Tester), same text under another method allowed, remove
  with cancel and confirm.
- **Not done:** moving an alias between drivers (B54); re-matching payments already in "Needs review" after adding an
  alias (matching tries each payment once); driver-added aliases with approval (B53, needs the driver portal).

---

### 2026-10-19 — Add an application by hand, with documents (B85 part 1, D68)
- **Branch** `feature/manual-add-driver` in both repos, worktrees `wt-manual-add-driver-backend` / `-frontend` (slot 1:
  backend :5001, frontend :5174, databases `car_rental_manual_add_driver` / `_test`; the main `.env` copied with intake
  off and `MAIL_MODE=log`). PRs: backend #24, frontend #18 (into `dev`).
- **Backend:** migration `AddManualApplications` (`applications.created_by_id`; `application_documents.origin` /
  `uploaded_by_id`, `source_path` nullable, CHECK `application_documents_origin_shape`; `down()` refuses while admin
  uploads exist). `POST /applications/manual` (admin only, multipart: the website form's fields plus `license_file`,
  `rating_file`, `earnings_file`; same `request_id` twice = one application). `PUT /applications/:id/documents/:kind`
  fills or replaces a slot, a website copy included. File type by the first bytes (JPG/PNG/PDF), 10 MB, one plain error
  sentence (multer's 413 turned into 400). The document copier's updates are now conditional, so a slow copy never
  overwrites an admin upload. `ApplicationDetailDto.createdBy`; `ApplicationDocumentDto.origin` / `uploadedByEmail`;
  `@types/multer` added and `"multer"` in `tsconfig.json` `types`. Approve/reject return the detail through `findOne`
  (so `createdBy` is there).
- **Frontend:** page `/admin/applications/new` (one form, four cards, the website's questions and rules; "Add
  application" button on the list); Documents tab shows all three slots with Upload / Replace (replace asks first) and
  "Uploaded by"; "Added by" in the Submission card; lease length shows the words for `mediano` / `largo`. TailAdmin
  pieces copied: FileInput, Radio, DatePicker (single day), plus.svg.
- **Verified:** backend lint, build, 120 unit + 201 e2e (new: 36 in `application-manual`, 6 upload cases and the CHECK in
  `application-documents`, `sniff-file-type`); migration run, revert, run, no drift. Real HTTP on :5001 with curl:
  valid submit, repeat, no licence, text-as-PNG, 11 MB, replace, 401 without a login. Frontend lint (2 old warnings),
  build. **Browser walkthrough** (signed in with a throwaway local test admin `qa-admin@test.local` that exists only in
  the worktree database, not Abulkalam's account): list button; empty Save marks 18 answers and sends nothing; age 24 and
  ZIP 123 marked; a text file named .png refused with the server's sentence; a fake applicant with a real PNG and a PDF
  saved and opened ("Added by", Driving / Rental tabs like a website one, both files open); replace licence (confirm
  dialog, cancel sends nothing); upload into an empty slot; upload onto an older application; approve → driver
  `onboarding` with a login and two dry-run texts; mobile width. The walkthrough found one bug (the form's data was not
  sent: with `body` left out `openapi-fetch` sends nothing), fixed. Console: only the expected 400s and one 401 at sign-in.
- **2026-10-20 follow-up (Abulkalam: "use only the website's fields"):** walked through the live gonzocar.com form
  with fake data, stopped before Submit (3 steps, not 4). Changes: vehicle preference removed; violations / accidents
  are 0, 1, 2, 3+ (backend rule and page); the start-up amount only appears, and is then required, when funds = No
  (backend `ValidateIf`; dropped from the stored payload when funds = Yes); the page is three numbered sections in the
  website's order with inline errors (leave a field → error under it; fixes clear it live); labels as on the website.
  Backend 120 unit + 208 e2e pass, lint and build clean; frontend lint (2 old warnings) and build clean; browser check:
  age 24 → "Must be 25 or older", phone "Need 10 digits", skipped ZIP "Invalid ZIP code", error clears when fixed, amount
  field only for No, a `3+` / Long term / capital 400 application saved and shown correctly.
- **Left in the worktree database only:** the fake applicants `Browser Tester` (approved, a driver) and `Qa Tester`; fake
  files in the local MinIO bucket under their application ids.
- **Not done:** B89
  (website earnings files are lists and are not copied). Not deployed. Workspace `CLAUDE.md` "Current focus" to be
  updated when merged.
- **Merge order:** backend PR first (the frontend client is generated from it). New migration runs on deploy. Shared
  files if another branch touches them: `applications.service.ts`, `ApplicationsList.tsx`, `ApplicationDetail.tsx`,
  `ApplicationDocuments.tsx`, `src/api/schema.d.ts`, `App.tsx` (merge `dev` first, then `npm run api:generate`).

### 2026-10-20 — Module 2 (contracts) planned: firma.dev, four steps (D70, D71, B91, B92)
- **Branch** `feature/contracts`, worktree `wt-contracts-backend` (docs only so far). Not committed.
- **Docs:** new `MODULE2_SPEC.md` (what the client uses today, four steps, three open questions); D70 (firma.dev chosen
  over DocuSeal, PandaDoc and signNow); D71 (rate calculation from the client's Illinois sheet); B91 (client questions),
  B92 (confirm firma prefill).
- **Research inputs:** five sample contracts and the Illinois rate sheet (Google Docs/Drive, real driver data, not stored in
  the repo); pricing pages of DocuSeal, PandaDoc, signNow, firma.dev.
- **Next:** step 1, the rate calculator (plan in this chat; slot 3 when built: backend :5003, frontend :5176, databases
  `car_rental_contracts` / `_test`).

---

### 2026-10-19 — One ledger, no Weekly/Monthly tabs, amount search (B86, D67)
- **Branches:** backend `fix/ledger-amount-search`, frontend `fix/one-ledger` (from `origin/dev`). Not merged, not deployed. The
  modal height fix is a separate frontend PR (#16, `fix/modal-max-height`).
- **Backend:** the ledger search also matches an amount (`parseAmountToCents` in `src/common/money.ts`; exact cents, no floats);
  one new e2e test, unit tests for the parser; e2e 218, unit 134, lint and build clean; `openapi.json` (one comment) exported.
- **Frontend:** removed the ledger card from the driver detail page (a "View ledger" button replaces it) and the Weekly / Monthly
  tabs from the ledger page; deleted `LedgerCard`, `LedgerSummaryTab` and the old paged-list and summary hooks; search hint now
  says "Search text, amount ($85) or CH-1042". Prettier, lint, build clean; checked in the browser (local copy database).
- **Not done:** the backend `/ledger/summary` route is kept, unused.

---

### 2026-10-19 — Staging deploy: driver ledger page (B79, B86, D64–D66)
- **Merged into `dev`:** backend PR #22 (`ebfdd18`), frontend PR #15 (`e13a38b`), branch `feature/ledger-page`. The three
  entries below (ledger page, dialog alignment, presets) say "not committed / not deployed": that is now out of date, they
  are merged and on staging.
- **Deployed** to Railway staging by hand: backend `ebfdd18`, frontend `e13a38b` (deploy folders on those commits, clean).
- **Migrations run by the pre-deploy step** (all three confirmed in `railway logs`): `LedgerPageRefsAndManualPayments`,
  `LedgerNotes`, `CreateLedgerPresets` (18 preset rows seeded).
- **Checked on staging, read only:** `/admin/drivers` has the "⋯" column (View ledger, View driver); a driver's ledger page
  loads real data (refs, running balance, aging tiles, totals); the + Charge window shows the 12 seeded charge cards; Settings
  lists 18 presets; no console errors; backend logs show no errors.
- **Not done:** nothing was written on staging (no charge, payment or preset change). The demo drivers exist only in the
  local copy database. Next feature: rent billing (M2, B88).

---

### 2026-10-19 — Configurable ledger presets (B86, D66)
- **Branch** `feature/ledger-page` (same worktrees, slot 2). **Not committed, not merged, not deployed.**
- **Backend:** new `src/ledger-presets/` (entity, service, controller `/ledger-presets`, DTOs); migration
  `CreateLedgerPresets` with the client's starting list (18 rows; reverts cleanly); 11 new e2e tests.
- **Frontend:** Settings card "Ledger presets" (add, edit, delete, up/down arrows) and the preset cards (name and amount) in
  the New ledger entry window, replacing the text chips; clicking a card fills the description and, when set, the amount.
- **Verified:** backend e2e 217 passed, unit 131, lint and build clean; frontend lint, prettier and build clean. Browser:
  Settings shows 12 charge and 6 credit presets; added "Test fee" $12.50, moved it up twice, changed it to $20, deleted it;
  window cards in the new order; "Late fee" fills 25.00 and "Late payment fee", "Toll" (no amount) leaves the amount;
  the credit tab shows only credit presets; "credit against a charge" shows no cards; no console errors.
- **Not done:** "Weekly rent" and "Day credit - vehicle down" presets (need the rate: M2, B88).

---

### 2026-10-19 — Ledger entry window aligned with the client's mockup (B86, D65)
- **Branch** `feature/ledger-page` (same worktrees, slot 2). **Not committed, not merged, not deployed.**
- **Backend:** migration `LedgerNotes` (`ledger_entries.internal_note`, `payments.description`, `payments.internal_note`, CHECKs);
  `internalNote` on manual entries and payments, `description` on payments; the payment credit copies the note and uses the
  description; search also finds notes; list, details and payment DTOs return them.
- **Frontend:** one `NewEntryDialog` (three tabs, mockup field order, Method chips, balance preview in the footer) replaces
  `AddLedgerEntryDialog` and `RecordPaymentDialog`; ✎ and the note in the table and details; the statement shows no note.
- **Verified:** backend e2e 206 passed, unit 131, lint and build clean; frontend lint, prettier and build clean. Browser:
  payment tab opens prefilled with $257.14 and "Owes $257.14 → Settled"; a charge with a chip, description and note shows
  ✎ and the note in the details; a cash payment with its own description and note; the statement has no note; the driver
  page's "Add entry" opens the same window; no console errors.
- **Demo data:** the slot-2 copy database now has extra entries on Andre Whitfield (a $85 flat tire and a $100 cash payment
  with notes) from this walkthrough.
- **Not done:** "Text the driver" checkbox (M6).

---

### 2026-10-19 — Driver ledger page and payments by hand (B86, B79, D64)
- **Branch** `feature/ledger-page` in both repos, worktrees `wt-ledger-page-backend` / `-frontend` (slot 2: backend :5002,
  frontend :5175, databases `car_rental_ledger_page` / `_test`). **Not committed, not merged, not deployed.**
- **Backend:** migration `LedgerPageRefsAndManualPayments` (`ledger_entries.entry_no` identity, `applies_to_id` + CHECK,
  `payments.manual_method` + CHECK; existing rows numbered in the order written, the append-only trigger did not block it).
  `GET /drivers/:id/ledger` with filters, refs, totals; `/overview` (aging, last payment); `/entries/:entryId`
  (details); credit against a charge (`appliesToId`, locked, limited); `POST /payments/manual`, `POST /payments/:id/void`.
  New: `aging.ts`, `ledger-ref.ts`, `common/money.ts`, `common/recent-day.ts`.
- **Frontend:** page `/admin/drivers/:id/ledger` (header, aging tiles, register with filters, details window, dialogs),
  statement page, ⋯ menu on the Drivers list (`RowActionsMenu`, portal), reason chips, payment dialogs, "Manual · Cash" on
  the Payments page. Layout fix: `min-w-0` on the content column (a wide table stretched the page); table card controls wrap.
- **Verified:** backend `npm run test:e2e` 198 passed (3 runs), `npm test` 131, lint and build clean; frontend lint, prettier
  and build clean. Browser walkthrough (built-in browser, local copy of the dev database, Abulkalam signed in): menu and
  row click, aging tiles ($25 / $85 / $300 at 40 days), search and URL, charge with a chip and a backdated running balance,
  credit against a charge (prefilled, over-limit refused, partial), reversing a charge with a credit refused, entry
  details and links, Zelle warning and the duplicate prompt, cash payment (on the Payments page as "Manual · Cash"), void
  (balance back), statement, sort toggle; no console errors. A real print preview was not tried (print rules checked in
  the stylesheet only).
- **Found and fixed on the way:** two simultaneous requests with the same key could answer "possible duplicate" instead of
  returning the one payment (the duplicate check now ignores the request's own payment); two sibling dialogs had the same
  React key.
- **Not done:** the mockup's billing parts (B88, with M2); manual-first, email-later double credit (B87); the table needs
  about 1,450 px before it stops scrolling sideways inside its card.
- **Shared files for the merge order:** `DriversList.tsx`, `App.tsx`, `src/api/schema.d.ts`, `openapi.json`,
  `payment.dto.ts` (B85 add-driver chat touches the first two). The branch merged second merges `dev` first and runs
  `npm run openapi:export` + `npm run api:generate`.

---

### 2026-10-19 — Staging deploy: "Live" badge removed (B84)
- **Merged:** backend PR #20 (`53598d8`, docs only) and frontend PR #14 (`5e68eee`) into `dev`.
- **Deployed** with the Deployment steps from the `deploy-*` worktrees: backend `53598d8` (2026-10-19 10:44 UTC), frontend `5e68eee` (10:49 UTC). Railway: both `SUCCESS`; backend log: no pending migrations, app started.
- **Verified:** staging site loads (200); the deployed bundle returns nothing for `live` in the chat card header and still has the "Dry run" badge. Not checked in a signed-in browser on staging.

---

### 2026-10-19 — Chat: "Live" badge removed (B84); attachments not possible with Quo (B83)
- **Done (frontend):** `ConversationCard` shows no badge in `live`; the dry-run and off warnings stay.
- **Not done:** sending files from the chat (B83): Quo's API cannot send media.
- **Verified:** frontend lint and build. Browser walkthrough 2026-10-19 (frontend on port 5175/5176, local backend in `dry_run`, signed in by Abulkalam): application and driver pages show the yellow "Dry run: texts are saved, not sent" badge in `dry_run`; with `/sms/status` reported as `live` (a throwaway local proxy, the backend never ran live) the chat header shows only avatar, name and phone, no badge; no console errors from the app. Not deployed.
- **Branch:** `fix/chat-live-badge` (frontend code, backend docs), worktrees `wt-chat-live-badge-*` (no database or ports needed).

---

### 2026-10-19 — Staging deploy: client revisions batch 2 (B81, B82, D62, D63)
- **Merged:** backend PR #18 (`0a22c82`) and frontend PR #13 (`2245c58`) into `dev`.
- **Deployed** with the Deployment steps from the `deploy-*` worktrees (detached at `origin/dev`, clean): backend
  `0a22c82` (2026-10-19 09:16 UTC), frontend `2245c58` (09:18 UTC). Railway `car-rental-staging`: both `SUCCESS`.
- **Checked:** backend log shows `MessageTemplatesList` executed and the app started, no errors; both sites answer 200;
  `GET /message-templates` without a token is 401. Not checked by hand: the Settings and dialogs on staging (the client
  edits the texts there).
- **Open:** B83, B84 (Quo chat), B85 (add driver with aliases); the client still has to write the real texts.

---

### 2026-10-19 — Client revisions batch 2: several approve/decline texts, date filters (B81, B82, D62, D63)
- **Branch** `feature/revisions-templates-filters` in both repos, worktrees `wt-revisions-templates-filters-backend` /
  `-frontend` (slot 1: backend :5001, frontend :5174, databases `car_rental_revisions_templates_filters` / `_test`).
- **Backend:** `message_templates` is a list (migration `MessageTemplatesList`, data kept as "Default"); routes
  `POST /message-templates`, `PUT`/`DELETE /message-templates/:id`; approve and reject take `{ message }` (`sendText`
  removed); `?from&to` on the four lists (`src/common/date-range.ts`, `DateRangeQueryDto`).
- **Frontend:** Settings with a list of texts per kind; shared `ReviewTextDialog` for Approve and Decline (pick, edit,
  send); `DateRangePicker` (flatpickr, TailAdmin calendar styles), `ActiveFilters` bar, `useListParams` with
  `from`/`to`/`clearAll`; TailAdmin `Select` copied in.
- **Verified:** backend 118 unit + 159 e2e pass (new: template list, approve/decline with message, date ranges around
  Chicago midnight in summer and winter), lint and build clean; browser walkthrough on :5174 (Settings add, duplicate
  name 409, Approve and Decline dialogs, a decline with an edited text shown in the chat, date picker, chips and Clear
  all on all four lists).
- **Not done:** not committed beyond the first backend step, not pushed, no PRs. Revisions 3-5 (B83 attachments, B84
  remove "Live", B85 add driver with aliases) go to other chats. Client still has to write the real texts on staging.
- **Merge order:** this branch before B85 (both touch the Drivers list). New migration `MessageTemplatesList` runs on
  deploy.

---

### 2026-10-18 — Driver ledger wrapped up; next: rent billing (M2)
- **Cleanup:** the `wt-backend` / `wt-frontend` worktrees and their local branches removed (all merged into `dev`);
  their local databases `car_rental_ledger` / `_test` dropped. The main local database `car_rental_db` was migrated
  (`CreateLedgerEntries`) and backfilled (31 payments credited).
- **Open from the ledger (BACKLOG):** B78 driver portal view, B79 record a cash payment, B80 old ledger import.
- **NEXT (new chat "05 - Rent billing (M2)"):** plan first (plan mode): billing fields on drivers (`billingType`
  daily/weekly, `billingRateCents`, `billingDueWeekday`, `billingActive`), a daily job in America/Chicago with an
  advisory lock that writes `rent` ledger debits with key `rent:<driverId>:<date>` for `active` drivers only, days late
  per spec 7, and the switch to turn it off.

---

### 2026-10-17 — Staging deploy: driver ledger (B77, D60, D61)
- **Merged:** backend PR #15 (`4fff3d9`) and frontend PR #12 (`69320cb`) into `dev`.
- **Deployed** with the Deployment steps from the `deploy-*` worktrees: backend `4fff3d9` (2026-10-17 18:45 UTC),
  frontend `69320cb` (18:47 UTC). Railway: both `SUCCESS`; backend log: `CreateLedgerEntries` executed (table and both
  triggers), app started.
- **Backfill on staging** (`railway ssh --service backend -- node dist/ledger/ledger-backfill.js`): dry run 65 confirmed
  payments without a credit; `--apply` credited 65 of 65; a second dry run found 0.
- **Verified:** `GET /drivers/:id/ledger` and `/ledger/summary` answer 401 without a login (deployed, admin only), an
  unknown route 404; the frontend loads. Not checked in a signed-in browser on staging yet.

---

### 2026-10-17 — Driver ledger (B77, D60, D61)
- **Done (backend):** migration `CreateLedgerEntries`: `ledger_entries` (direction, cents, kind `rent | payment |
  adjustment | reversal`, reason, `effective_date` as a Chicago day, unique `idempotency_key`, unique
  `reversal_of_id`, CHECKs for shapes and amount range) plus two
  triggers: `ledger_entries_append_only` (refuses UPDATE/DELETE) and `ledger_entries_check_reversal` (same driver and
  amount, opposite direction, never a reversal of a reversal). `LedgerModule`: `POST /drivers/:id/ledger/entries`
  (charge or credit, amount, date, reason; request key; today to 90 days back; $10,000 max; no categories, D61), `POST …/entries/:entryId/reverse`,
  `GET /drivers/:id/ledger` (newest first, running balance), `GET …/ledger/summary?period=week|month` (Monday weeks,
  calendar months, empty periods, opening/closing chain). `syncPaymentCredit` runs inside the payment's transaction in
  `PaymentsService.assign` and `MatchingService` (reassignment = reversal + new credit). `DriverDto.balanceCents`.
  `npm run ledger:backfill` (dry run; `-- --apply` writes) credits payments confirmed before the ledger existed.
- **Done (frontend):** Ledger card on the driver page (balance "Owes / In credit / Settled", Add entry dialog: charge
  or credit, amount, date, reason, summary line; Entries tab with running balance and Reverse dialog, Weekly and Monthly tabs);
  Balance column on the Drivers list; shared `BalanceText`; assigning a payment refreshes the ledger.
- **Verified:** migration run, revert, re-run and no drift on a separate local database (`car_rental_ledger`); SQL
  checks of the triggers and constraints; backend lint, 118 unit + 140 e2e (22 ledger tests: reversals incl. two at
  once, append-only, request key, dates, charge/credit sign, payment credit A → B → A, matching, backfill twice, running
  balance, week/month/daylight-saving boundaries); frontend lint + build. Backfill on a fresh local copy: 31 payments,
  $4,251.00 (= all confirmed payments), second run 0. Browser walkthrough on a fake driver in the local copy (2026-10-17, after merging `dev`): empty ledger, form
  validation, late fee, a repair backdated to Oct 12 (sorted by date, "recorded Oct 17", later running balances
  shifted), a discount, Reverse cancelled then confirmed (reversal dated today, original marked "Reversed", no second
  Reverse), Weekly (Mon–Sun, empty weeks, charges $195.50 / credits $10 / reversals +$75 / closing "Owes $110.50"),
  Monthly, Drivers list balance; every request 2xx, no console errors. The fake driver stays in the local copy only
  (append-only rows cannot be deleted).
  After D61 (no categories, fresh local copy): the dialog shows Charge / Credit, amount, date, reason; a $25 charge
  and a $10 credit show as "Charge" and "Credit" with their reasons, balance "Owes $15.00".
- **Not done:** rent billing (M2); driver portal view (B78); manual cash payments (B79); old ledger import (B80).
- **On staging after the deploy:** run the backfill once (`npm run ledger:backfill`, then `-- --apply`) so payments
  confirmed before the ledger are credited.
- **Branch:** `feature/driver-ledger` (both repos), `dev` merged in.

---

### 2026-10-17 — Staging: one failed Cash App email fixed by hand (one-off exception to D37)
- **Why:** before the 5xx fix (B76) reached staging, Gemini 503s made the intake give up on one real payment email:
  `inbound_emails` `6924d0bb-7f1c-441f-9d19-41de09391723` (Cash App, UID 22200, received 2026-10-16 16:00 UTC,
  "You were sent $59 by Nicholas Olivera"), stored `extraction_failed`. It was the only `extraction_failed` row.
- **Done (staging database, run by Abulkalam through a Railway tunnel, SQL written by Claude):** in one statement, that
  email was set to `processed` (reason cleared) and its payment inserted as the intake would have: `email_cashapp`,
  `external_id` = the email id, 5900 cents, sender "Nicholas Olivera", `occurred_at` = received time (no time in the
  text, B50), no transaction id, status `unmatched`, so matching assigns it on its next run. New payment
  `2e83b6da-3f0a-4c0e-875a-33df2eed6534`.
  `WITH fixed AS (UPDATE inbound_emails SET status = 'processed', status_reason = NULL WHERE id = '6924d0bb-…' AND
  status = 'extraction_failed' RETURNING id, received_at) INSERT INTO payments (source, external_id, transaction_id,
  amount_cents, sender_name, sender_handle, occurred_at, extraction_confidence, status) SELECT 'email_cashapp',
  id::text, NULL, 5900, 'Nicholas Olivera', NULL, received_at, NULL, 'unmatched' FROM fixed`
- **Exception to D37 (rows never updated), Abulkalam:** staging only, this one row, so the Email log looks clean. The
  proper tools for such cases are still open: B38 (correct or re-read an email), B79 (manual payment).
- **Not checked yet:** which driver matching assigned it to (the Payments page showed "Matching..." right after).

---

### 2026-10-17 — Staging deploy: last night's revisions and the 5xx fix
- **Deployed** with the new Deployment steps (workspace `CLAUDE.md`, D59), from the `deploy-*` worktrees on
  `origin/dev`: backend `a928d71` (2026-10-17 06:33 UTC) and frontend `c1e9411` (06:41 UTC). Includes backend PRs #11,
  #12, #13 and frontend #10, #11 (B55, B76).
- **Verified:** both Railway deployments `SUCCESS`; the backend log shows the migrations ran (`AddDriverOnboarding`,
  `CreateApplicationNotes`, `CreateMessageTemplates`) and the app started.
- **For the client on staging:** edit both texts in Settings → Message templates; replace "[add company names and phone
  numbers here]" in the decline text before SMS goes live (B71, B72).

---

### 2026-10-17 — Google overload (HTTP 5xx) is a temporary AI error (B76, extends B49)
- **Done (backend):** branch `fix/llm-temporary-errors` (commit `e05774e`, written 2026-10-13 after a 503 spike,
  pushed but never PR'd) brought up to date with `dev` by a merge. `LlmTemporaryError` is the parent of
  `LlmRateLimitError` (429) and the new `LlmUnavailableError` (500/502/503/504, from the Gemini adapter). The intake
  retries both every run in order, with no strike (so 3 overloaded runs no longer mark real payments
  `extraction_failed`); matching leaves the payment for the next run instead of sending it to review.
- **Verified:** typecheck, lint, 114 unit + 118 e2e (new: five overloaded runs, then processed).
- **Trade-off:** like the rate limit, an overload that never ends stalls the intake at that email; it shows only as a
  warning in the server log, not in the admin UI.
- **Branch:** `fix/llm-temporary-errors` (backend only). Next: push, PR into `dev`, merge, deploy.

---

### 2026-10-17 — Editable approve / decline texts (B71–B73, D58)
- **Done (backend):** migration `CreateMessageTemplates` (table + placeholder default texts); `MessageTemplatesModule`
  (`GET /message-templates`, `PUT /message-templates/:key`, unknown placeholders refused, `render`); approval sends the
  approved template then the login text; `POST /applications/:id/reject` takes `{ sendText }`; shared `sendOrFail`
  (failure rolls the review back with the reason). Test helper `seedTestTemplates` (a `TRUNCATE users CASCADE` also
  empties `message_templates`).
- **Done (frontend):** Settings page (new sidebar item, `PlugInIcon` from TailAdmin): one editor per template with
  placeholders, character / SMS count, live preview, Save / Undo, last editor. Decline dialog with preview and two
  ways to go ahead (`ConfirmDialog.secondary`). Review actions refresh the chat.
- **Verified:** migration locally (defaults inserted, blank refused, revert + re-run, no drift); backend lint, 114 unit
  + 117 e2e (13 new); route 401 without token; frontend lint + build. Browser walkthrough in `dry_run` on three fake
  applications (all removed after, default texts restored): Settings defaults and preview, `{name}` refused with a
  plain message, edit saved with editor, decline without text (no text stored), decline with text (filled-in edited
  text stored as dry run), approve (two texts in order, shown in the chat at once).
- **Fixed during the walkthrough:** the chat did not show texts sent by approve/decline until a reload; the decline
  dialog's third button wrapped (dialog wider with a second action).
- **For the client on staging:** edit both texts in Settings; replace "[add company names and phone numbers here]".
- **Branch:** `feature/delete-applications` (both repos).

---

### 2026-10-17 — Internal notes on applications (B74, D57)
- **Done (backend):** migration `CreateApplicationNotes` (`application_notes`: application CASCADE, author SET NULL,
  CHECK body 1–2000 not blank, index (application_id, created_at)); `ApplicationNotesService` +
  `ApplicationNotesController`: `GET /applications/:id/notes` (paginated, newest first, author email),
  `POST` (trimmed body), `DELETE …/notes/:noteId` (author only, 403 otherwise, 204).
- **Done (frontend):** `ApplicationNotesCard` under Review on the application page: add (TailAdmin `TextArea`,
  2000 limit), list with author email and Chicago time, line breaks kept, "Show older notes" (infinite query, 10 per
  page), trash on your own notes only with a confirm dialog.
- **Verified:** migration locally (cascade and blank-note CHECK tested in SQL, revert + re-run, schema check clean);
  backend lint, 114 unit + 104 e2e (8 new); route 401 without token; frontend lint + build. Browser on a fake
  application with 11 notes by a fake second admin (all deleted after): 10 shown + "Show older (1 more)", no delete
  icon on others' notes, Add disabled for blank, two-line note on top with author, Show older loads all 12, delete
  Cancel/confirm, no failed requests; deleting the application removed its notes.
- **Branch:** `feature/delete-applications` (both repos).

---

### 2026-10-17 — "Rejected" shown as "Declined" (B69)
- **Done (frontend only):** `applicationStatus.ts` label `rejected` → "Declined" (badge on list and detail, Status
  filter option); detail page button "Reject" → "Decline". Label only (Abulkalam): database value `rejected` and the
  route `POST /applications/:id/reject` unchanged, no migration. The Email log's "Rejected (not genuine)" is a
  different thing (a refused forged email) and was left as is.
- **Verified:** frontend lint + build; browser on a fake application (created and deleted): Decline button, badge
  "Declined", filter option "Declined", stored value still `rejected`.
- **Branch:** `feature/delete-applications`.

---

### 2026-10-17 — "Car Rental" renamed "GonzoCar" (B70)
- **Done (frontend):** `src/brand.ts` (`BRAND_NAME`, `BRAND_INITIALS`) used by the sidebar and the mobile header;
  `index.html` title.
- **Done (backend):** driver login text "your GonzoCar driver account" (was "Gonzo Car"); OpenAPI title and
  description; `.env.example` `MAIL_FROM`; Quo webhook label in `scripts/quo-webhook.ts` (affects new webhooks only).
- **Verified:** backend lint, 114 unit + 96 e2e; frontend lint + build; browser: tab title, sidebar, mobile header
  (375 px) show GonzoCar, "Car Rental" nowhere on the page.
- **Not changed:** local `.env` `MAIL_FROM` (Abulkalam's file; email unused since D52). Real logo/favicon: B12.
- **Branch:** `feature/delete-applications` (both repos).

---

### 2026-10-17 — Driver statuses and onboarding steps (D56; B67 done, B68/B48 mostly)
- **Why:** Abulkalam: a driver is active only with contract signed, deposit paid and a vehicle; steps in any order,
  ticked by an admin, active automatically, onboarding drivers can log in, inactive ones cannot.
- **Done (backend):** migration `AddDriverOnboarding` (enum rebuilt with `onboarding` as default; three step dates +
  admin; CHECK `drivers_active_is_onboarded`; drivers already active marked onboarded at migration time); legacy
  import fills steps for active drivers; `POST /drivers/:id/onboarding`, `/deactivate`, `/reactivate` (row locks;
  deactivate turns `users.active` off); `DriverDto.onboarding`.
- **Done (frontend):** shared `DriverStatusBadge` ("Onboarding · 2/3") in the list, driver page and assign dialog;
  Status filter with Onboarding; Onboarding card (locked while inactive; confirm before un-ticking an active driver);
  Deactivate (confirm) / Reactivate.
- **Verified:** migration on local (19 active → steps set, 35 inactive), revert + re-run, schema check clean; backend
  lint, 114 unit + 96 e2e tests (9 new: any order, auto-active, un-tick, DB CHECK, deactivate + real login refused,
  reactivate, driver without login, body validation); frontend lint + build. Browser walkthrough on a fake driver
  (created and deleted): badges and filter, ticks 0/3 → Active, un-tick Cancel/confirm, Deactivate (login flag off in
  the database, steps locked), Reactivate (Onboarding 2/3, login back on).
- **Staging:** the migration runs on the next deploy; the imported active drivers get their steps marked done.
- **Branch:** `feature/delete-applications` (both repos).

---

### 2026-10-17 — Drivers, Payments, Email log on the shared table (B75, step 3; B75 done)
- **Done (backend):** `search` on `GET /drivers` (name, full name, email, phone digits), `GET /payments` (payer name
  and handle, assigned driver's name; existing status/source/driver/match filters unchanged, now a QueryBuilder
  with LEFT JOINs), `GET /inbound-emails` (subject, sender address).
- **Done (frontend):** the three pages on `TableCard` + `DataTable` + `useListParams`: Drivers (Status filter),
  Payments (Match + Source filters; Accept / Assign / Change and the assign dialog kept), Email log (Outcome +
  Provider filters; Provider is new in the UI). `filterOptions` helper.
- **Also fixed:** (1) `TableCard` clipped the Filter panel on short lists (Abulkalam's screenshot): `overflow-hidden`
  moved from the card to the table part. (2) A column's cell classes leaked into its header: `Column.align` added.
  (3) `cn()` dropped the theme's font sizes (`text-theme-*`, `text-title-*`) whenever a colour followed, app-wide:
  `extendTailwindMerge` now knows them.
- **Verified:** backend lint, 114 unit + 87 e2e tests; frontend lint + build. Browser (local, read-only on real
  local data): Drivers 8 rows / 7 pages, search "sutton", "312" + Inactive; Payments 8 rows / 3 pages, "sutton" +
  Assigned, Filter panel with two groups fully visible over a 1-row list; Email log "square.com" + Not a payment;
  cells 14 px / headers 12 px; no failed requests.
- **Note:** Vite's dev server once served a stale `DataTable.tsx` after an edit (file watcher missed it); touching
  the file fixed it. If a change does not show locally, check what Vite serves before debugging the code.
- **Branch:** `feature/delete-applications` (both repos).

---

### 2026-10-17 — Shared list tables; Applications list with search (B75, steps 1-2)
- **Why:** Abulkalam: every list like TailAdmin's "Recent Orders" table, built from reusable components, search +
  Filter dropdown, 8 rows per page, "Basic Table 5" pagination.
- **Done (frontend, step 1):** `components/tables/`: `TableCard`, `DataTable` (column list, row checkboxes, clickable
  rows), `SearchInput` (300 ms pause), `FilterDropdown` (select per group, Apply/Clear, active count),
  `useListParams` (`q`, filters, `page` in the URL; `LIST_PAGE_SIZE = 8`); `AvatarText` from TailAdmin; `Pagination`
  restyled (Previous left, numbers centred, Next right). Copied from TailAdmin `crm/CrmRecentOrderTable.tsx` and
  `ecommerce/ProductListTable.tsx` (this template copy's "Basic Table 4" is a different table).
- **Done (backend, step 2):** `GET /applications?search=` (name, "first last", email, city with ILIKE; phone by digits);
  shared `SearchQueryDto` and `common/search.ts` (`likePattern` escapes `%` `_` `\`, `phoneDigits`).
- **Done (frontend, step 2):** Applications list on the shared components: Applicant column with initials, Status in
  the Filter dropdown, per-row trash icon + bulk Delete (B66); selection cleared whenever the view changes.
- **Verified:** backend lint, 114 unit + 82 e2e tests (new: `search.spec.ts`, `applications-list.e2e-spec.ts`);
  frontend lint + build. **Browser walkthrough (local, 10 fake "Walk Test" applications, all deleted afterwards):**
  8 rows per page, page 2, phone search "630 555-0007" (one request after the pause, back to page 1), city search,
  search + Status filter (badge "1", in the URL), selection cleared by page change + Back, bulk Delete Cancel (no
  request) and confirm, trash icon (does not open the row), detail-page Delete back to the list with the message,
  select all, empty state, layout at 1400 px. Also seen in the log: B66 delete used by an admin at 01:12 (3 test rows).
- **Fixed during the walkthrough:** after deleting from the detail page, the chat of the deleted application was
  refetched while the page left (404 in the console); `useDeleteApplications` now marks chats stale without refetching.
- **Not covered:** an approved row's disabled checkbox / missing trash icon (no approved application locally).
- **NOT done:** step 3 (Drivers, Payments, Email log on the shared table, each with backend search).
- **Branch:** `feature/delete-applications` (both repos; Abulkalam 2026-10-17: commit on this branch, no new branches).

---

### 2026-10-17 — Delete applications, one or many (B66, D55)
- **Why:** client revisions PDF (B63-B74, received 2026-10-17); B64/B65 set aside by Abulkalam.
- **Done (backend):** `FileStorage.delete`; `ApplicationsService.deleteMany` (hard delete, all or nothing, approved
  refused with 409, chat deleted unless the phone is shared, files removed after commit); route
  `POST /applications/bulk-delete` + `DeleteApplicationsDto`; `openapi.json` exported.
- **Done (frontend):** client regenerated; `useDeleteApplications`; list page row checkboxes (approved disabled),
  "Delete (n)", confirm dialog, result message; detail page Delete button; shared `Checkbox` (from TailAdmin),
  `Button` `danger` variant, `ConfirmDialog` `confirmVariant`.
- **Verified:** backend lint, 110 unit + 73 e2e tests (9 new in `application-delete.e2e-spec.ts`), build; route answers
  401 without a token (local). Frontend lint + build.
- **NOT done:** browser walkthrough (waiting for admin sign-in in the pane; will be done with the new list tables);
  three local test applications "Test Delete 1-3" exist for it.
- **Branch:** `feature/delete-applications` (both repos).
- **NEXT:** shared TailAdmin-style list tables (search, filter dropdown, 8 rows per page) on `feature/list-tables`.

---

### 2026-10-14 — Applicants' documents copied from the website into our storage (D54, B17, B45)
- **Why:** the licence, rating and earnings uploads sit in the website's private Supabase bucket; the admin only saw
  "Uploaded", and the website can delete old files (its archive page).
- **Done (backend):** table `application_documents` (migration `CreateApplicationDocuments`); `DocumentSource` interface
  + `SupabaseDocumentSource` (asks the website's read-only function for a 60-second signed link, then downloads it, 25 MB
  cap); `ApplicationDocumentCopier` (every minute and right after a new application; records missing rows first = backfill;
  5 attempts; a refused token stops the run without using attempts); `GET /applications/:id/documents` (signed links, 10
  minutes); shared `FileStorageModule`; settings `DOCUMENTS_SOURCE_URL` / `DOCUMENTS_SOURCE_TOKEN` (optional).
- **Done on the website (Lovable, by Abulkalam):** edge function `get-driver-document` at
  `https://htaaxbghiuvgnmkwkdlh.supabase.co/functions/v1/get-driver-document`, secret `DOCUMENTS_READ_TOKEN`
  (read-only; 401 wrong token, 404 no file, 400 bad path). Only the wrong-token case was tested by Lovable.
- **Done (frontend):** the Documents tab shows the pictures (or "Copying…", "not set up", or the failure reason).
- **Verified:** 108 unit + 62 e2e tests (new: the source adapter, the copier incl. backfill / gone file / refused token /
  retries, the list route); the Documents tab in the browser with a stored, a pending and a failed document (local).
  NOT yet tried against the real function or real files.
- **NEXT:** merge and deploy (the migration runs); in Railway set `DOCUMENTS_SOURCE_URL` (the function URL above) and
  `DOCUMENTS_SOURCE_TOKEN` (same value as `DOCUMENTS_READ_TOKEN`, typed by Abulkalam); the next minute the existing
  applications are backfilled; open an application's Documents tab and check. Ask the client NOT to use the website's
  "Delete archived files" until the copies are verified.
- **Branch:** `feat/application-documents` (both repos).

---

### 2026-10-14 — Text alert to staff for every new application (D53)
- **Done (backend):** `APPLICATION_ALERT_PHONE` (optional, validated US number; empty = no alerts);
  `ApplicationAlertService` (name + link, started after the application is saved, never waited for, never throws);
  `SmsService.sendAlert` and a shared private `deliver` (same mode / number / Quo rules as `send`); migration
  `AddApplicationAlert` (`alerted_at`, `alert_error` on `applications`, nullable); `alertError` in the list and detail
  API, `alertedAt` in the detail.
- **Done (frontend):** a warning on the application page ("The text alert to staff … was not sent: <reason>") and an
  "Alert not sent" marker in the list; client regenerated.
- **Verified:** 102 unit + 54 e2e tests (6 new: dry_run saves name + link only, live sends once and records when, a
  repeat sends nothing, no phone = nothing, a Quo daily-limit refusal leaves the application stored with the reason on
  it, off). NOT yet tried on staging.
- **NEXT:** merge, deploy (the migration runs on deploy), then set `APPLICATION_ALERT_PHONE=+12243282246` on the
  backend in Railway. Staging is `live`: from then on every new application there texts that number (including test
  and mirrored real ones). Check that the text arrives as a regular SMS (the number is a Quo line, see D53).
- **Branch:** `feat/sms-driver-invite` (same branch as the driver-invite work below, separate commits).

---

### 2026-10-14 — Driver login by text instead of email (D52, B41, B62)
- **Why:** staging could not send email (Railway blocks outbound SMTP on non-Pro plans), so no approval could complete;
  the client mostly uses SMS and Quo is connected.
- **Done (backend):** `ApplicationsService.approve` creates the login with `emailVerifiedAt` set (no token, no
  confirmation link) and texts the driver their login link, email and temporary password through `SmsService.send`
  (same chat, follows `SMS_MODE`; `live` sends, `dry_run` saves "not sent" so the admin can read it, `off` refuses; any
  failure rolls the approval back with a plain message). New `driver-welcome.text.ts`; `driver-welcome.email.ts`
  removed; `ApplicationsModule` imports `SmsModule` instead of `MailModule`.
- **Done (frontend):** the Approve dialog says a text with the login will be sent.
- **Verified:** 102 unit + 48 e2e tests (4 new: dry_run approves and the password in the saved text really opens the
  account; live sends to the application's phone; off creates nothing; a Quo refusal rolls everything back with the
  plain reason). NOT yet tried on staging.
- **NEXT:** merge both PRs, deploy backend then frontend, approve ONLY the "Quo Test" application (US phone
  305 721 0909, owner agreed) in `live`, check the text arrives and the login works; remove dead code (B41 list).
- **Branches:** backend and frontend `feat/sms-driver-invite`.

---

### 2026-10-14 — Quo chat on staging in `dry_run` (rollout steps 1-6 done; going live waits for a US test)
- **Done:** PRs merged into `dev` (backend 5, frontend 6); Railway Storage Bucket added (variables are references to it,
  `S3_FORCE_PATH_STYLE=false`); `QUO_API_KEY`, `QUO_PHONE_NUMBER_ID=PNlq6NzLQ3`, `SMS_MODE=dry_run` set; both services
  deployed (migration `CreateSms` ran); webhook **43940** created with `npm run quo:webhook` (general line only, four
  message events) and `QUO_WEBHOOK_SECRET` set; the staging Texts card shows the Dry run badge and a dry-run send was saved.
- **Verified on staging:** a Quo test event and real events from the general line were accepted (deliveries SUCCESS) and
  skipped correctly in the log ("not an application or a driver", "other Quo number"): real signature, parsing and the
  D51 filters work. NOT yet verified on staging: a stored incoming text and a file in the bucket (needs a US-number
  contact), a live send.
- **Found:** a non-US phone cannot be tested: applications and drivers are US-only (`toUsE164`, drivers CHECK), so its
  texts are skipped (B61). A 10-digit non-US number typed on an application would be read as a US number: the test
  application "Quo Test" was therefore **deleted from staging** (with its text) before going live.
- **NEXT:** Saad or the client submits an application with a US phone they own and texts the general line (must appear
  in that chat; a photo must appear in Files and open); then `SMS_MODE=live` in Railway and ONE send to that same phone
  from that chat. Never click Send on a real applicant or driver before Saad agrees. Then remove the test application.
- **Not committed:** `scripts/quo-webhook.ts` gained `test <id>` and `deliveries <id>` (local `dev`, needs a small branch).

---

### 2026-10-14 — Quo chat: send, receive, files, on the application and driver pages (D50, D51; B46)
- **Done (backend):** `sms_messages` + `sms_attachments` (migration `CreateSms`, CHECKs and UNIQUE keys in the database);
  `src/sms/`: `QuoClient` interface + HTTP adapter (v1 send and history), webhook signature check
  (`verify-quo-signature.ts`) and event parser, `SmsService` (send by `SMS_MODE` off / dry_run / live, list, history sync,
  webhook apply: idempotent on the Quo id, status only moves forward, only known contacts stored), `SmsController`
  (`/sms/status`, `/sms/:kind/:id/messages|sync|files`), `POST /webhooks/quo` (public, signature-checked, `rawBody: true`),
  `AttachmentDownloader` (copies MMS files into the bucket, minute cron + right after a webhook/sync, 25 MB cap,
  5 attempts), `S3FileStorage` (MinIO locally, Railway Storage Bucket on staging), env `SMS_MODE`, `QUO_*`, `S3_*`.
  Scripts: `quo:numbers`, `quo:simulate`, `storage:init`. MinIO in `docker-compose.yml` (Chainguard image: Docker Hub
  no longer has MinIO).
- **Done (frontend):** `src/api/sms.queries.ts`, `components/sms/` (`ConversationCard` with Messages and Files tabs,
  polls every 10 s), placed in the side column of `ApplicationDetail` and `DriverDetail`.
- **Verified:** 88 unit + 43 e2e tests (new: 12 + 7); real HTTP: signed webhook stored, forged 401, stranger skipped;
  real MinIO: a public PNG copied and shown through a signed link; dead links recorded as failed with the reason;
  browser walkthrough of the application page (dry-run send, incoming text appears by itself, Files tab, no console
  errors); the sync read the real Quo account (read-only) with 200. NOT tested: the driver page in the browser (it would
  pull a real driver's texts), a live send, a real webhook from Quo.
- **Found / fixed:** an empty `S3_BUCKET=` line made the app refuse to start (fixed in `env.validation.ts`).
- **Not done / open:** live send and webhook on staging (B59: client's OK for the webhook; credits and A2P still to
  confirm; staging bucket and variables, then deploy, create the webhook, one real text and MMS, then `live`);
  STOP/opt-out (B58); "more info" status, decision texts, upload link (B47); media-link expiry (B57); the Settings
  table replaces `SMS_MODE` (M7); chat on other Quo numbers (D51).
- **NEXT, exact steps (staging rollout; Saad said "bring it live" on 2026-10-14; a short chat "03 - Quo chat (staging rollout)"):**
  1. Review, commit and push both repos; PRs into `dev` (Abulkalam opens, Saad merges), or deploy from the branch if Saad
     prefers (`railway up` uploads the working folder).
  2. Railway dashboard (typed by Abulkalam, never in chat), project `car-rental-staging`: add a **Storage Bucket**;
     on the `backend` service set `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (variable
     references to the bucket's own values), `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false` (if the first file link
     fails, try `true`), `QUO_API_KEY`, `QUO_PHONE_NUMBER_ID=PNlq6NzLQ3`, **`SMS_MODE=dry_run`**. Apply.
  3. `railway up --service backend`, then `--service frontend` (D43). The pre-deploy command runs `CreateSms`.
  4. Open any application as admin: the card must show the "Dry run" badge and load. Logs: no errors.
  5. Create the webhook from your terminal, with the staging URL (needs Saad's OK, changes the client's Quo):
     `npm run quo:webhook -- create https://backend-production-1f569.up.railway.app/webhooks/quo`. It prints the
     secret once: set `QUO_WEBHOOK_SECRET` in Railway, Apply. Do NOT use the dashboard's webhook page (other signature format).
  6. Make a test application with YOUR OWN phone (the website form as on 2026-10-11, then reject it in the old system).
     Text the general line from your phone: it must appear in that application's chat within seconds; send a photo:
     it must appear in Files.
  7. Only then go live: `SMS_MODE=live` in Railway, Apply. Send ONE text from the test application's chat to your own
     phone; reply from the phone; confirm. Never click Send on a real applicant or driver before Saad agrees.
  8. Tell Saad; remove the test application; later dev to main (Saad).
- **Local test data to remove:** application with `request_id = 'quo-sim-test'` and its texts
  (`DELETE FROM applications WHERE request_id='quo-sim-test'; DELETE FROM sms_messages WHERE contact_phone='+13125550188';`).
- **Branches:** backend and frontend `feature/quo-chat` (both merged with `dev` on 2026-10-14; nothing pushed after that).

---

### 2026-10-13 — Matching, aliases, one-stage payments, Payments / Email log / Drivers pages (D48, D49)
- **Done (backend):** `payment_aliases` (UNIQUE type+value; types = payment methods + email/phone) and
  `npm run legacy:import-aliases` (dry run, `--apply --target=<db>`, skips damaged old aliases); match columns on
  `payments`; `MatchingService` after every intake run: exact alias / driver email / phone (no AI), everything else AI
  with full context (70% assign, 90% also learns the alias, below 70% "Needs review"); `POST /payments/:id/assign`
  (manual, saves the alias, never takes one from another driver); `GET /payments` (filters source, match, driverId),
  `GET /inbound-emails`, `GET /drivers` with aliases and payment summary. Every matched payment is `confirmed`
  (D49, Saad). Refactors: `AliasIndex` and `EmailProcessor` classes; `email-intake/` grouped into `mailbox/`,
  `verification/`, `extraction/`; LLM clients moved to `src/llm/`. Rate limits (429) never count as a strike and log
  as one warning line.
- **Done (frontend):** Payments page (driver and how matched, Accept / Assign / Change, Needs review filter, no status
  column), Email log page, Drivers list (clean) + driver detail page (aliases by method, recent payments), application
  page with tabs, all times in Chicago with the UTC offset in the header.
- **Verified:** 76 unit + 24 e2e tests; live local run on the real inbox from UID 22150: 16 emails, 13 payments, all
  matched; alias dry run on real data: 52 unchanged, 8 skipped (5 left-out drivers, 3 damaged aliases).
- **Branches:** backend and frontend `feature/email-parsing` (29 and 6 commits ahead of `dev`, no PR yet, B55).
- **NEXT, exact steps (staging rollout, a short chat "02 - Payment email parsing (staging rollout)"):**
  1. PRs into `dev` merged (backend first, then frontend); then deploy: `railway up --service backend` and
     `--service frontend` from each repo (D43). The pre-deploy command runs the 7 new migrations.
  2. Keep `EMAIL_INTAKE_ENABLED=false` until step 4.
  3. Import the aliases into staging through the tunnel (`railway connect Postgres --tunnel-only`, set `DATABASE_URL` in
     that terminal only, `--target=railway`): dry run must say Skipped 8 with 3 "leftover email formatting"; after
     `--apply`, the damaged-alias count query must return 0:
     `SELECT count(*) FROM payment_aliases WHERE length(value) > 80 OR value ~ '[{}]' OR value ~ '</?[a-zA-Z]'`.
  4. In the Railway dashboard (typed by Abulkalam, then Apply): `EMAIL_INTAKE_ENABLED=true`, `IMAP_HOST`, `IMAP_USER`,
     `IMAP_PASSWORD`, `IMAP_TRUSTED_SERVER=mx.google.com`, `LLM_API_KEY`, `LLM_MODEL=gemini-3.5-flash-lite`, and
     `IMAP_START_AFTER_UID` (go-live point: **not decided**, 22150 or 22000; free key = 15 AI calls a minute, a big
     backlog takes a while but loses nothing).
  5. Watch the first ticks in the logs; Payments page should fill and every payment be assigned; UI walkthrough.
  6. Then Saad opens `dev` → `main` so `main` matches staging.
- **Not done / open:** B54 (re-assigning a payment matched through a wrong alias), B53 (driver-added aliases need admin
  approval; alias add/remove screen), ledger and balances (M1/M2), Plaid (M5), Quo (M6), B43 list counts, B41, B16.
  Note: a local `docker compose down -v` wipes the local database; rebuild = `migration:run`, `seed:admin`, both legacy
  imports, then intake from `IMAP_START_AFTER_UID=22150`.

---

### 2026-10-12 — Payment email intake service (M3), first live run (D46, D47)
- **Done (backend):** `payments` table + `inbound_emails.gmail_message_id` + `duplicate_payment` status (migration
  `AddPaymentsAndGmailId`); `processEmail` (parse → allow-list → DKIM → AI → validation); `MailboxReader` + imapflow
  adapter; `EmailIntakeService.syncNewMessages()` (advisory lock, cursor, go-live point, one transaction per email,
  3-strike rule); `@Cron` every 3 minutes behind `EMAIL_INTAKE_ENABLED` (default off); `npm run intake:peek`.
  Fixes after the live run: date-only payment times use the received time (B50); rate limits never count as a
  strike (B49). Free Gemini key approved for real emails (D46).
- **Verified:** 62 unit + 9 e2e tests (test database, fake mailbox and AI). Live run locally
  (`IMAP_START_AFTER_UID=22150`): 10 emails, 9 payments, 1 Zelle request correctly `not_payment`, 0 failures;
  checked against Gmail. Rows from that run keep the old midnight times (stored before the B50 fix).
- **Not done:** admin pages for payments and the email log (next: F1-F3); staging stays OFF until then; matching (M4).
- **Branch:** `feature/email-parsing` (backend).

---

### 2026-10-11 — Cleaner application page (Saad's feedback)
- **Done (frontend):** the application page is laid out like TailAdmin's transaction page: a header with the name,
  status, submitted time and review buttons; the answers in underlined tabs (Contact, Driving, Rental, Documents, and
  Other only when the website sends a field we have not placed); a side column with Review and Submission cards.
  Empty fields are hidden; tracking (`utm_*`, `gclid`, `fbclid`), form internals and file paths are never shown.
  New: `components/ui/tabs/Tabs.tsx` (adapted from TailAdmin's `TabWithUnderline`), `pages/Applications/applicationFields.ts`
  (which field goes in which tab). No API change.
- **Verified:** type check and lint pass; every tab checked in the browser on the fixture application, narrow and wide.
- **Not done:** viewing the uploaded files (B17, client's Supabase bucket); medium/long lease values (B44).
- **Deployed:** staging frontend, from `feature/application-details` with the Node 24 pin merged in
  (`chore/railway-deploy`).
- **Branch:** `feature/application-details` (frontend).

---

### 2026-10-11 — gonzocar.com form connected to staging (B22)
- **Done:** staging `CORS_ORIGINS` = staging frontend, `https://gonzocar.com`, `https://www.gonzocar.com`. On the
  client's Lovable site, `src/lib/api.ts` now sends the same body a second time to
  `https://backend-production-1f569.up.railway.app/applications`, only after the old system's request succeeds,
  fire-and-forget (`keepalive`, 10 s abort, failures only `console.warn`). The old system's flow is unchanged.
- **Verified:** CORS preflight: both gonzocar.com origins allowed, other origins blocked. One test application from
  the live form: our API answered 201, it shows on the staging Applications page with every field.
- **Not checked yet:** that the old system also received the test application (Saad to confirm, then reject it there).
- **Note:** every real applicant now lands in staging too. Approving one there sends a real welcome email with a
  login. `POST /applications` has no rate limiting yet (B16, B25).
- **Branch:** `feature/email-parsing` (backend, docs only).

---

### 2026-10-11 — Old-system drivers imported, local and staging (D44, D45)
- **Done (backend):** `legacy:report` (read-only report of the old database), `drivers.legacy_id` migration,
  `legacy:import-drivers` (mapping + 8 tests, dry run by default, one transaction, `--apply --target=<db name>`),
  shared read-only connection helper `scripts/legacy-db.ts`. Backend redeployed (migration ran on staging).
- **Verified:** local and staging: 59 read, 54 inserted, 5 skipped (left out on purpose, D45); re-run 0 inserts, 54
  unchanged; no logins created; staging Drivers page shows them. Wrong `--target` refused locally. 53 tests pass.
- **How staging was reached:** `railway connect Postgres --tunnel-only` (SSH tunnel, the database never public); an SSH
  key was created on Abulkalam's machine and registered on the client's Railway account (`railway ssh keys list`;
  remove at hand-over if wanted). `DATABASE_URL` set only in that terminal, then removed.
- **Not done:** aliases, applications, money history (B42); list counts (B43); drop email confirmation (B41).
- **Next:** decide the next import (aliases need our alias table first) or start the intake service.
- **Branch:** `feature/email-parsing` (backend).

---

### 2026-10-11 — Staging deployed on Railway (D43)
- **Done:** project `car-rental-staging` on the client's Railway account (Postgres, backend, frontend), manual
  `railway up` deploys. Backend: Node 24 pin, `migration:run:prod` (compiled migrations; data source now loads
  `.js` or `.ts` migrations, never `.d.ts`), dashboard settings for start / pre-deploy / health check, admin
  seeded. Frontend: Node 24 pin, static site.
- **Verified:** all 8 migrations ran on the empty database; `/docs` 200; fake login 401; frontend `/` and a direct
  `/admin/login` 200; backend URL in the bundle; CORS preflight allowed for the frontend origin; Abulkalam logged in
  and opened Applications and Drivers in the browser. `ADMIN_*` removed afterwards.
- **Found:** `railway.json` ignored by `railway up` (B40); dashboard changes are staged until applied; npm blocks
  install scripts (bcrypt still works from its prebuilt binary).
- **Not done:** email intake service; frontend has no Railway config file; real admin email; hardening (B25).
- **Next:** walk through the extractor commits; then the intake service (`syncNewMessages`, plan mode), deployed
  with `IMAP_*` / `LLM_*` variables once Saad confirms the key question (live names to the free Gemini tier or a
  paid key).
- **Branches:** backend `feature/email-parsing`, frontend `chore/railway-deploy`.

---

### 2026-10-10 — AI extractor works on real emails: 28/28 (D40-D42)
- **Done (backend, committed and pushed 2026-10-10; walkthrough still pending):** `LlmJsonClient` interface, `GeminiJsonClient` (JSON
  schema output, 60 s timeout, SDK's silent retries off), `LlmPaymentExtractor` with rules + per-provider hints +
  schema (adds `transaction_id`), fake-client tests; `extract-eval` script (replaces payer names/emails before
  sending, compares with `../mail-samples/labels.json`); `llm-probe` script (lists models, times thinking settings);
  DKIM accepts a list of exact domains per provider (Chime signs with `account.chime.com` and `chime.com`, D42);
  `imap-peek` type fixes; `.env.example` LLM block. Committed earlier today: sender allow-list, Venmo blank-body
  fix (`html-to-text`), `imap-peek --save`, `samples-show`.
- **Verified:** 44 unit tests pass; type check clean. `npm run extract:eval` with `gemini-3.5-flash-lite`:
  28/28 pass (Cash App 6, Chime 5, Stripe 6, Venmo 5, Zelle 6), including payouts, requests, transfers out and
  "Payment sent". `gemini-flash-latest` was too slow (30-60 s, timeouts).
- **Limits of this result:** small sample, few distinct payers; the memo-amount trap (B30) is not in the set any
  more (it was the Mailcow copy); `occurred_at`, `transaction_id` and confidence (always 1) are not checked.
- **Decided today:** intake by scheduled UID poll (D40); Stripe webhooks later (D41); B34-B39 opened.
- **Next (start of next session):** 1) walk through the two 2026-10-10 commits (extractor code, docs) together until every file is understood; 2) widen the
  sample set (older emails, more payers, the $317.85 memo email from Gmail, B36 sender/folder audit) and re-run;
  3) plan the intake service (`syncNewMessages`, plan mode).
- **Branch:** `feature/email-parsing` (backend).

---

### 2026-10-09 — Source changed to Gmail IMAP; `verifyDkim` reads Gmail headers (D38)
- **Done (backend):** `verifyDkim` accepts the signer as `header.d=` or Gmail's `header.i=@domain` (6 new tests with
  real-shaped Cash App and Venmo headers); `imap-peek` simplified to one mailbox (`IMAP_USER`, `IMAP_PASSWORD`,
  `IMAP_TRUSTED_SERVER`), scans the newest 300 messages, new `--from=<sender>` option; `.env.example` updated; spec
  4 and 5.1 updated; D38 supersedes D36.
- **Verified (manually):** read `gonzobilling@gmail.com` (20,301 messages) over IMAP with an app password; a real
  Cash App email verifies as `cashapp` and not as the other providers. Gmail screenshots confirmed the routes.
- **Found:** Stripe (846) and Chime (650) emails are in the inbox and in daily use, outside the accepted scope (B32);
  Stripe payouts and Chime requests/transfers are not payments. Inbox goes back to 2024 (B33).
- **Not done:** `verifyDkim` fix not yet run against a real Zelle email read through Gmail; the intake service; LLM
  client; B30.
- **Next:** run `imap:peek -- <UID>` on a Zelle and a Venmo email; decide Stripe/Chime with Saad; intake service
  (plan mode first).
- **Branch:** `feature/email-parsing` (backend).

---

### 2026-10-09 — Step 4: `inbound_emails` table (D37)
- **Done (backend):** `InboundEmail` entity, `EmailIntakeModule` (registers the entity, no services yet), wired into
  `AppModule` and `data-source.ts`; migration `CreateInboundEmails` generated, read, applied to the dev database.
  Spec sections 4 and 5.1 updated for IMAP and the new message key. `imap-peek` now takes a list of mailboxes
  (`IMAP_USER_n` / `IMAP_PASSWORD_n`).
- **Verified (manually, psql, rolled-back transactions):** `\d inbound_emails` matches the entity; duplicate
  `(mailbox, uid_validity, uid)` rejected; `rejected_unverified` without a reason rejected, with a reason accepted;
  upper-case mailbox rejected; provider `chime` rejected. Build, lint and tests pass.
- **Found:** all four pay mailboxes read; only Chase Zelle mail, `gonzopay@` (203) and `payashwood@` (11); none of
  Cash App/Venmo (B31, asked Saad). One real email shows B30 (amount check can be fooled by memo amounts).
- **Not done:** migration not applied to `car_rental_db_test`; no service writes rows yet; `payment_id`; Cash App and
  Venmo samples; the LLM client.
- **Next:** the intake service: fetch new messages per mailbox over IMAP (remember the last UID), run parse, verify,
  extract (fake extractor first), validate, insert-or-skip into `inbound_emails`. Plan mode first.
- **Branch:** `feature/email-parsing` (backend).

---

### 2026-10-09 — IMAP route proven on a real Mailcow mailbox (D36)
- **Done (backend):** `scripts/imap-peek.ts` (`npm run imap:peek`, dev tool, not in the build): read-only IMAP
  list of the newest messages, or `-- <UID>` to save one `.eml` to `../mail-samples` and run `parseRawEmail` +
  `verifyDkim` on it. Added `imapflow`, `IMAP_*` in `.env.example`.
- **Verified (manually, `payashwood@` via Mailcow app password):** listed 15 messages; real Zelle email has
  `mail.gonzocar.com; dkim=pass header.d=chase.com`, `spf=pass`, `dmarc=pass`; `verifyDkim` VERIFIED for
  `zelle_chase`, rejected for the other two. Chase writes directly (no `Fwd:`); the mailbox also holds
  non-payment mail (statements, tests, Mailcow notices).
- **Found:** all four pay mailboxes `keep; redirect` to `gonzobilling@gmail.com` (B27). Admin Webmail button was
  disabled and the protocol list has no SOGo option; not pursued.
- **Not done:** Cash App and Venmo samples (which mailbox receives them?); the other three mailboxes not read yet.
- **Next:** `InboundEmail` entity and migration (plan mode); explain how the files fit into NestJS (question 3).
- **Branch:** `feature/email-parsing` (backend), uncommitted.

---

### 2026-10-08 — Email intake prototype: DKIM check, raw email parser, extraction validator (D35)
- **Done (backend):** `src/email-intake/`: `verifyDkim` (trusts only our server's `Authentication-Results`, exact
  `header.d`), `parseRawEmail` (mailparser: sender, subject, date, auth headers top to bottom, clean body text),
  `PaymentExtractor` interface and `validateExtraction` (shape, provider, amount literally in text). Plain
  functions, no Nest module, no database yet. Added `mailparser` and `@types/mailparser`.
- **Verified:** `npx vitest run src/email-intake`: 23 tests pass. Emails in tests are synthetic.
- **Found:** the mailbox is Mailcow (`mail.gonzocar.com`), so likely IMAP not Gmail OAuth; reference system
  also receives forwards from four `gonzocar.com` pay inboxes (rewritten forwards would fail the DKIM rule).
  Abulkalam could not log in to the Mailcow admin; asked Saad.
- **Not done:** `InboundEmail` table, real LLM extractor (B8), mailbox fetch, matching, real sample emails.
- **Next:** `InboundEmail` entity and migration (plan mode first), once the questions in BACKLOG are answered or
  independently of them.
- **Branch:** `feature/email-parsing` (backend), uncommitted.

---

### 2026-10-08 — Plan update: deployment blocked, email parsing next (D34)
- **State:** M0, step A (applications, drivers) and step B (driver login) are merged into `dev` in both repos.
  Local flow verified end to end: website-shaped application → admin approval → welcome email → email
  confirmation → driver login → forced password change → portal.
- **Blocked:** Railway deployment and connecting the live website (B22, B24): no access to the client's Railway
  account yet.
- **Next:** payment email parsing, in a new chat. Start with requirements and the list for Saad (Gmail access,
  sample emails, sender addresses, LLM: B4-B8); build the tables and the parser against saved sample emails.
  Sample email shapes for reference: `gonzocar/tests/test_gmail_parser_addresses.py` (read-only, never copy code).
- **Deferred:** security hardening (B25).
- **Branch:** start `feature/email-parsing` from `dev` in both repos as needed.

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
