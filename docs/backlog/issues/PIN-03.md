## Goal

 Normalise invoice-level warning inputs from real Pinch records, without a
 payer score or fabricated confidence number.

**Priority:** P0 · **Lane:** Pinch · **Size:** M · **Live gate:** G3
**Depends on:** PIN-01, RUN-02

## Acceptance criteria

- [ ] Read Payer sources/agreements from `GET /payers/{id}` and Payment status from records or verified webhooks.
- [ ] Flag overdue days, Pinch dishonour, stale owner-shared reminders, no method/mandate, and unusually old/large invoices.
- [ ] History is secondary diagnostic copy only after two settled invoices; never rank from it.
