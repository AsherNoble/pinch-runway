## Goal

Persist a minimal D1 collection-action ledger without customer payment data.

## Acceptance criteria

- [ ] One row per invoice and Australia/Sydney day.
- [ ] Support `reserving`, `link_created`, `shared`, `failed_known`, and `outcome_unknown` recovery states.
- [ ] Deduplicate reservations and never auto-retry an ambiguous Pinch outcome.
