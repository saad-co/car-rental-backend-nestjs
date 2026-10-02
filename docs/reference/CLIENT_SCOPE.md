# Client Scope Document (as sent to the client)

> **Read this for context, not as requirements.**
> This is the scope and working-plan document sent to the client (Jason) in September 2026.
> It records what was proposed and what the client expects. It is not the build spec.
>
> **Where this conflicts with `../PHASE1_SPEC.md` or `../DECISIONS.md`, those win.**
>
> Known to be outdated or superseded:
> - **"Moving the prototype off browser storage"** (Estimates section). Wrong. The client has a working
>   FastAPI system, not a localStorage prototype. We are building a new system alongside it (D1, D2).
> - **Modules 2 and 3** (contracts, vehicle condition) are not in Phase 1 (D14).
> - **Two-stage posting** is described as applying to every payment. It only works for Zelle.
>   Cash App and Venmo post in one stage (D8, unconfirmed).
> - **Estimates** below are what was communicated to the client: 20 hours setup, 36 hours Module 1.
>
> Kept verbatim below so the record of what was promised is accurate.

---

# Fleet Operations Platform
## Scope, Approach and Working Plan — First Three Modules

Prepared by Saad Naveed for Jason Jon

## How I read what you're building

These three modules aren't separate products. They're one chain.

A signed contract activates a driver, assigns them a vehicle and starts their rent clock. The payments module bills against that clock and keeps the ledger straight. The condition module records what the car looked like when it went out, so damage is provable when it comes back — and any damage charge posts straight back into the same ledger.

That's why I'd start with payments. The ledger is the spine everything else writes into.

## Module 1 — Payments and SMS Reminders

### What it does

Money arrives through several channels, lands against the right driver's ledger, and anyone falling behind gets chased automatically until they pay.

### Where payments come from

Zelle and direct bank deposits are read from your business bank account through Plaid, filtered strictly so only Zelle credits enter the pipeline — regular deposits, checks, bill pay and other ACH items are excluded before they ever reach the ledger. Cash App and Venmo come in from the confirmation emails, since that money sits in the app balance and only reaches your bank as a lump sum.

### Matching — an LLM rather than hand-written parsers

This is worth explaining, because it changes how the module holds up over time.

The usual approach is writing a separate parser for each provider's email format. It works on day one, but it's brittle. When Cash App or Venmo redesigns their receipt template, the parser silently stops matching and someone has to notice and go fix it.

Instead I'd pass the email to an LLM along with the driver list and expected amounts, and have it return a structured result — who paid, how much, when, and how confident it is. No hardcoded rules, no dependence on a fixed layout. When a provider changes their format it keeps working, because the model reads the email the way a person would rather than matching fixed patterns.

It also handles the cases rules struggle with: a payment sent by a driver's wife, a different spelling of a name, a partial payment against an outstanding balance.

Anything it isn't confident about drops into an unrecognised bucket for manual assignment, exactly as you described. Once a staff member assigns a sender to a driver, that link is remembered permanently and never needs assigning again. The bucket shrinks on its own rather than staying constant.

This is also the first real piece of the agent layer you described. Rather than agents being bolted on at the end, payment intelligence is an agent from day one — doing one narrow job where we can actually measure whether it's getting it right.

### Two-stage posting

The email marks a payment as reported and stops reminders immediately, so nobody is chased for money they just sent. The bank deposit then confirms it and posts it to the ledger permanently. This also closes the forged-receipt gap — a faked confirmation never confirms, it surfaces as a discrepancy rather than silently crediting someone's account.

### Also in this module

- Driver ledger with debits, credits, running balance and full history
- Recurring rent charges and automatic arrears calculation
- Quo SMS reminders with escalation tiers, stopping the moment a payment is reported
- Inbound replies and delivery status captured against the driver
- Payments dashboard — received, pending review, overdue, unrecognised
- Editable message templates and an on/off switch for every automated action

## Module 2 — Driver Contracts and E-Signature

### What it does

Generates a rental agreement from driver and vehicle data, sends it for signature, tracks it, stores it, and activates the driver automatically once it's signed.

### Approach

Contract templates with merge fields, so the agreement is built from the driver record and assigned vehicle rather than retyped. No mismatch between what the contract says and what the system holds. Templates editable by you without a developer, and more than one supported — different cities, different rate plans.

Signing goes out through an e-signature provider with status visible at each stage: sent, viewed, signed, countersigned. Automatic nudges to drivers who haven't signed. The signed PDF is stored against the driver record permanently, along with the audit trail and signer certificate that stand as the legal record in a dispute.

