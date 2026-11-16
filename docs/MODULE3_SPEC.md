# Module 3 Spec — Vehicle Check-In / Check-Out Photos

A driver documents the car's condition at pickup (check-in) and at return (check-out) with a guided photo sequence opened
from a texted link: no app, no driver login. Each submitted inspection is saved, time-stamped, on the driver's file;
staff compare check-in and check-out side by side. Started 2026-11-16. Decision: D102.

**Scope rule:** build what the client's spec asks for, in the order below; anything under "Not built" waits until Saad
or the client asks for it (BACKLOG B139).

---

## 1. What the client asked for
- **Original scope (CLIENT_SCOPE.md, September), Module 3:** guided capture on the driver's phone, angle by angle, close-ups for
  damage, fuel and mileage; upload that survives weak signal (compression, retry); staff review, side-by-side comparison with
  new damage flagged; history per vehicle, a report; damage charges post to the ledger. Estimate there: 24 hours.
- **Client spec, 2026-11-10** (`10-nov-review/module3-check-in-check-out-spec_2026-11-10.pdf`, 14 pages) and the translation
  file `module3-inspection-i18n_v1.2.json` (English and Spanish, every screen and text). Much larger than the estimate; the
  spec was written for the client's own prototype stack (DocuSign, Airtable, Task Board, Hostinger), so section 2 maps it to ours.
