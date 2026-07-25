## Goal

Make the real write call against the sandbox and return the provider’s actual
result to the frontend.

**Priority:** P0 · **Lane:** Pinch · **Size:** M · **Live gate:** G4
**Depends on:** PIN-01, PIN-02

## Acceptance criteria

- [ ] Accept a selected normalised payer/payment target and call the documented Pinch Payment Link/Payment endpoint.
- [ ] Return the real provider identifier, URL/status, and actionable error state.
- [ ] Protect against duplicate clicks locally and use provider idempotency when documented/available.
- [ ] Never show success before Pinch confirms the response.
- [ ] If Pinch creates but does not send a link, expose exactly that: “Payment link ready to share,” never “Sent via Pinch.”

## Scope boundary

No separate email/SMS provider may be added without an explicit scoped issue and
authority. Creating a Pinch-hosted link is the live write action available from
the published API.