When signing completes, the system flips the driver to active, confirms the vehicle assignment, and starts the rent schedule in Module 1 on the contract start date. That handoff is the reason contracts and payments belong to the same platform rather than two tools.

The module also covers the lifecycle — renewals and extensions, amendments such as a vehicle swap or rate change, early termination with a reason recorded, and warnings ahead of contract expiry.

### One commercial note

The original brief named DocuSign. Worth comparing before committing — DocuSign's pricing escalates steeply once you want your own branding on the signing flow, with per-envelope charges on top. Several alternatives offer the same API capability at a fraction of that cost. The integration work is identical either way, so this is purely a commercial decision and I'd rather you make it with the numbers in front of you. If you already have a DocuSign account you're happy with, that's a perfectly good reason to stay.

## Module 3 — Vehicle Condition, Check-Out and Check-In

### What it does

Records a vehicle's condition when it goes out and when it comes back, so damage is documented rather than argued about.

### Driver side

A guided capture flow on the driver's phone, prompting angle by angle so nothing gets missed, with close-ups for any damage and tap-to-mark on a vehicle diagram. Fuel level, mileage, cleanliness and notes captured alongside.

Built as mobile web first so it works immediately without waiting on an app store release, and folds into the driver app later.

The part needing most care is upload reliability. Drivers will be standing in parking lots on weak signal sending fifteen or twenty photos. This needs compression and retry that survives a dropped connection or a backgrounded browser — it's where simpler implementations fail, and it's worth doing properly the first time.

### Staff side

A review screen to approve or dispute a submission, and a side-by-side comparison of check-out against check-in with new damage flagged automatically rather than spotted by eye. Alerts on submission and on missed or overdue check-ins.

### Records

Full condition history per vehicle, exportable as a report for insurance and disputes, with any damage charge posting directly to the driver's ledger in Module 1.

## Estimates

| | Hours |
|---|---|
| Setup and foundation | 20 |
| Module 1 — Payments and SMS reminders | 36 |
| Module 2 — Contracts and e-signature | 20 |
| Module 3 — Condition and check-in | 24 |
| **Total** | **100** |

Setup covers the database, authentication and roles, moving the prototype off browser storage, and deployment. Done once, with all three modules building on it.

At four hours per working day that's roughly five weeks for all three, delivered in pieces so you have something to test every week rather than waiting for everything to arrive at once.

## Starting with Module 1

Payments is the right place to begin, and not only because it's the most valuable. It's also the module that exercises most of the technology the rest of the build depends on — the database and backend, the front end, Plaid, email ingestion, the LLM matching layer, Quo SMS, and authentication and roles.

So by the end of the first module you'll have seen nearly the whole stack working on real data rather than a demo. The two things it doesn't cover are the e-signature integration and mobile photo upload, and I'm happy to build a small working slice of each alongside it if you'd like those proven early.

## How I'd work with you

**A short written update at the end of each working day.** What I finished, what's next, anything I'm blocked on. No meeting needed. Read it in thirty seconds, ignore it when you're busy.

**A weekly call, thirty minutes, for decisions rather than status.**

**Everything always running on a live URL.** Not on my machine. When something's ready you get a link and a one-line description of what to try, plus a short screen recording for anything visual so you can see it working without being at a computer.

**Definition of done agreed before I start.** For anything meaningful I'll write down what finished looks like in plain language and get a yes from you first. Two minutes of writing that prevents building the right thing to the wrong specification.

**Clear lines on decisions.** Technical calls — architecture, libraries, implementation — I make, and tell you afterwards if it matters. Anything that costs money, changes how the business operates, carries legal exposure, or affects what a driver sees comes to you first.

**Vendors are mine to handle.** Quo, Plaid, the signing provider and their support teams. You get the outcome, not the thread. If something needs your authority — an account, a signature, a payment method — I'll tell you exactly what's needed and why.

**Specialists where they're warranted.** Telematics hardware is the obvious one. I'd write the brief, vet them technically, manage the work and integrate it. You'd pay them directly and never sit in a call with them. I'd rather tell you now what I don't do than have you discover it on your fleet later.

## How I see this going

You said you're looking for a long-term partner rather than a project person, and that's what I want too. A platform like this gets more valuable the longer one person carries the context — knowing why a decision was made eighteen months ago is worth more than any single feature.

So the way I'd approach it: build in small pieces you can see and test, keep you informed without needing your time, take vendor and integration problems off your plate entirely, and tell you honestly when I think something is the wrong approach.
