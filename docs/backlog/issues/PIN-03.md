## Goal

Derive bilateral payer reliability from real paid-history records, not a
population score or fabricated confidence number.

**Priority:** P0 · **Lane:** Pinch · **Size:** M · **Live gate:** G3
**Depends on:** PIN-01, RUN-02

## Acceptance criteria

- [ ] Retrieve real completed/paid payment history for each relevant payer and, where needed, payment detail/attempt records.
- [ ] Produce only `never_late`, `sometimes_late` with average/typical lateness, or `no_history`.
- [ ] Compare the scheduled Payment `transactionDate` with a successful attempt `transactionDate`.
- [ ] Do not use `actualTransferDate` as payer lateness; it is settlement processing timing.
- [ ] Ignore dishonoured/no-success attempts as paid-late observations; document retry grouping limitations.
- [ ] Unit tests cover all buckets and a live smoke test proves data came from Pinch.
