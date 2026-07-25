# Pinch sandbox evidence

## 2026-07-25 — initial authenticated probe

| Check | Result |
| --- | --- |
| OAuth client-credentials token | Succeeded against Pinch development credentials |
| `GET /test/payers?page=1&pageSize=1` | Succeeded; first page contained **0** Payer records |
| Fixture fallback | Not used |

This proves the server-only sandbox credential path and live Payers endpoint
are reachable. It does **not** prove field normalisation, payment history,
reliability, or Payment Link creation because the sandbox currently has no
Payer data.

## 2026-07-25 — deliberate test-data setup

| Check | Result |
| --- | --- |
| Dedicated Payers | Created two clearly labelled development-sandbox Payers: `reliable` and `delayed` (provider IDs redacted) |
| Payment Link write | Created one real Pinch sandbox Payment Link for the `reliable` Payer for **$500.00** (provider ID and URL redacted) |
| Live-mode guard | The client rejects any base URL other than `https://api.getpinch.com.au/test/` |
| Email/reminder claim | None made — the Payment Link API returned a URL; it is not a documented Pinch send/reminder call |

These Payers have no source and no fabricated payment history. They establish
G4 write evidence without pretending that a payment has been collected.

## Remaining sandbox setup

For paid-history/reliability evidence, create scheduled test Payments through
the sanctioned Payer/source flow and use Pinch's test tooling/time travel as
appropriate. Do not simulate successful/late history locally.

Pinch documents Payer creation and scheduled payment setup in its
[Direct Debit guide](https://docs.getpinch.com.au/docs/direct-debit-payments),
and requires a Payer ID to create a
[Payment Link](https://docs.getpinch.com.au/reference/create-payment-link).

## Time-travel path for real reliability history

This is the planned, sanctioned G3 sequence — not a fixture substitute:

1. Tokenise a documented test bank account in the browser with Pinch CaptureJS.
   The bank details must never pass through Runway's server; only the
   short-lived token may be posted to the server-side Pinch adapter.
2. Attach that token to one of the labelled test Payers as a Pinch Payment
   Source, then create a scheduled Payment with a real `transactionDate` and a
   unique Pinch nonce.
3. Send a request to the **test** API with `Time-Travel: <next-morning UTC>` to
   trigger the processing window, then read the Payment and its attempts.
4. Advance the test clock again until the terminal bank/settlement result is
   present. Compare the original scheduled date with the successful attempt's
   transaction date — not its settlement date — when deriving lateness.
5. Repeat with a later scheduled date or sanctioned dishonour/retry flow to
   obtain a genuine `sometimes_late` record. The app must retain the real
   provider records used for that calculation.

Pinch documents that `Time-Travel` is honoured on any request to the test API,
and specifically describes this next-morning/settlement sequence for direct
debits. It also documents CaptureJS as the required client-side tokenisation
path. See [Test and Live Mode](https://docs.getpinch.com.au/docs/test-and-live-mode)
and [CaptureJS tokenisation](https://docs.getpinch.com.au/docs/capturejs-tokenisation).
