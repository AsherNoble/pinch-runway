import assert from "node:assert/strict";
import test from "node:test";
import {
  ageReceivables,
  buildDualForecast,
  decideReminder,
  receivableArrivalDate,
} from "../lib/runway-engine.ts";
import type {
  DataSourceReadiness,
  ExpenseProfile,
  Receivable,
} from "../lib/runway-contracts.ts";

const profile: ExpenseProfile = {
  lookback_days: 90,
  posted_debits_cents: 90_000,
  excluded_debits_cents: 0,
  variable_debits_cents: 90_000,
  variable_daily_average_cents: 1_000,
  normal_daily_spend_cents: 1_000,
  recurring: [],
  pending_debits: [],
  derived_at: "2026-07-26T00:00:00.000Z",
};

function receivable(overrides: Partial<Receivable> = {}): Receivable {
  return {
    id: "INV-1",
    payer_name: "Demo Payer",
    payer_email: "payer@example.test",
    safe_address: "1 Sample Street",
    amount_cents: 20_000,
    issued_date: "2026-07-01",
    due_date: "2026-07-24",
    status: "unpaid",
    paid_date: null,
    payer_history_count: 3,
    avg_days_late: 2,
    reminder_count: 0,
    last_reminder_at: null,
    source: "demo",
    ...overrides,
  };
}

const connected: DataSourceReadiness = {
  state: "connected",
  display_label: "connected",
  last_synced_at: "2026-07-26T00:00:00.000Z",
};
const demo: DataSourceReadiness = {
  state: "demo",
  display_label: "demo receivables",
  last_synced_at: null,
};

test("the two paths keep receivables out of cash while projecting their expected arrival", () => {
  const invoice = receivable();
  assert.deepEqual(receivableArrivalDate(invoice), {
    date: "2026-07-26",
    uncertain: false,
  });
  const forecast = buildDualForecast({
    today: "2026-07-26",
    opening_operating_cash_cents: 15_000,
    expense_profile: profile,
    receivables: [invoice],
  });
  assert.equal(forecast.cash_only.closing_position_cents, -15_000);
  assert.equal(forecast.expected_with_receivables.closing_position_cents, 5_000);
  assert.equal(forecast.points[0].cash_only_cents, 14_000);
  assert.equal(forecast.points[0].expected_with_receivables_cents, 34_000);
  assert.equal(forecast.risk_buffer_cents, 7_000);
});

test("unknown payer history stays explicitly uncertain", () => {
  const unknown = receivable({
    id: "INV-UNKNOWN",
    payer_history_count: 0,
    avg_days_late: null,
    due_date: "2026-07-28",
  });
  const forecast = buildDualForecast({
    today: "2026-07-26",
    opening_operating_cash_cents: 15_000,
    expense_profile: profile,
    receivables: [unknown],
  });
  assert.deepEqual(
    forecast.points.find((point) => point.date === "2026-07-28")
      ?.uncertain_receivable_ids,
    ["INV-UNKNOWN"],
  );
});

test("invoice aging separates earned-not-received by overdue range", () => {
  const aging = ageReceivables([
    receivable({ id: "future", due_date: "2026-07-30", amount_cents: 100 }),
    receivable({ id: "week", due_date: "2026-07-22", amount_cents: 200 }),
    receivable({ id: "month", due_date: "2026-07-01", amount_cents: 300 }),
    receivable({ id: "old", due_date: "2026-06-01", amount_cents: 400 }),
  ], "2026-07-26");
  assert.deepEqual(aging, {
    not_due_cents: 100,
    overdue_1_7_cents: 200,
    overdue_8_30_cents: 300,
    overdue_31_plus_cents: 400,
    total_unpaid_cents: 1_000,
  });
});

test("the reminder decision targets the overdue invoice that repairs the earliest breach", () => {
  const forecast = buildDualForecast({
    today: "2026-07-26",
    opening_operating_cash_cents: 10_000,
    expense_profile: {
      ...profile,
      pending_debits: [{
        id: "pending-tax",
        description: "Pending tax",
        amount_cents: 5_000,
        post_date: "2026-07-26",
        changeable: true,
      }],
    },
    receivables: [],
  });
  const decision = decideReminder({
    now: new Date("2026-07-26T00:00:00.000Z"),
    today: "2026-07-26",
    bank_source: connected,
    receivables_source: demo,
    forecast,
    receivables: [
      receivable({ id: "small-old", due_date: "2026-07-01", amount_cents: 1_000 }),
      receivable({ id: "repair", due_date: "2026-07-20", amount_cents: 8_000 }),
    ],
  });
  assert.equal(decision.eligible, true);
  assert.equal(decision.target_receivable_id, "repair");
  assert.equal(decision.earliest_breach_date, "2026-07-26");
});

test("staleness, 72-hour cadence, five-send cap, and paid status suppress automation", () => {
  const forecast = buildDualForecast({
    today: "2026-07-26",
    opening_operating_cash_cents: 10_000,
    expense_profile: profile,
    receivables: [],
  });
  const input = {
    now: new Date("2026-07-26T00:00:00.000Z"),
    today: "2026-07-26",
    bank_source: connected,
    receivables_source: demo,
    forecast,
  };
  assert.equal(decideReminder({
    ...input,
    bank_source: { ...connected, state: "stale" },
    receivables: [receivable()],
  }).suppression_reason, "bank_data_not_ready");
  assert.equal(decideReminder({
    ...input,
    receivables: [receivable({ last_reminder_at: "2026-07-25T00:00:00.000Z" })],
  }).suppression_reason, "cadence_limit");
  assert.equal(decideReminder({
    ...input,
    receivables: [receivable({ reminder_count: 5 })],
  }).suppression_reason, "send_cap");
  assert.equal(decideReminder({
    ...input,
    receivables: [receivable({ status: "paid", paid_date: "2026-07-25" })],
  }).suppression_reason, "no_overdue_invoice");
});
