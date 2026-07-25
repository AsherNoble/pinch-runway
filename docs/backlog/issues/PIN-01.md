## Goal

Prove exactly what the real Pinch sandbox can supply before building the live
adapter. This is the first critical-path issue.

**Priority:** P0 · **Lane:** Pinch · **Size:** M · **Live gate:** G1
**Depends on:** RUN-01, RUN-02

## Acceptance criteria

- [ ] Make authenticated calls to the real Pinch sandbox and retain redacted evidence of success.
- [ ] Map actual Payer, Payment, and Payment Link fields to Runway needs: payer, amount, status, due date, paid/settled date, and payer linkage.
- [ ] Verify whether payment history supports reliability and whether Payment Link creation actually dispatches a request.
- [ ] Record pagination, supported statuses, API version, and useful error cases in `docs/`.
- [ ] If a required field or dispatch capability is absent, open a hard blocker immediately; do not synthesize it.

## Facts to validate, not assume

Published Pinch docs expose Payers, Payments, and Payment Links, but no Invoice
or email/SMS reminder-send endpoint. The app currently has a server-only
token/client primitive; use it as a starting point, then prove real responses.
