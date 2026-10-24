# Module 2 Spec — Driver Contracts and E-Signature

Contracts (vehicle lease agreements) are filled in from our data, sent to the driver to sign online, and the signed copy
lands on the driver's file. Started 2026-10-20. Decisions: D70 (signing provider), D71 (rate calculation), D72 (company signature), D73 (contract details), D74 (sending), D75 (tracking and filing).

**Scope rule:** keep it simple. Build the steps below one at a time; everything under "Later" waits until the client asks
for it after using the first version.

---

## 1. What the client uses today
- **One lease template**, typed by hand per driver in Google Docs, signed through PandaDoc. Five samples received
  2026-10-19 (real driver data: never copy into the repo).
- **Versions:** Illinois and California texts (they differ in region, tolls, governing law and a few fees). A Tennessee
  version exists, not seen yet. Each contract names one of the companies (the "Lessor"):

  | Company | State | Address on the contract |
  |---|---|---|
  | Gonzo Enterprises Inc | IL | 2515 Waukegan Rd, Suite 340, Bannockburn IL 60015 |
  | Gonzo Enterprises Inc | CA | 1107 S State St, Unit 11, Ukiah, CA 95482 |
  | Evergreen Holdings LLC | IL | 114 E Everett St, Ste 130, Dixon IL 61021 |
  | Ashwood Holdings LLC | IL | 114 E Everett St Ste 176, Dixon IL 61021 |
  | Silver Pine Holdings LLC | IL | 3902 W North Ave, Chicago IL 60647 |

- **Rate sheet (Illinois only):** the admin types the total rate (cell B8); five lines are formulas of it:
  base 42%, insurance 30%, unlimited miles 13%, maintenance 10%, taxes 5%. Everything else in the sheet (deposit, one-time
  fees, weekly payment, totals, lease term) is typed by hand, and the received copy is out of step (total $399, weekly
  payment $409, due at pickup $609). The client asked for "an applet" that does this in our system (Saad, 2026-10-19).
- **Contract header fields:** effective date; company and address; driver name, address, licence number, licence state,
  date of birth, email, phone; vehicle model, VIN, plate, plate state; lease term with start and end date; the rate
  disclosure (above); one-time charges (security deposit, documentation fee, insurance policy start fee, other, hold vehicle
  payment, total); amount due at pickup; recurring charges (weekly or daily payment, excess mileage per mile, insurance
  excess per month, other, total). In the text: purchase option price.

## 2. Steps

| # | Step | Done when |
|---|---|---|
| 1 | **Rate calculator.** A contract draft on the driver: admin types schedule (daily or weekly), total rate, start date, term, one-time and recurring charges; the system calculates the breakdown, totals, amount due at pickup and end date (D71). | Admin creates, edits and deletes a draft from the driver page; numbers match the sheet. |
| 2 | **Contract details.** Company (from a fixed list of five, D73), vehicle (typed: model, VIN, plate, plate state) and purchase option price on the draft. The driver's name, email and phone come from the driver record; the address, licence number, licence state and date of birth are typed on the draft (the driver record and the website form do not hold them). All optional, nothing checked beyond a length limit; completeness is checked when sending (step 3). | Draft holds every value the contract header needs. |
| 3 | **Send for signing (firma, D70, D74).** The client's Illinois Google Doc, exported as PDF with `{{MARKER}}` texts where values go, is the template, stored in our repo (one for all four Illinois companies; the sample driver's licence photo removed). "Send for signing" on the contract page uploads that PDF to firma on every send, with one anchor per marker that makes a locked field holding the draft's value (firma's anchor tags do not work with templates stored in firma); the driver signs from firma's email link; the company's signature is its **entity name printed as a plain locked text before the driver signs** (D72; firma cannot set the font of an anchored field), so the driver is the only signer. Values sent are frozen on the contract; a sent contract cannot be edited or deleted. Send is refused until every value is filled, and for a company whose state has no template (Illinois and California are built, D76). | A test-mode contract is signed end to end (done 2026-10-21 with the firma test key). |
| 4 | **Track and file (D75).** The contract's status follows firma: sent, viewed (the driver opened it), then signed, declined, expired or cancelled. **One function decides:** it asks firma for the signing request and applies the answer. A firma webhook (`POST /webhooks/firma`, signed) and a 5-minute scheduled check only trigger it, so a lost, repeated or late webhook is harmless (firma tries only 3 times). A contract only moves forward and an end state never changes. When the driver signs, the signed PDF (with firma's certificate page) and the certificate alone are copied into our private bucket by a retried job (a failure shows on the contract page), and "Contract signed" (D56) is ticked by the system in the same transaction. | Status and date on the contract page and the driver's Contract card; "Open signed contract" and "Certificate" open the saved files; the driver's step says "automatic". |