- **Words:** *check-in* = the driver picks the car up; *check-out* = the driver returns it (the client's meaning).

## 2. Decisions taken (Abulkalam, 2026-11-16, in chat)
| Topic | Decision |
|---|---|
| Link token | **Random token, not a JWT.** 32+ random characters; only its SHA-256 hash is stored. A JWT cannot be revoked or closed on submit, and its payload is readable. |
| One link or two | **One capture page, one link per inspection.** The link decides check-in or check-out (the spec: one open session per type per driver + vehicle + contract; a link closes on submit). |
| Vehicle | **Copied from the driver's contract** (model, VIN, plate) onto each inspection when the link is made; no vehicle table in v1. A driver with no contract: the admin types the vehicle when creating the link (our suggestion). Vehicle-level history is not built. |
| Sending | **Manual only.** The admin creates the link on the driver page and sends it through the existing Quo chat (or copies it). No automatic triggers. |
| Language | New column `drivers.preferred_language` (`en` / `es`, default `en`); the capture page defaults to the phone's language and saves the driver's choice; the link text goes out in the driver's language. |
| Chats | **Two chats:** (1) link and capture page, (2) staff review and compare. |
| Photo storage | Our existing S3-compatible bucket (`FileStorageModule`, D50, D54). The client's choice, Cloudflare R2, is a configuration change of the same provider. Files are kept under ids (`inspections/<inspectionId>/<NN>_<SHOT_ID>.jpg`), not the spec's driver-name folders (names change); the ZIP and PDF export (chat 2) give the readable layout. |

## 3. Flow
1. Admin opens the driver page, tab **Vehicle Photos**, presses **Send check-in link** (or **Send check-out link**). One open
   inspection of each type per driver + vehicle + contract: pressing again re-sends the same link; **Revoke and reissue** makes a
   new token.
2. The link is texted through the Quo chat in the driver's language (SMS mode rules apply: `dry_run` composes only).
3. The driver opens `/i/<token>` on a phone: Start, 19 photos, "Any other damage?", Submit. No login.
4. The inspection becomes `submitted` and appears on the driver page under Check-In or Check-Out photos.
5. Staff review it, compare check-out with check-in, flag new damage, and create a ledger charge by hand (chat 2).

## 4. Data model (conceptual)
- **`inspections`:** reference (`INS-2026-000123`), `type` (`check_in` | `check_out`; `spot_check` is not built), `status`
  (`created` | `link_sent` | `opened` | `in_progress` | `submitted` | `reviewed` | `flagged` | `revoked`; **expired is worked out** from
  `token_expires_at`, not stored), `driver_id`, `contract_id` (nullable), vehicle copy (`vehicle_model`, `vehicle_vin`,
  `vehicle_plate`), `paired_inspection_id` (a check-out points to the latest submitted check-in of the same driver and contract),
  `token_hash`, `token_expires_at` (24 hours after sending, setting), `link_sent_at`, `opened_at`, `started_at`, `submitted_at`,
  `odometer_miles`, `fuel_level` (`empty`, 1/8 ... 7/8, `full`), `gps_lat`, `gps_lng`, `device_info`, `attested_at`,
  `reviewed_by_id`, `reviewed_at`, `review_notes`, `created_by_id`. Times are `timestamptz`, shown in Chicago time.
- **`inspection_shots`** (config table, seeded with the 19): `shot_id`, `position`, `title`, `instruction`, `overlay_image`
  (empty until the client supplies artwork, B138), `required`. The English and Spanish texts live in the translation file.
- **`inspection_photos`:** `inspection_id`, `shot_id` (a shot id or `DAMAGE`), `position` (damage photos 1 to 15), storage key, thumbnail key,
  `captured_at` (device), `uploaded_at` (server), `driver_note`, `sha256`, `retake_count`, `ai_analysis` (empty, reserved).
  Unique on `(inspection_id, shot_id, position)`, so a retried upload cannot double a photo.
- **`inspection_events`:** the activity log (link created, sent, opened, each upload, submitted, reviewed, revoked, flagged),
  who and when. Staff actions are also written to `audit_logs` (D95).
- **`damage_items`** (chat 2): `inspection_id`, `photo_id`, `location`, `damage_type`, `description`, `source`
  (`driver_reported` | `staff_flagged`), `first_seen_inspection_id`, `status` (`pre_existing` | `new_during_rental` | `disputed` |
  `repaired` | `charged`), `ledger_entry_id`.

## 5. The 19 required shots (same list for check-in and check-out)
1 EXT_DRIVER_SIDE, 2 EXT_LEFT_FRONT_CORNER, 3 TIRE_FRONT_LEFT, 4 EXT_FRONT, 5 EXT_WINDSHIELD, 6 EXT_RIGHT_FRONT_CORNER,
7 TIRE_FRONT_RIGHT, 8 EXT_PASSENGER_SIDE, 9 EXT_RIGHT_REAR_CORNER, 10 TIRE_REAR_RIGHT, 11 EXT_REAR, 12 TRUNK_INTERIOR,
13 TRUNK_SPARE_JACK, 14 EXT_LEFT_REAR_CORNER, 15 TIRE_REAR_LEFT, 16 INT_ODOMETER (photo + typed mileage), 17 INT_FUEL (photo +
fuel level), 18 INT_FRONT_SEATS, 19 INT_REAR_SEATS. Titles and instructions: spec pages 5 to 7 and the translation file.

## 6. Link rules
- URL `<frontend>/i/<token>` (a public route outside the admin login). The client's `inspect.gonzocar.com` is a domain
  pointed at the same frontend (DNS only, later).
- Opens one inspection only. Shows year, make, model, plate and the last 4 of the VIN (from the copied vehicle) so the driver
  confirms the car. Our contract holds one typed model text, so it is shown as typed.
- Expires 24 hours after sending, or when submitted. Revoked or expired: "This link has expired" screen with a Call GonzoCar button.
  Reopening a half-done link resumes at the next shot. A submitted link shows "Already submitted" with the reference.
- Identity is the link itself, sent to the phone on file. Unknown tokens answer the same as expired ones. The token routes are rate limited.

## 7. Capture page (mobile web, public)
- iPhone Safari (iOS 16+) and Android Chrome. Camera baseline: `<input type="file" accept="image/*" capture="environment">`;
  live viewfinder (`getUserMedia`) where supported, falling back to the baseline. Required shots: camera only, no photo library.
- In the browser: compress (longest side 2048 px, JPEG ~0.8), keep the capture time, make a 400 px thumbnail, check brightness and
  blur and ask for a retake. Each accepted photo uploads at once in the background with retry; pending photos wait in IndexedDB.
- Screens: Start (welcome, vehicle, language switch, three tips, Begin button), 19 shots, Any other damage? (up to 15 close-ups
  with a short note; on check-out the damage recorded at check-in is shown at the top), Submit (thumbnail strip, one checkbox
  "These photos show the car's condition right now", Submit), confirmation with the reference number.
- Submit is refused unless all 19 required shots are present, mileage and fuel are set, and the box is ticked.
- Every string comes from the translation file (English and Spanish); the app keeps it as shipped.
- Server stamps the upload time and the SHA-256 of every file; an original is never edited.

## 8. Staff side
**Chat 1 (minimal):** on the driver page, tab **Vehicle Photos**: the inspections of the driver (type, date, status, photo count), buttons
Send / re-send link, Copy link, Revoke and reissue.
**Chat 2:**
- Check-In Photos and Check-Out Photos sections, grouped by contract, newest first, paginated; a check-out sits next to its
  check-in. Each headed with date and time, odometer, fuel, status. Grid of the 19 shots in order, then the damage photos with the driver's note.
- Click a photo: full screen with zoom, captured time, GPS, note, download the original. Photos are served by short-lived signed URLs only.
- Mark reviewed, Add staff note, the activity log. Summary card on the driver's ledger page (check-in and check-out: date, vehicle, status,
  photo and damage counts, View; "Not yet" with the send button) and a red badge when a photo is flagged as damage or an inspection is unreviewed for over 24 hours.
