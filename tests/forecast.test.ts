import assert from "node:assert/strict";
import test from "node:test";

import type {
  DeclaredExpense,
  Invoice,
  Payer,
} from "../lib/contracts.ts";
import { DEMO_SCENARIOS } from "../lib/demo-fixtures.ts";
import {
  ForecastInputError,
  calculateForecast,
} from "../lib/forecast.ts";

function getScenario(id: string) {
  const scenario = DEMO_SCENARIOS.find((candidate) => candidate.id === id);
  assert.ok(scenario, "scenario " + id + " must exist");
  return scenario;
}

function inputForScenario(id: string) {
  const scenario = getScenario(id);
  return {
    today: scenario.today,
    payers: scenario.payers,
    invoices: scenario.invoices,
    declared_expenses: scenario.declared_expenses,
  };
}

function payer(
  id: string,
  name: string,
  reliability: Payer["reliability"],
  avgDaysLate: number | null,
): Payer {
  return {
    id,
    name,
    reliability,
    avg_days_late: avgDaysLate,
  };
}

function invoice(
  id: string,
  payerId: string,
  amount: number,
  dueDate: string,
  status: Invoice["status"] = "unpaid",
): Invoice {
  return {
    id,
    payer_id: payerId,
    amount,
    due_date: dueDate,
    status,
  };
}

function weeklyDraw(amount: number): DeclaredExpense {
  return {
    id: "weekly-draw",
    type: "weekly_draw",
    amount,
    due_date: null,
    note: "Weekly living draw",
  };
}

function lumpy(
  id: string,
  amount: number,
  dueDate: string,
): DeclaredExpense {
  return {
    id,
    type: "lumpy",
    amount,
    due_date: dueDate,
    note: id,
  };
}

test("calculates all four deterministic fixture states with expected coverage floors", () => {
  for (const scenario of DEMO_SCENARIOS) {
    const result = calculateForecast({
      today: scenario.today,
      payers: scenario.payers,
      invoices: scenario.invoices,
      declared_expenses: scenario.declared_expenses,
    });

    assert.equal(result.state, scenario.expected_forecast.state);
    assert.equal(
      result.lowest_balance,
      scenario.expected_forecast.lowest_balance,
    );
    assert.equal(result.window.start, scenario.today);
    assert.equal(result.window.end, "2026-07-31");
    assert.equal(
      result.lowest_balance,
      result.ledgers.expected.coverage_floor,
    );
    assert.match(result.cause, /\$/);
  }
});

test("includes only lumpy items inside the inclusive seven-day window", () => {
  const result = calculateForecast({
    today: "2026-07-25",
    payers: [payer("reliable", "Reliable", "never_late", 0)],
    invoices: [invoice("timely", "reliable", 110_000, "2026-07-25")],
    declared_expenses: [
      weeklyDraw(65_000),
      lumpy("lumpy-today", 10_000, "2026-07-25"),
      lumpy("lumpy-window-end", 20_000, "2026-07-31"),
      lumpy("lumpy-before-window", 30_000, "2026-07-24"),
      lumpy("lumpy-after-window", 40_000, "2026-08-01"),
    ],
  });

  assert.deepEqual(
    result.in_window_lumpy_expenses.map((expense) => expense.expense_id),
    ["lumpy-today", "lumpy-window-end"],
  );
  assert.equal(result.total_commitments, 95_000);
  assert.equal(result.weekly_draw.date, "2026-07-31");
  assert.equal(result.state, "comfortable");
});

test("counts a same-day timely receipt before that day's declared commitment", () => {
  const result = calculateForecast({
    today: "2026-07-25",
    payers: [payer("reliable", "Reliable", "never_late", 0)],
    invoices: [invoice("same-day", "reliable", 10_000, "2026-07-25")],
    declared_expenses: [
      weeklyDraw(1),
      lumpy("due-today", 10_000, "2026-07-25"),
    ],
  });

  assert.deepEqual(result.ledgers.reliable.positions[0], {
    date: "2026-07-25",
    receipts_arrived: 10_000,
    commitments_due: 10_000,
    position: 0,
  });
});