**Later (not now):** reminders to sign, a vehicle list, the Tennessee version, car swap / rate change /
renewal, contract charges posted to the ledger, billing settings taken from the contract (M2).

## 3. Open questions (minimal, B91)
1. **Company signature** (settled 2026-10-21, D72): the signature is the name of the entity (Evergreen Holdings LLC, Gonzo, Silver Pine,
   ...), preprinted on each contract and bearing the signature first. No one at the company signs each contract.
2. **Totals** (not a question, shown in the step 1 demo): payment = the total rate, amount due at pickup = first payment +
   one-time charges, end date = start date + term months (D71). The samples agree: $409 + $200 = $609, $399 + $250 = $649,
   daily $61 + $300 = $361. The client corrects it if wrong.
3. **California and Tennessee:** California is built (D76, 2026-10-24: Abulkalam, from the client's California sample); its disclosure
   split is the same as Illinois (checked against the sample). Tennessee: not asked now; only when the client wants it.
4. **firma account:** not asked now. We build and test on our own free test account; the client's account is set up at
   go-live.

## 4. Sources
Why each field and flow step exists, so anything in the demo can be explained (workspace `CLAUDE.md`, 2026-10-21). Rows are
added in the task that builds the field. **Status:** *client-confirmed* = the client said it or accepted it; *from a
document* = read from a client document (a sample contract, the rate sheet, the scope PDF) but never confirmed by the client
as a requirement; *our suggestion* = ours, to be shown to the client. "Sample contract" = the five samples received
2026-10-19.

### Flow
| Flow step | Source | Status |
|---|---|---|
| Admin creates the draft from the driver page, numbers worked out by the system (step 1, built) | Saad's message, 2026-10-19: the client asked for "an applet" that does this | client-confirmed |
| Send for signing from the contract page (step 3, built) | Scope PDF, Module 2 ("sends it for signature"); signing provider chosen by the client (D70); Saad's "applet" message | client-confirmed |
| The company's signature is its entity name, printed before the driver signs (step 3, built) | Client message via Saad, 2026-10-21 (D72) | client-confirmed |
| Track the status and file the signed PDF; "Contract signed" ticked automatically (step 4, built, see "Step 4" below) | Scope PDF, Module 2 (status at each stage, signed PDF and audit trail stored, driver activated); D56 | from a document |

### Step 1 fields (rate calculator, D71)
| Field | Source | Status |
|---|---|---|
| Payment schedule, weekly or daily | Sample contracts (weekly and daily rate lines) | from a document |
| Total rate | Rate sheet cell B8, the one typed number; Saad's "applet" message | client-confirmed |
| The five lines as 42 / 30 / 13 / 10 / 5 % of the total (Illinois) | Rate sheet formulas | from a document |
| Rounding: cents rounded half up, base takes the remainder so the lines add up | Ours (D71); the sheet only had whole-cent results | our suggestion |
| Start date, term in months (default 18), end date = start + term | Sample contracts, header "lease term with start and end date"; all samples run 18 months | from a document |
| One-time charges: security deposit, documentation fee, insurance policy start fee, other, hold vehicle payment | Sample contract header | from a document |
| Recurring charges: excess mileage per mile, insurance excess per month, other | Sample contract header | from a document |
| Payment = total rate; amount due at pickup = first payment + one-time charges; recurring total | Our reading of the rate sheet and the samples ($409 + $200 = $609 and similar), D71, B91 question 2 | our suggestion |
| Lease disclosure summary shown beside the form | Sample contract's rate disclosure block | from a document |
| Live preview while typing | Ours | our suggestion |
| Largest rate or charge $10,000; term from 1 to 60 months | Ours (step 1, already deployed) | our suggestion |
| One draft per driver; a draft can be deleted | Ours (step 1, already deployed) | our suggestion |

### Step 2 fields (contract details, D73)
| Field | Source | Status |
|---|---|---|
| Company, chosen from a list of five (name and address as the "Lessor:" line) | Sample contracts, "Lessor:" lines | from a document |
| The company name printed as its signature | Client message via Saad, 2026-10-21 (D72) | client-confirmed |
| Vehicle model, VIN, plate, plate state | Sample contract header | from a document |
| Purchase option price | Section 15 of the sample contracts (not in the rate sheet) | from a document |
| Driver's address, licence number, licence state, date of birth | Sample contract header | from a document |
| Effective date: not a separate field, it is the start date from step 1; step 3 prints it in both places (the "Effective Date" line and the first date of the lease term) | "Effective Date" line under the title of each sample contract; equals the lease term start in all five samples; the rate sheet has no effective-date cell. Settled in planning chat 07, 2026-10-21 | from a document |
| Details typed on the draft, not stored on the driver | Abulkalam, planning chat 07, 2026-10-21 (the driver record and website form do not hold them) | our suggestion |
| All details optional; only a length limit on each | Ours: the client asked for the values, not for rules about them | our suggestion |
| Licence number and date of birth kept out of lists and logs (encryption planned, B94) | Ours: personal data | our suggestion |
| Company list fixed by the migration, no screen to change it (B93) | Ours: five companies, simplest first | our suggestion |

### Step 3 fields and flow (send for signing, D74)
| Field or step | Source | Status |
|---|---|---|
| Driver signs by an email link from firma; the driver is the only signer | Client message via Saad, 2026-10-21 (D72) | client-confirmed |
| Company name printed in the signature block | Client message via Saad, 2026-10-21 (D72) | client-confirmed |
| The company name is shown as plain text, not in a script font | Ours: firma cannot set the font of an anchored field (D74); the client may ask for a script look (B95) | our suggestion |
| One PDF template from the Ashwood sample, used for all four Illinois companies | Line-by-line comparison of the four Illinois samples, 2026-10-19 | from a document |
| The sample's licence photo is removed from the template (it is a real person's licence); the driver's own licence file is drawn on the last page when sending (D76) | The client's samples have the driver's licence photo on the last page under "Driver License"; the file is the one on the driver's application. Abulkalam allowed sending it to firma, 2026-10-24 | from a document (the page); our suggestion (the source of the picture) |
| Values printed from the draft, formatted as in the samples ($409.00, October 13, 2026, 04/04/1983, (872) 287-9566, purchase option $9,750) | Sample contracts | from a document |
| Send is refused until every value is filled, naming the empty ones | Ours: a sample contract has no blanks | our suggestion |
| A sent contract is frozen: no edit, no delete; the sent values are kept as a copy | Ours; the scope PDF says the signed copy is the legal record | our suggestion |
| A state with no template cannot be sent (Tennessee, none exists yet) | Ours: the samples differ by state | our suggestion |
| "Sent" with its date on the contract page and the driver's Contract card | Ours (status updates come in step 4) | our suggestion |

