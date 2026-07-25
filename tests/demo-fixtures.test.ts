import assert from "node:assert/strict";
import test from "node:test";

const fixturesModuleUrl = new URL("../lib/demo-fixtures.ts", import.meta.url);
const { DEMO_SCENARIOS } = await import(fixturesModuleUrl.href);

const ALL_FORECAST_STATES = ["comfortable", "safe", "tight", "shortfall"];
const ALL_RELIABILITY_BUCKETS = [
  "never_late",
  "sometimes_late",
  "no_history",
];

test("demo fixtures cover each forecast state exactly once", () => {
  const states = DEMO_SCENARIOS.map(
    (scenario) => scenario.expected_forecast.state,
  );

  assert.equal(DEMO_SCENARIOS.length, ALL_FORECAST_STATES.length);
  assert.deepEqual([...new Set(states)].sort(), [...ALL_FORECAST_STATES].sort());
});

test("demo fixtures are conspicuously non-live and use integer cents", () => {
  for (const scenario of DEMO_SCENARIOS) {
    assert.match(scenario.id, /^demo-/);
    assert.equal(scenario.data_source.source, "demo_fixture");
    assert.equal(scenario.data_source.connection_state, "demo");
    assert.equal(scenario.data_source.is_live, false);
    assert.match(scenario.data_source.display_label, /demo.*not connected to pinch/i);

    const amounts = [
      ...scenario.invoices.map((invoice) => invoice.amount),
      ...scenario.declared_expenses.map((expense) => expense.amount),
      scenario.expected_forecast.lowest_balance,
    ];

    for (const amount of amounts) {
      assert.equal(Number.isInteger(amount), true);
    }

    for (const invoice of scenario.invoices) {
      assert.ok(invoice.amount > 0);
      assert.equal(invoice.status, "unpaid");
    }

    for (const expense of scenario.declared_expenses) {
      assert.ok(expense.amount > 0);
      if (expense.type === "weekly_draw") {
        assert.equal(expense.due_date, null);
      } else {
        assert.match(expense.due_date, /^\d{4}-\d{2}-\d{2}$/);
      }
    }
  }
});

test("demo fixtures include and preserve all payer reliability profiles", () => {
  const payers = DEMO_SCENARIOS.flatMap((scenario) =>
    scenario.payers.map((payer) => ({ payer, scenario })),
  );
  const profiles = payers.map(({ payer }) => payer.reliability);

  assert.deepEqual(
    [...new Set(profiles)].sort(),
    [...ALL_RELIABILITY_BUCKETS].sort(),
  );

  for (const { payer, scenario } of payers) {
    const history = scenario.payment_history.filter(
      (entry) => entry.payer_id === payer.id,
    );

    if (payer.reliability === "no_history") {
      assert.equal(payer.avg_days_late, null);
      assert.equal(history.length, 0);
    }

    if (payer.reliability === "never_late") {
      assert.equal(payer.avg_days_late, 0);
      assert.ok(history.length > 0);
      assert.ok(history.every((entry) => entry.days_late === 0));
    }

    if (payer.reliability === "sometimes_late") {
      assert.ok((payer.avg_days_late ?? 0) > 0);
      assert.ok(history.some((entry) => entry.days_late > 0));
    }
  }
});
