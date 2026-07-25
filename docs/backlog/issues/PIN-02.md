## Goal

Build the server-side adapter that turns real Pinch collection records into the
shared Runway snapshot.

**Priority:** P0 · **Lane:** Pinch · **Size:** M · **Live gate:** G2
**Depends on:** PIN-01, RUN-02

## Acceptance criteria

- [ ] Fetch real sandbox Payers and associated scheduled/processed Payments and/or Payment Links using server-side credentials only.
- [ ] Normalise records into shared `Payer` and `Invoice` objects without exposing raw provider payloads to the client.
- [ ] Treat `due_date` as a verified scheduled-collection date only; preserve unavailable values as an explicit mapping failure.
- [ ] Handle paging, unsupported/missing records, and API errors visibly; sandbox mode never returns fixtures after a failure.
- [ ] A smoke test proves the response is derived from current sandbox data.

## Definition note

Runway’s `Invoice` is a product projection, not a claim that Pinch exposes an
Invoice API. Preserve Pinch identifiers and invoice references in server-side
metadata for traceability.
