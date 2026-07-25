## Goal

Write down the exact seven-day forecast policy before coding the engine, so the
four states and recommendation are explainable rather than improvised.

**Priority:** P0 · **Lane:** engine · **Size:** S
**Depends on:** RUN-02, RUN-03

## Acceptance criteria

- [ ] Define the seven-day window, weekly-draw timing, in-window lumpy-expense inclusion, and four state thresholds.
- [ ] Define expected-arrival treatment for `never_late`, `sometimes_late`, and `no_history` without pretending certainty.
- [ ] Define deterministic payer-selection/tie-breaker rules.
- [ ] Include executable examples for every state and both flagship recommendations.
- [ ] Confirm the policy uses no bank, email, calendar, general transaction, or inferred-spending data.

## Product rule

`lowest_balance` means projected known receivables less declared commitments. It
must never be described as a bank balance or a promise of funds.
