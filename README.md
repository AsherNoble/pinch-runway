# Runway

Runway is a bank-aware cash-flow assistant for one Australian sole trader. It
keeps two ideas deliberately separate:

- **Cash available** is money currently accessible in selected AUD transaction
  and savings accounts.
- **Earned, not received** is the unpaid demo invoice ledger. It contributes to
  an expected position, but is never presented as spendable cash.

The bank connection is a real Basiq sandbox integration. Receivables are safe,
seeded D1 records and are labelled as demo throughout the product; they are not
live Pinch invoices.

## How the forecast works

Runway fetches up to 90 days of Basiq transactions during a sync. Raw
transactions and account numbers are not persisted.

- Posted debits form the historical baseline.
- Transfers, duplicate credit-card repayments, and owner exclusion patterns are
  removed.
- A recurring cost needs at least three payments with a consistent weekly,
  fortnightly, or monthly cadence and amounts within 10%.
- Recurring costs are projected on their observed cadence. Remaining variable
  spend uses its trailing daily average.
- Pending debits appear in the immediate outlook with a warning that they can
  change, but they do not affect the historical baseline.

The dashboard shows 30-day `cash_only` and `expected_with_receivables` paths.
The risk buffer is seven days of normal operating spend. An invoice follow-up is
recommended only when the cash-only path falls below that buffer during the
next seven days.

## Basiq sandbox setup

1. Create a Basiq application and API key.
2. In Basiq’s Customise UI, configure the application redirect URL as:
   `https://YOUR_HOST/api/basiq/callback`.
3. Enable the account and transaction scopes needed by the product.
4. Add the API key and webhook signing secret as server-side deployment
   secrets.
5. Sign in with ChatGPT, select **Connect Basiq sandbox**, and complete the
   hosted Hooli consent journey.
6. When the asynchronous import finishes, select the accounts that belong to
   the business.

Basiq server tokens are held only in memory. The CLIENT_ACCESS token is used
only for the required full-page hosted consent redirect and is never written to
D1 or application logs.

## Data retained in D1

Runway stores:

- the single Basiq user ID;
- selected Basiq account IDs, display names, last-four masks, classes, currency,
  balances, and freshness timestamps;
- derived cash totals and expense aggregates;
- merchant exclusion patterns;
- the explicitly demo receivables ledger;
- reminder decisions, provider delivery IDs, and scheduler execution locks;
- Basiq webhook IDs for replay protection.

Runway does not store full account numbers, Basiq access tokens, or raw
transaction history. A consent revocation/expiry or connection-deletion webhook
immediately disables bank-aware automation and removes locally derived bank
data. Choosing **Disconnect** permanently deletes the prototype Basiq user and
performs the same local purge.

## Reminder automation

Cloudflare invokes the scheduled handler hourly. The handler evaluates only at
8:00 AM Australia/Sydney on weekdays, so daylight-saving changes do not shift
the business-time policy. A D1 local-date lock makes repeated cron delivery
idempotent.

An automatic reminder requires all of the following:

- a cash-only buffer breach within seven days;
- fresh, consented bank data and a known receivable status;
- an overdue invoice selected by the deterministic repair ranking;
- at least 72 hours since the invoice’s previous reminder;
- fewer than five automatic reminders.

In `test` mode, the real scheduler and Resend request run, but the actual
recipient is always `RUNWAY_TEST_RECIPIENT`. Subject and body are marked as a
test and record the intended dummy payer address. Live payer delivery also
requires the separate `RUNWAY_ENABLE_LIVE_DELIVERY=1` safety lock, which should
remain disabled until a later privacy/compliance review. Runway never creates a
Pinch payment link automatically.

## Configuration

Copy `.env.example` to `.env.local`. Never use a `NEXT_PUBLIC_` name for Basiq,
Resend, Pinch, or operator secrets.

```dotenv
BASIQ_API_KEY=
BASIQ_API_BASE_URL=https://au-api.basiq.io
BASIQ_API_VERSION=3.0
BASIQ_WEBHOOK_SECRET=

RUNWAY_AUTOMATION_MODE=off
RUNWAY_TEST_RECIPIENT=
RUNWAY_ENABLE_LIVE_DELIVERY=0

RESEND_API_KEY=
RESEND_FROM=Runway <onboarding@resend.dev>
```

`RUNWAY_AUTOMATION_MODE` accepts `off`, `test`, or `live` and defaults to
`off`.

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Useful checks:

```bash
npm run lint
npm run test:domain
npm run test:integration
npm run build
npm test
npx wrangler d1 migrations apply pinch-runway --local
npx wrangler dev --test-scheduled
```

The full integration suite uses a real local D1 binding through Cloudflare’s
Vitest pool. It does not call Basiq or Resend over the network.

## Scope

This remains a single-trader prototype with ChatGPT operator authentication and
AUD-only cash forecasting. Non-AUD accounts are visible but excluded.
Multi-tenancy, verified live invoice ingestion, and production payer delivery
are deferred. The output is operational cash-flow guidance, not accounting,
tax, credit, investment, or personal financial advice.
