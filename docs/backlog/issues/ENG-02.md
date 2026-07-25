## Goal

Implement a pure, testable seven-day forecast engine against the shared
contract and deterministic fixtures.

**Priority:** P0 · **Lane:** engine · **Size:** M
**Depends on:** ENG-01, RUN-02, RUN-03

## Acceptance criteria

- [ ] Consume only shared contract inputs and calculate projected receipts, weekly draw, in-window lumpy expenses, lowest projected position, cause, and one of four states.
- [ ] Ignore lumpy items outside the current seven-day window.
- [ ] Use integer-cent arithmetic and deterministic date handling.
- [ ] Make no network calls and no assumptions about bank cash on hand.
- [ ] Pass fixture tests for Comfortable, Safe, Tight, and Shortfall.

## Non-goals

Do not infer a living draw from external data and do not add a generalized
budget planner.
