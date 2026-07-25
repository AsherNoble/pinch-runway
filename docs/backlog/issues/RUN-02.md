## Goal

Keep all three lanes on one stable application contract. This work is mostly
seeded in `lib/contracts.ts`; review it before adding adapters or UI state.

**Priority:** P0 · **Lane:** shared · **Size:** S
**Depends on:** none

## Acceptance criteria

- [ ] Export the agreed `Payer`, `Invoice`, `DeclaredExpense`, and `ForecastResult` types.
- [ ] Amounts are integer cents, dates are ISO calendar dates, and `avg_days_late` is `null` for `no_history`.
- [ ] Add a minimal structured recommendation action: `wait | create_payment_link`, target payer/payment identifiers, and rationale.
- [ ] Pinch-specific Payment/Payment Link fields stay inside Lane A’s adapter; Engine and Frontend consume only shared types.
- [ ] `lowest_balance` is documented as projected known receipts minus declared commitments, never a bank balance.

## Guardrail

Do not add bank, transaction-feed, household, calendar, email, portfolio, or
financial-advice concepts to this contract.