- **Compare view:** check-in photo left, check-out photo right for each of the 19 shots; odometer and fuel for both with miles driven and
  fuel change; mark each pair No change or New damage (creates a damage item, `staff_flagged`, `new_during_rental`) and **Create charge** opens the
  existing ledger entry form pre-filled; damage already present at check-in is listed and never charged.
- Download all (ZIP of the photos plus a one-file PDF report).
- Permissions: admin only (there are no dispatch or manager roles).

## 9. API (all documented in OpenAPI; staff routes admin only, public routes token only)
- Staff: `POST /drivers/:id/inspections` (create or return the open one), `POST /inspections/:id/send`, `POST /inspections/:id/reissue`,
  `POST /inspections/:id/revoke`, `GET /drivers/:id/inspections`, `GET /inspections/:id`, photo URLs; chat 2 adds review, notes, compare, damage items, export.
- Public: `GET /i/:token` (state, vehicle, shot list, prior damage), `PUT /i/:token/photos/:shotId` (one photo, idempotent),
  `POST /i/:token/submit`, `POST /i/:token/language`.

## 10. Steps
**Chat 1 — "Vehicle inspection: link and capture page".** Each step ends with tests and something to check by hand.
1. Migration and entities (`inspections`, `inspection_shots` seeded, `inspection_photos`, `inspection_events`, `drivers.preferred_language`); the driver form field.
2. Staff link API and the Vehicle Photos tab (create, send through Quo, copy, revoke, reissue, expiry).
3. Public capture API (state, upload, submit, resume, rate limit).
4. Capture page: screens, translation file, baseline camera, readings, upload, resume, submit.
5. Damage photos, attestation, expired or revoked screens; then quality check, live viewfinder, IndexedDB queue. **Checked on a real iPhone and a real Android phone**, with a temporary link on staging.

**Chat 2 — "Vehicle inspection: staff review and compare".** 1 Check-In / Check-Out sections and the photo viewer with signed URLs; 2 review, notes, activity log, ledger summary card and badges; 3 compare view, damage items, Create charge; 4 ZIP and PDF report.

## 11. Not built (BACKLOG B139)
Automatic links (agreement signed, morning of return), the 2-hour late flag and reminder text, the confirmation text, email delivery of the link,
Task Board, dispatch and manager roles, vehicle record and history across drivers, spot checks and vehicle swaps, deposit return, Phase 2 AI comparison,
the `inspect.gonzocar.com` subdomain, the driver-name folder layout in storage.