### Contract fixes and the California contract (D76)
| Field or step | Source | Status |
|---|---|---|
| A California template (Gonzo Enterprises Inc, Ukiah), built from the client's California sample the way the Illinois one was: values replaced by markers, the sample's signature and licence photo removed | The client's California sample (a Google Doc "Gonzo Enterprises Inc:CA Contract Template", 2026-10-19) and Abulkalam's decision, 2026-10-24 | from a document |
| The California disclosure uses the same split (42 / 30 / 13 / 10 / 5 %) and the same reading of the totals | Checked against the California sample's own table, 2026-10-24: every line matches the split and amount due = total + deposit | from a document |
| One template per state, chosen by the company's state | Ours: the texts differ by state | our suggestion |
| The driver's licence file (application document, kind licence) is drawn on the contract's last page; sending is blocked with a message when there is none or it cannot be read | The client's samples have it; Abulkalam: block when missing, allowed to send it to firma (2026-10-24) | from a document (the picture); client-confirmed by Abulkalam (blocking) |
| Markers renamed so none repeats on a page, long names shortened, one line break before "Plate:", amounts right-aligned | Ours: firma only covers a marker with a white box, so a repeated or too-wide marker left marks and misaligned values in the first signed contract; the wording of the contract is unchanged | our addition |

### Step 4 flow (track and file, D75)
| Field or step | Source | Status |
|---|---|---|
| The contract's status follows firma: sent, viewed, signed | Scope PDF: "status visible at each stage: sent, viewed, signed, countersigned" (no countersigning here, D72) | from a document |
| Declined, expired and cancelled are shown too | Ours: firma has these states and a contract can end in them | our suggestion |
| The signed PDF and the signature certificate are kept in our own storage | Scope PDF: "stored against the driver record permanently, with the audit trail and signer certificate"; D70 (no record depends on firma) | from a document |
| Signing ticks "Contract signed" on the driver by itself | Scope PDF: "flips the driver to active when signing completes"; D56 makes `active` need all three steps, so we tick one step and D56 does the rest | from a document |
| The tick is the system's (no admin); an admin's earlier tick keeps its date and admin; an inactive driver gets the date but stays inactive | Ours: follows D56 (steps, inactive locked) | our suggestion |
| A webhook from firma plus a 5-minute scheduled catch-up; the webhook only triggers a look-up, firma is asked for the real state | Ours: firma delivers an event only 3 times (D70), so a missed event needs the job; asking firma makes a repeated or forged event harmless | our suggestion |
| A failed save of the signed files is shown on the contract page and retried | Spec rule 5, no silent failure | from a document |
| The signed PDF opens through short-lived links from a private bucket | Ours: same as the application documents (D54); the PDF holds the licence number and date of birth (B94) | our suggestion |
| The contract page refreshes by itself every 30 seconds while the contract waits for the driver | Ours: the status changes without the admin doing anything | our suggestion |
