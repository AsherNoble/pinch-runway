# Runway

Runway is an always-on financial operations agent for one Australian sole
trader. It combines a deterministic 13-week cash forecast with a constrained
Claude tool loop, a WhatsApp channel, and a web command centre. The agent can
monitor business evidence, explain emerging cash pressure, and complete only
the administrative actions the owner has authorised.

The original bank dashboard remains available at `/bank`. Both experiences keep
two ideas deliberately separate:

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

The command centre shows 13 weekly `cash_only` and
`expected_with_receivables` paths. The model never calculates balances itself:
deterministic code produces the forecast and ranked repair target, while Claude
chooses among bounded tools and explains the evidence.

## Always-on agent demo

The golden path starts when the presenter injects a seeded, explicitly
simulated Gmail bill from Frame & Light Rentals:

1. Runway combines the bill with Basiq cash data and the seeded invoice ledger.
2. The 13-week engine identifies the first buffer breach and ranks the overdue
   Northstar Pilates invoice as the repair target.
3. If `payment_link` is set to `auto`, Runway creates or reuses a real Pinch
   sandbox payment link for the first available sandbox payer.
4. If `collection_email` is `auto`, it writes the reminder to a simulated Gmail
   outbox. It never claims Google delivered it.
5. Runway notifies the owner through the Twilio WhatsApp Sandbox when configured;
   otherwise it records an explicit audit-only fallback.

Every tool call records its permission decision, result, and `live`,
`simulated`, or `fallback` provenance in D1. The hard operating limits are in
[`RUNWAY_CHARTER.md`](./RUNWAY_CHARTER.md).

To rehearse locally, apply the migrations, start the app, open `/`, expand
**Presenter controls**, and select **Inject large bill**. **Reset agent run**
clears agent audit/demo evidence but deliberately does not delete a genuine
Pinch sandbox link.

### WhatsApp Sandbox

The integration uses Twilio’s WhatsApp Sandbox and validates Twilio’s signature
against the exact public webhook URL before reading a message.

1. Join the sandbox from the owner’s WhatsApp number.
2. Set the Twilio values shown in `.env.example`.
3. Start Runway locally and expose it with Tailscale Funnel (or another HTTPS
   tunnel).
4. Set `TWILIO_WEBHOOK_PUBLIC_URL` to the exact public
   `https://.../api/whatsapp` URL and configure that URL as the sandbox’s
   incoming-message webhook.
5. Send the sandbox number a WhatsApp message such as “What changed?”

Leave the variables unset if the trial/sandbox available to the team would
incur a charge; the rest of the demo remains functional and visibly reports the
WhatsApp fallback.

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
remain disabled until a later privacy/compliance review. The legacy reminder
scheduler never creates a Pinch payment link. The new agent can do so only
through its separately audited `payment_link` permission.

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

RUNWAY_ENABLE_DEMO_AGENT=1
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-20250514

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
RUNWAY_OWNER_WHATSAPP=
TWILIO_WEBHOOK_PUBLIC_URL=

RUNWAY_PAYMENT_RETURN_URL=http://localhost:3000/

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

This remains a single-trader prototype with ChatGPT operator authentication,
AUD-only cash forecasting, seeded Gmail/Calendar evidence, and a simulated
Gmail outbox. Non-AUD accounts are visible but excluded. Multi-tenancy, live
Google OAuth, verified live invoice ingestion, and production payer delivery
are deferred. Runway cannot move money, negotiate, lodge tax, or give
accounting, tax, credit, investment, legal, or personal financial advice.
