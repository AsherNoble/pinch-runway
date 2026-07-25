# Seven-day forecast policy

Pinch Runway forecasts declared commitments against unpaid Pinch collections. It is not a bank-balance forecast, a promise that funds will arrive, or financial advice.

## Inputs and scope

The engine consumes only the shared contract: Pinch-derived payer reliability, unpaid invoices, and paid-payment history; one user-declared weekly living draw; and user-declared lumpy expenses with due dates.

It does not read or infer bank balance, bank transactions, spending, household finances, email, calendar, portfolio, or any other external data. All money is integer cents, dates are ISO calendar dates, and `today` is an explicit engine argument rather than the server clock.

## Window and commitments

The window is **today through today + 6 calendar days, inclusive**. If today is 25 July, the window ends on 31 July.

- Exactly one weekly draw is required. It is scheduled at the end of the seven-day window; Runway has no bank or spending data with which to split it across days.
- A lumpy item is included only when its due date is within the inclusive window, and is scheduled on that date.
- Lumpy items before today or after the window end are ignored. A later persistence lane can explicitly mark an old item paid, changed, or still outstanding; this pure engine does not guess.
- Only `unpaid` invoices participate. The engine rejects malformed input, duplicate payer/invoice IDs, unknown invoice payers, invalid cent values, multiple or missing weekly draws, and an invalid `sometimes_late` estimate rather than making up data.

At each commitment date, receipts scheduled on or before that date are totalled before commitments scheduled on or before it. Same-day receipts count for same-day commitments as a calendar-date planning assumption, not a settlement guarantee. The lowest result is that ledger's coverage floor.

## Reliability ledgers

All three ledgers start at zero and none is a bank balance.

| Ledger | Invoices included | Arrival treatment |
| --- | --- | --- |
| Reliable | Timely `never_late` only | Due date, only if due within the window and not already overdue. |
| Expected | Reliable plus `sometimes_late` | For sometimes late: due date plus `ceil(avg_days_late)`, only if that date is still in the window. A pattern already exceeded is not assumed to arrive today. |
| Optimistic | Every unpaid invoice nominally due by window end | `max(due_date, today)`. This supports the bounded wording: even if every invoice lands. |

A `no_history` payer is excluded from both reliable and expected ledgers: there is no observed bilateral history from which to infer an arrival date. It appears only in the optimistic ledger. Copy may say no history yet, but must not call that payer risky, late, likely to pay, or give a confidence score.

`ForecastResult.lowest_balance` is the **expected coverage floor**: lowest expected receipts less declared commitments in the window. It must never be rendered as a bank or account balance.

## State thresholds

Let `cushion = max($100, ceil(total commitments / 10))` in cents. With no declared commitments, the state is `comfortable` because nothing in scope needs coverage. Otherwise:

| State | Deterministic condition |
| --- | --- |
| `shortfall` | Optimistic coverage floor is negative: the business is short even if every in-window invoice lands. |
| `tight` | Optimistic floor is non-negative but reliable floor is negative: coverage depends on a late-history or no-history collection. |
| `safe` | Reliable floor is non-negative but below the cushion. |
| `comfortable` | Reliable floor meets or exceeds the cushion. |

## Recommendation and selection

The action is a structured `wait` or `create_payment_link`; it never claims a payment was sent. Lane A resolves `create_payment_link` to an actual Pinch sandbox call.

1. Find the earliest commitment date where the reliable ledger is negative.
2. If none exists, return `wait`. When one timely never-late invoice alone covers commitments by every relevant deadline, name that payer and say to sit tight.
3. If a deficit exists, consider unpaid invoices nominally due on or before the at-risk date. If none exists, use unpaid invoices due by window end. If there are still none, return `wait` and say there is no known Pinch collection to target.
4. Select one invoice by these stable tie-breakers: (a) its amount alone covers the deficit; (b) overdue first, then most days overdue; (c) payer bucket `sometimes_late`, then `no_history`, then `never_late`; (d) earlier expected arrival for observed-history payers, or earlier nominal due date for no history; (e) larger amount; (f) earlier due date, payer name, then invoice ID lexically.

The third tie-breaker is prioritisation only. It is never a claim that a no-history payer is unreliable. Copy can cite observed late history; it may say only no history yet for a no-history payer.

## Canonical executable examples

`lib/forecast-policy.ts` and `tests/forecast-policy.test.ts` lock these fixture outcomes before ENG-02 connects the full date-and-ledger engine:

| Fixture | State | Expected coverage floor | Action |
| --- | --- | ---: | --- |
| Comfortable reliable coverage | `comfortable` | $340 | Wait: Demo Reliable Studio's timely $990 alone covers the $650 weekly draw. |
| Safe lumpy expense covered | `safe` | $400 | Wait: the $900 reliable invoice covers the $820 draw plus BAS; its reliable cushion is $80. |
| Tight overdue collection | `tight` | $40 | Create a payment link for Demo Slow & Steady: $930 is overdue and history is 5–9 days late. |
| Shortfall late payer | `shortfall` | -$310 | Create a payment link for Demo Late Client: expected coverage is $310 short; even if the no-history $100 invoice arrives, the gap remains $210. |

The Comfortable row is the sit-tight flagship beat. Tight and Shortfall are the chase-a-named-payer beat. The fixture assertions make their state, target, and forecast margin executable.
