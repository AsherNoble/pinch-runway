import assert from "node:assert/strict";
import test from "node:test";
import { deriveExpenseProfile } from "../lib/expense-engine.ts";
import type { BankTransaction } from "../lib/runway-contracts.ts";

function debit(
  id: string,
  post_date: string,
  description: string,
  amount_cents: number,
  overrides: Partial<BankTransaction> = {},
): BankTransaction {
  return {
    id,
    account_id: "business",
    post_date,
    description,
    amount_cents,
    direction: "debit",
    status: "posted",
    transaction_class: "expense",
    ...overrides,
  };
}

test("expense derivation excludes transfers, card repayments, personal rules, and pending baseline spend", () => {
  const profile = deriveExpenseProfile({
    today: "2026-07-26",
    selected_account_ids: ["business", "credit-card"],
    exclusion_patterns: ["personal gym"],
    transactions: [
      debit("transfer", "2026-07-20", "Transfer to savings", 20_000, {
        transaction_class: "transfer",
      }),
      debit("card", "2026-07-19", "Visa card repayment", 30_000),
      debit("card-credit", "2026-07-20", "Card payment received", 30_000, {
        account_id: "credit-card",
        direction: "credit",
        transaction_class: "loan-repayment",
      }),
      debit("personal", "2026-07-18", "Personal Gym", 5_000),
      debit("variable", "2026-07-17", "Office supplies", 9_000),
      debit("pending", "2026-07-26", "Pending fuel", 4_000, {
        status: "pending",
      }),
      debit("other-account", "2026-07-17", "Other account", 99_000, {
        account_id: "personal",
      }),
    ],
  }, new Date("2026-07-26T00:00:00Z"));

  assert.equal(profile.posted_debits_cents, 64_000);
  assert.equal(profile.excluded_debits_cents, 55_000);
  assert.equal(profile.variable_debits_cents, 9_000);
  assert.equal(profile.pending_debits.length, 1);
  assert.equal(profile.pending_debits[0].changeable, true);
});

test("recurring detection requires three consistent payments, cadence, and amounts within ten percent", () => {
  const profile = deriveExpenseProfile({
    today: "2026-07-26",
    selected_account_ids: ["business"],
    transactions: [
      debit("rent-1", "2026-05-26", "Studio Rent 1001", 100_000),
      debit("rent-2", "2026-06-25", "Studio Rent 1002", 102_000),
      debit("rent-3", "2026-07-25", "Studio Rent 1003", 99_000),
      debit("irregular-1", "2026-06-01", "Odd Supplier", 10_000),
      debit("irregular-2", "2026-06-19", "Odd Supplier", 10_000),
      debit("irregular-3", "2026-07-23", "Odd Supplier", 10_000),
      debit("two-only-1", "2026-07-01", "Software Tool", 2_000),
      debit("two-only-2", "2026-07-15", "Software Tool", 2_000),
    ],
  }, new Date("2026-07-26T00:00:00Z"));

  assert.equal(profile.recurring.length, 1);
  assert.equal(profile.recurring[0].cadence, "monthly");
  assert.equal(profile.recurring[0].typical_amount_cents, 100_000);
  assert.deepEqual(profile.recurring[0].projected_dates, ["2026-08-24"]);
});

test("short histories remain variable rather than inventing recurring costs", () => {
  const profile = deriveExpenseProfile({
    today: "2026-07-26",
    selected_account_ids: ["business"],
    lookback_days: 30,
    transactions: [
      debit("one", "2026-07-01", "New SaaS", 3_000),
      debit("two", "2026-07-15", "New SaaS", 3_000),
    ],
  });
  assert.equal(profile.recurring.length, 0);
  assert.equal(profile.variable_daily_average_cents, 200);
});
