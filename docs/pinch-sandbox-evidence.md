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

## Required next sandbox setup

1. Create a dedicated sandbox Payer with a clearly non-production email.
2. Create a real sandbox Payment Link for that Payer and retain the provider ID
   and returned URL as G4 evidence.
3. For paid-history/reliability evidence, create scheduled test Payments through
   the sanctioned Payer/source flow and use Pinch's test tooling/time travel as
   appropriate. Do not simulate successful/late history locally.

Pinch documents Payer creation and scheduled payment setup in its
[Direct Debit guide](https://docs.getpinch.com.au/docs/direct-debit-payments),
and requires a Payer ID to create a
[Payment Link](https://docs.getpinch.com.au/reference/create-payment-link).
