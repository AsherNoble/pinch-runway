## Goal

Make the real write call against the sandbox and return the provider’s actual
result to the frontend.

**Priority:** P0 · **Lane:** Pinch · **Size:** M · **Live gate:** G4
**Depends on:** PIN-01, PIN-02

## Acceptance criteria

- [ ] Reload the selected current recommendation and call the documented Pinch Payment Link endpoint.
- [ ] Return the real provider identifier, URL/status, and actionable error state.
- [ ] Reuse same-day links through the action ledger; do not retry an unknown provider outcome automatically.
- [ ] Never show success before Pinch confirms the response.
- [ ] If Pinch creates but does not send a link, expose exactly that: “Payment link ready to share,” never “Sent via Pinch.”

## Scope boundary

No separate email/SMS provider may be added without an explicit scoped issue and
authority. Creating a Pinch-hosted link is the live write action available from
the published API.

## Founder authorization — 2026-07-26

The founder explicitly authorizes adding Resend for transactional collection
emails. The scoped flow is: create a confirmed Pinch Payment Link, email that
link to the provider-sourced Payer email address, then record Resend's accepted
email ID and timestamp in the D1 collection-action ledger. Do not send email
before Pinch confirms the link, and do not send an actual email in tests.