## 12. Sources
| Field / rule | Source | Status |
|---|---|---|
| Guided capture on the driver's phone, fuel, mileage, upload with retry | CLIENT_SCOPE.md, Module 3 | from a document |
| Staff review, side-by-side compare, new damage flagged, history, report | CLIENT_SCOPE.md, Module 3; spec pp. 1, 11 | from a document |
| Damage charge posted by staff from a flagged inspection, not automatically | Spec p. 1 (out of scope: automatic charges); chat 2 opens the existing ledger form | from a document |
| Link texted to the driver, no login, no app | Spec pp. 1, 3, 4 | from a document |
| Manual sending only, no automatic triggers | Abulkalam, 2026-11-16 | decided by Abulkalam |
| Random token (hash stored), one link per inspection | Abulkalam, 2026-11-16; spec p. 3 (random 32+ characters, not the driver ID, one open session per type) | decided by Abulkalam |
| Token expiry 24 hours (a setting), closes on submit, resend or revoke and reissue | Spec pp. 3, 4 | from a document |
| 19 required shots in order, one config table | Spec pp. 5 to 7 | from a document |
| Odometer: photo and typed mileage; fuel: photo and one-tap level | Spec pp. 4, 5, 7 | from a document |
| Damage photos, up to 15, each with a short note; check-in damage shown at check-out | Spec pp. 5, 7 | from a document |
| One checkbox attestation, no typed name | Spec pp. 4, 5 | from a document |
| Resume from the same link; background upload; camera only for required shots; compression, quality check, IndexedDB | Spec pp. 4, 5, 12 | from a document |
| Server time stamp and SHA-256 of every photo; originals never edited | Spec pp. 9, 13 | from a document |
| GPS captured silently if the phone allows it | Spec p. 4 | from a document |
| English and Spanish, strings from the translation file; `preferred_language` on the driver | Spec p. 12; i18n JSON; Abulkalam, 2026-11-16 | from a document |
| Vehicle copied from the contract; typed when there is no contract | Abulkalam, 2026-11-16; the typed-in form for a driver without a contract is ours | decided by Abulkalam / our suggestion |
| `inspection_events` log; staff actions also in `audit_logs` | Spec pp. 11, 13 (full activity log, audit trail); D95 | from a document |
| Photos kept under ids, not driver-name folders | Ours (names change; spec p. 10 proposes names) | our suggestion |
| Rate limiting on the token routes | Spec p. 13 | from a document |
| Vehicle Photos tab on the driver page, check-in and check-out sections by date, ledger summary card, badges | Spec pp. 10, 11 | from a document |
| Compare view with miles driven and fuel change; mark No change / New damage | Spec p. 11 | from a document |
| Signed, expiring URLs for staff viewing; download original | Spec pp. 11, 13 | from a document |
| ZIP and one-file PDF report | Spec pp. 10, 11 | from a document |
| One open inspection per type per driver, enforced by a partial unique index | Spec p. 3 (one open session per type per driver + vehicle + agreement); D103 narrows it to driver + type (no vehicle swaps) | decided by Abulkalam (plan approved 2026-11-16) |
| A link cannot be shown again: Send and Copy make a fresh token | D102 (only the hash is stored); D103 | decided by Abulkalam |
| Vehicle Photos is a card on the driver page, not a tab | Spec p. 11 says tab; the page has no tab strip; D103 | decided by Abulkalam |
| Thumbnail made on the server; in-memory per-IP rate limit; note length 200; `inspection_events.type` as text | Ours (D103) | our suggestion |
| Database checks: submitted needs time, attestation, mileage and fuel; damage photos numbered 1 to 15; SHA-256 format; no negative mileage | Spec pp. 4, 5, 7, 9 (the rules), enforced in Postgres | from a document / our suggestion |
| Staff routes: make (or return the open one), list, one with its log, send, reissue (copy), revoke; admin only; each action in `inspection_events` and `audit_logs` | Spec p. 12 (API), pp. 3, 4 (resend, revoke and reissue); D95 | from a document |
| The link text in the driver's language through the Quo chat; `dry_run` saves it only | Spec p. 3 (SMS template), p. 12; translation file `sms`, kept word for word | from a document |
| A driver who texted STOP is not sent the link; Copy link instead | PHASE1_SPEC section 8 (never message an opted-out driver) | our suggestion |
| Typed vehicle only when the contract holds none; only the model required | Abulkalam, 2026-11-16 (typed when no contract); the required model is ours | decided by Abulkalam / our suggestion |
| `created` = no link yet and never expires; the token is saved before the text; link hours in `app_settings` (`inspection_link_hours`, default 24) | Spec p. 4 (24 hours, configurable); D104 | from a document / our suggestion |
| Vehicle Photos card: Send check-in / check-out link, Send again, Copy link (shown once), Revoke, list with status and photo counts | Spec p. 11 (Send / resend link, Revoke link); D103 (a card) | from a document |
| Public routes `GET /i/:token`, `PUT /i/:token/photos/:shotId`, `POST /i/:token/submit`, `POST /i/:token/language`; the upload is idempotent; submit refuses a missing shot, mileage or fuel level | Spec pp. 12, 13 (API, upload with retry, validates all 19 shots); the PUT and its shape are in section 9 above | from a document |
| Odometer and fuel level saved with their photos | Spec pp. 4, 5, 7, 14 | from a document |
| The photo is stored under an id key with a server-made 400 px thumbnail; a retake replaces it and is counted; JPEG only | Spec pp. 9, 12 (retake count, compression); D103, D105 | our suggestion |
| An unknown token reads "expired", like a real one that ran out | Spec p. 14 (clear expired message); section 6 above (unknown tokens answer as expired) | decided by Abulkalam |
| Per-address rate limit of 300 requests a minute on the link routes | Spec p. 13 (rate limiting on token endpoints); the number is ours | from a document / our suggestion |
| Location and device info sent with the submit, location only as a pair | Spec p. 4 (GPS silently if allowed), p. 8 (device info) | from a document |
| `INSPECTION_SUPPORT_PHONE` for the "Call GonzoCar" button | Translation file `link_status.contact_button`; the number is not in any client document (B141) | open question |
| The capture page `/i/:token` (public, no login): welcome (headline, vehicle line, language switch, tips), the 19 shots one by one, submit, done; link-status screens | Spec pp. 4 to 7, 12, 14 (the guided walk-around, clear expired message) | from a document |
| Texts: the client's translation file (version 1.2) kept byte for byte; seven extra words (loading, load error, Next, photo unreadable / uploading / saved / not uploaded) in a separate file | Translation file; the seven extras are ours and the Spanish needs the client's read (B142) | from a document / our suggestion |
| Page language: the phone's language, else the choice made on this phone; a choice is also saved on the driver | Translation file `_meta.default` | from a document |
| Vehicle line: our one typed model text takes the place of year, make and model; a missing plate or VIN end drops its part | Translation file `welcome.vehicle_line`; B140 (the contract keeps one model text) | our suggestion |
| Photo scaled to 2048 px on the longest side and saved as JPEG (0.8) on the phone; the capture time is the photo file's time | Spec p. 12 (compression on the phone); the two numbers are ours | from a document / our suggestion |
| Photos sent one at a time in the background; retried after 2, 4, 8, 16 then every 30 s on no signal or a server hiccup; stops on a refusal with "Try again"; retried at once when the phone is back online | Spec pp. 4, 12 (background upload, retry); the waits are ours | from a document / our suggestion |
| A reopened link resumes at the first shot still missing (or the submit screen) | Spec p. 4 (resume from the same link); translation file `resume` | from a document |
| A normal shot moves on by itself after its photo; the odometer and fuel shots wait for the reading and Next; the previous photo's corner thumbnail and a tap on any photo on the submit screen retake it | Spec pp. 4, 5; translation file `capture.tap_thumb_retake`, `submit.thumbs_hint`; the auto-advance is ours | from a document / our suggestion |
| Mileage typed with digits only (up to 7); fuel level one tap among nine | Spec pp. 4, 5, 7; translation file `readings`; the 7-digit limit follows the server's 2,000,000 | from a document / our suggestion |
| "+ Damage note" on any shot: a note of up to 200 characters with a counter | Translation file `capture.damage_note_*`, `capture.chars_left`; the 200 is ours (D103) | from a document / our suggestion |
| The page reads the phone's location at "Begin" only if it was already allowed (never asks) and sends it with the submit | Spec p. 4 (GPS silently if allowed), p. 8 | from a document |
| Unit tests for the page's own logic (vitest added to the frontend) | Ours (D106) | our suggestion |
| Damage photos on the capture page: "Any other damage?" after the last shot, up to 15 photos each with a short note, the coin tip, "Add another (n of 15)", "Done"; on a check-out the check-in damage is listed first | Spec pp. 5, 7; translation file `damage` | from a document |
| The damage note is optional | Ours (the spec says each photo has a note but not that it is required) | our suggestion |
| Quality check before a photo is accepted: too dark, blurry; a warning text, the photo is still kept and uploaded, a normal shot does not move on by itself after a warning | Spec pp. 5, 12; translation file `capture.quality_dark`, `capture.quality_blurry`; "warn, never block" and the two thresholds (average brightness 45 of 255, sharpness 25) are ours, to tune on real phones (B143) | from a document / our suggestion |
| Live viewfinder: the rear camera full screen with a shutter button, no outline images; the phone's camera app when the browser has no live camera or the driver chooses it; the client's "Camera is blocked" help with Try again | Spec pp. 4, 12; translation file `permissions`; no outlines until artwork exists (B138) | from a document |
| Photos kept on the phone (IndexedDB) until the server has them and put back in the upload line when the link is reopened; dropped after 7 days, on submit, or when the link is closed | Spec p. 12 (IndexedDB queue); the 7 days are ours | from a document / our suggestion |
| "Saved on your phone. It will upload when you have signal." while a photo waits and the phone is offline | Translation file `capture.saved_offline` | from a document |
| Two chats, order of steps | Abulkalam, 2026-11-16; step order is ours | decided by Abulkalam / our suggestion |

## 13. Open questions
- Overlay artwork for the framing outlines on the 19 shots (B138); until supplied the live viewfinder shows no outline.
- Spec details to confirm with the client (B140): the data model still lists a per-photo "damage visible" toggle and a typed attestation
  name that the driver flow removed; a link sent at signing would expire before a pickup days later (moot while sending is manual).
