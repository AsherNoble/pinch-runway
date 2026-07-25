## Goal

Implement the reliability-weighted reasoning beat: decide whether to wait or
which specific payer to chase, and state why.

**Priority:** P0 · **Lane:** engine · **Size:** M · **Live gate:** G3
**Depends on:** ENG-02, RUN-02

## Acceptance criteria

- [ ] Return `wait` when a timely never-late payer alone covers the relevant commitment.
- [ ] Select a named payer when coverage depends on a late/unreliable collection, using deterministic tie-breakers.
- [ ] Explain using only supplied payer names, amounts, due dates, and observed lateness.
- [ ] Keep `no_history` genuinely unknown; do not invent an average, confidence, or score.
- [ ] Add fixture assertions for both flagship beats and verify the integrated result against PIN-03 live data.

## Example outcome

“Rent is due Thursday. Client A alone covers it and has never paid late. Sit
tight.” is a different result from “Client B is overdue and usually 5–9 days
late. Create a payment link today.”
