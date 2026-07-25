## Goal

Implement deterministic invoice-flag reasoning: decide whether to wait or
which specific invoice to target, and state why.

**Priority:** P0 · **Lane:** engine · **Size:** M · **Live gate:** G3
**Depends on:** ENG-02, RUN-02

## Acceptance criteria

- [ ] Rank a target from invoice warnings, never a payer score.
- [ ] Possible in-window coverage determines `shortfall`; planned-coverage gaps determine `tight`.
- [ ] Payer history, where available, remains secondary context only.

## Example outcome

“Rent is due Thursday. Client A alone covers it and has never paid late. Sit
tight.” is a different result from “Client B is overdue and usually 5–9 days
late. Create a payment link today.”