test("uses civil UTC date arithmetic across a leap day", () => {
  const result = calculateForecast({
    today: "2028-02-27",
    payers: [payer("reliable", "Reliable", "never_late", 0)],
    invoices: [invoice("window-end", "reliable", 10_000, "2028-03-04")],
    declared_expenses: [weeklyDraw(1)],
  });

  assert.equal(result.window.end, "2028-03-04");
  assert.equal(
    result.ledgers.reliable.scheduled_receipts[0]?.expected_arrival_date,
    "2028-03-04",
  );
});

test("applies each reliability bucket to the correct receipt ledgers", () => {
  const result = calculateForecast({
    today: "2026-07-25",
    payers: [
      payer("timely", "Timely", "never_late", 0),
      payer("late", "Late", "sometimes_late", 5.2),
      payer("unknown", "Unknown", "no_history", null),
    ],
    invoices: [
      invoice("timely-overdue", "timely", 10_000, "2026-07-24"),
      invoice("timely-window", "timely", 10_000, "2026-07-31"),
      invoice("late-window", "late", 10_000, "2026-07-25"),
      invoice("late-estimate-past", "late", 10_000, "2026-07-18"),
      invoice("unknown-window", "unknown", 10_000, "2026-07-26"),
      invoice("paid-window", "timely", 10_000, "2026-07-25", "paid"),
    ],
    declared_expenses: [weeklyDraw(1)],
  });

  assert.deepEqual(
    result.ledgers.reliable.scheduled_receipts.map((receipt) => receipt.invoice_id),
    ["timely-window"],
  );
  assert.deepEqual(
    result.ledgers.expected.scheduled_receipts.map((receipt) => receipt.invoice_id),
    ["late-window", "timely-window"],
  );
  assert.deepEqual(
    result.ledgers.expected.scheduled_receipts.map(
      (receipt) => receipt.expected_arrival_date,
    ),
    ["2026-07-31", "2026-07-31"],
  );
  assert.deepEqual(
    result.ledgers.optimistic.scheduled_receipts.map((receipt) => receipt.invoice_id),
    [
      "late-estimate-past",
      "timely-overdue",
      "late-window",
      "unknown-window",
      "timely-window",
    ],
  );
});

test("records an early commitment gap even when a later receipt improves the final total", () => {
  const result = calculateForecast({
    today: "2026-07-25",
    payers: [payer("reliable", "Reliable", "never_late", 0)],
    invoices: [invoice("later", "reliable", 100_000, "2026-07-31")],
    declared_expenses: [
      weeklyDraw(1),
      lumpy("early-bill", 50_000, "2026-07-26"),
    ],
  });

  assert.equal(result.ledgers.reliable.coverage_floor, -50_000);
  assert.equal(result.ledgers.reliable.positions.at(-1)?.position, 49_999);
  assert.equal(result.earliest_reliable_shortfall_date, "2026-07-26");
  assert.equal(result.state, "shortfall");
});

test("rejects malformed forecast input rather than inferring missing values", () => {
  assert.throws(
    () =>
      calculateForecast({
        today: "2026-07-25",
        payers: [payer("unknown", "Unknown", "no_history", 0)],
        invoices: [],
        declared_expenses: [weeklyDraw(1)],
      }),
    ForecastInputError,
  );

  assert.throws(
    () =>
      calculateForecast({
        today: "2026-07-25",
        payers: [payer("reliable", "Reliable", "never_late", 0)],
        invoices: [],
        declared_expenses: [weeklyDraw(1), weeklyDraw(2)],
      }),
    ForecastInputError,
  );

  assert.throws(
    () =>
      calculateForecast({
        today: "2026-02-29",
        payers: [payer("reliable", "Reliable", "never_late", 0)],
        invoices: [],
        declared_expenses: [weeklyDraw(1)],
      }),
    ForecastInputError,
  );
});

test("returns deterministic output without mutating input records", () => {
  const input = inputForScenario("demo-tight-overdue-unreliable-invoice");
  const before = JSON.stringify(input);

  const first = calculateForecast(input);
  const second = calculateForecast(input);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
});
