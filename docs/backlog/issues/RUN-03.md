## Goal

Give Engine and Frontend deterministic, visibly fake data so they can progress
without waiting for the sandbox.

**Priority:** P0 · **Lane:** engine · **Size:** S
**Depends on:** RUN-02

## Acceptance criteria

- [ ] Fixtures cover Comfortable, Safe, Tight, and Shortfall.
- [ ] Fixtures include the flagship cases: a reliable payer alone covers the commitment → wait; only late/unreliable coverage → chase a named payer.
- [ ] Fixtures include a user-declared weekly draw and lumpy expenses.
- [ ] Fixture mode is obvious in code and debug UI and cannot be mistaken for Pinch sandbox data.
- [ ] Tests assert all state/reliability coverage and cents-only amounts.

## Scaffold status

The initial fixture library and tests exist. Keep it deterministic and do not
reuse it from any sandbox error path.
