# Pinch Runway

> Pinch helps a business get paid. Runway tells the owner what to do while they are still waiting.

Pinch Runway is a pings-first cash-flow companion for Australian sole traders
who collect from their own clients through Pinch. It focuses on one gap that a
bank cannot see: money already earned but not yet landed.

It is deliberately **not** a household budget, bank-feed product, personal
financial-advice tool, email/calendar integration, or salaried-employee flow.

## Current scaffold state

The foundation is ready for three people to build against in parallel:

- shared TypeScript contract in `lib/contracts.ts`, with integer cents and
  explicit data provenance;
- deterministic, clearly non-live fixtures for Comfortable, Safe, Tight, and
  Shortfall in `lib/demo-fixtures.ts`;
- a pings-first fixture dashboard that cannot present seed data as live Pinch
  data;
- server-only Pinch token/client primitives and a real read-only health probe
  at `GET /api/pinch/health`;
- a CI workflow, environment template, live-sandbox runbook, and publish-ready
  issue backlog in `docs/backlog/`.

The sandbox credential path has now made a real Payer read and a real Payment
Link write; redacted proof is recorded in
[`docs/pinch-sandbox-evidence.md`](docs/pinch-sandbox-evidence.md). The product
UI remains an explicitly labelled fixture preview until Lane A completes the
normalised live snapshot and reliability adapter. Run `npm run
check:pinch-sandbox` only after adding real sandbox credentials and setting
`RUNWAY_DATA_SOURCE=sandbox`. That command makes an authenticated request to
the real Pinch sandbox; it does not fall back to fixtures.

## The hard Pinch boundary

The published Pinch API exposes Payers, Payments, Payment Links, and payment
attempt history. It does not currently document an Invoice resource or an
email/SMS reminder-send endpoint.

Therefore, this repo makes these facts explicit:

- Runway’s `Invoice` is a normalised product type built from a real Pinch
  Payment/Payment Link, never invented JSON that mimics an API response.
- A scheduled Pinch Payment’s `transactionDate` may only be treated as a due
  date when the sandbox records are configured with that meaning.
- Reliability compares the scheduled payment date with a successful attempt’s
  `transactionDate`; it must not use `actualTransferDate`, which is settlement
  timing rather than payer lateness.
- The real write action is **Create Pinch payment link**. If Pinch only creates
  a URL, the UI must say “Payment link ready to share,” not “Sent via Pinch.”

See [ADR 001](docs/adr/001-pinch-payments-not-invoices.md) for the rationale
and primary documentation links.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

The dashboard is available at the local address printed by the development
server. It begins in explicitly labelled `seed` mode.

### Live Pinch sandbox check

Add the application ID and secret key to `.env.local`, then set:

```dotenv
RUNWAY_DATA_SOURCE=sandbox
PINCH_APPLICATION_ID=...
PINCH_SECRET_KEY=...
```

Run:

```bash
npm run check:pinch-sandbox
```

Expected proof is a successful `GET /test/payers` request using a server-side
OAuth client-credentials token. The same read-only probe is exposed at
`/api/pinch/health`; it returns a failure state instead of fixtures when Pinch
is unconfigured or unavailable.

Never put a Pinch secret in a `NEXT_PUBLIC_*` variable, browser request, test
fixture, screenshot, or log.

### Deliberate test-data bootstrap

After the read-only check passes, this explicit, test-only command creates two
labelled sandbox Payers. Adding the second flag creates one real sandbox
Payment Link for the first Payer. It never calls Pinch's live base URL, never
prints the returned link URL, and never sends a reminder or email.

```bash
npm run bootstrap:pinch-sandbox -- --confirm-test-write --create-payment-link
```

The command reuses Payers with its fixed test email addresses, but every use of
`--create-payment-link` deliberately creates a new link. Do not rerun that
flag unless a new sandbox link is intended.

## Development commands

```bash
npm run lint
npm run test:domain
npm run build
npm test
```

`npm test` runs pure contract/client tests, builds the app, and checks the
rendered page. It intentionally does not perform a live sandbox call in CI.

## Team lanes

There are exactly three lanes. Claim the first open issue in one lane, assign
yourself on GitHub, and work forward through its dependencies rather than
starting a second lane in parallel.

| Lane | Owns | Starts with |
| --- | --- | --- |
| A — Pinch (**AsherNoble**) | authenticated live reads, normalisation, payment history/reliability, Payment Link write | [`PIN-01` / #4](https://github.com/AsherNoble/pinch-runway/issues/4) |
| B — Engine | seven-day forecast policy, four states, payer-choice reasoning, ping copy | `ENG-01` |
| C — Frontend | pings feed, declared-input flows, fallback dashboard, live action UX | `UX-01` |

**Lane B:** start with [ENG-01 / #9](https://github.com/AsherNoble/pinch-runway/issues/9).

**Lane C:** start with [UX-01 / #13](https://github.com/AsherNoble/pinch-runway/issues/13).

Each issue is also labelled `lane:pinch`, `lane:engine`, or `lane:frontend`.
The full dependency map remains in
[`docs/backlog/`](docs/backlog/README.md). All checkpoint-critical work is
marked `P0` and carries its live-sandbox gate.



## Tomorrow’s live gate

The demo is only ready when all five gates have evidence:

1. **G1:** authenticated real-sandbox endpoint/field mapping.
2. **G2:** normalised snapshot derived from real Payers and Payments.
3. **G3:** reliability derived from real paid history/attempts.
4. **G4:** a confirmed real sandbox Payment Link/payment-request write.
5. **G5:** a deployed end-to-end rehearsal using fresh sandbox data.

If a Pinch field, endpoint, or dispatch capability is unavailable, record it as
a hard blocker. Do not substitute a mock, make up a due date, or say a link was
sent when it was only created.
