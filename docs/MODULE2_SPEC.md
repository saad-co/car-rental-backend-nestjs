# Module 2 Spec — Driver Contracts and E-Signature

Contracts (vehicle lease agreements) are filled in from our data, sent to the driver to sign online, and the signed copy
lands on the driver's file. Started 2026-10-20. Decisions: D70 (signing provider), D71 (rate calculation).

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
| 2 | **Contract details.** Company (from a list), vehicle (typed: model, VIN, plate, state), purchase option price on the draft. Driver details come from the driver and application. | Draft holds every value the contract header needs. |
| 3 | **Send for signing (firma, D70).** The client's Illinois Google Doc, exported as PDF with `{{MARKER}}` texts where values go, is the template (firma anchor tags); "Send" creates a signing request with the draft's values as locked fields; the driver signs from an email link; the company's signature is its **entity name, preprinted on the contract before the driver signs** (D72), so the driver is the only signer. Values sent are frozen on the contract. | A test-mode contract is signed end to end. |
| 4 | **Track and file.** firma webhooks move the status (sent, viewed, signed, declined, expired); a scheduled check catches events firma could not deliver (it tries only 3 times); the signed PDF and certificate are copied into our storage; "Contract signed" (D56) is ticked automatically. | Status on the driver page; signed PDF opens from the driver's file. |

**Later (not now):** reminders to sign, a vehicle list, California and Tennessee versions, car swap / rate change /
renewal, contract charges posted to the ledger, billing settings taken from the contract (M2).

## 3. Open questions (minimal, B91)
1. **Company signature** (settled 2026-10-21, D72): the signature is the name of the entity (Evergreen Holdings LLC, Gonzo, Silver Pine,
   ...), preprinted on each contract and bearing the signature first. No one at the company signs each contract.
2. **Totals** (not a question, shown in the step 1 demo): payment = the total rate, amount due at pickup = first payment +
   one-time charges, end date = start date + term months (D71). The samples agree: $409 + $200 = $609, $399 + $250 = $649,
   daily $61 + $300 = $361. The client corrects it if wrong.
3. **California and Tennessee:** not asked now; only when the client wants those contracts.
4. **firma account:** not asked now. We build and test on our own free test account; the client's account is set up at
   go-live.
