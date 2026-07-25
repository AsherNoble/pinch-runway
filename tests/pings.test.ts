import assert from "node:assert/strict";
import test from "node:test";

import type { DeclaredExpense, Invoice, Payer } from "../lib/contracts.ts";
import { DEMO_SCENARIOS } from "../lib/demo-fixtures.ts";
import { createForecastPing } from "../lib/pings.ts";

function getScenario(id: string) {
  const scenario = DEMO_SCENARIOS.find((candidate) => candidate.id === id);
  assert.ok(scenario, "scenario " + id + " must exist");
  return scenario;
}

function buildPing(id: string) {
  const scenario = getScenario(id);

  return createForecastPing({
    today: scenario.today,
    payers: scenario.payers,
    invoices: scenario.invoices,
    payment_history: scenario.payment_history,
    declared_expenses: scenario.declared_expenses,
  });
}

test("emits concrete, deterministic pings for every forecast state", () => {
  const expected = [
    {
      id: "demo-comfortable-reliable-coverage",
      text: "Demo Reliable Studio's $990 invoice is due Tue 28 Jul and they have never paid late.",
      cents: 99_000,
      role: "reliable_invoice",
      consequence:
        "It alone covers your declared $650 weekly draw. Sit tight — no need to create a payment link today.",
      cta: "Sit tight",
    },
    {
      id: "demo-safe-lumpy-expense-covered",
      text: "Demo Reliable Studio's $900 timely invoice covers your declared $650 weekly draw and $170 BAS payment due Thu 30 Jul.",
      cents: 8_000,
      role: "reliable_margin",
      consequence: "$80 reliable planning margin remains this week. Sit tight.",
      cta: "Sit tight",
    },
    {
      id: "demo-tight-overdue-unreliable-invoice",
      text: "Demo Slow & Steady's $930 invoice is 5 days overdue. Their observed payments were 5–9 days late.",
      cents: 93_000,
      role: "target_invoice",
      consequence:
        "Your declared $650 weekly draw and $240 Quarterly insurance due Thu 30 Jul fall inside this window. Expected coverage leaves only $40 of planning margin.",
      cta: "Create Pinch payment link",
    },
    {
      id: "demo-shortfall-chase-late-payer",
      text: "Your declared $650 weekly draw and $160 Friday BAS payment due Fri 31 Jul total $810 in the next seven days. Even if every in-window unpaid invoice lands, the planning gap is $210.",
      cents: 21_000,
      role: "optimistic_shortfall",
      consequence:
        "Demo Late Client's $500 invoice is 4 days overdue. Their observed payments were 5–9 days late.",
      cta: "Create Pinch payment link",
    },
  ] as const;

  for (const expectation of expected) {
    const scenario = getScenario(expectation.id);
    const ping = buildPing(expectation.id);
    const renderedCopy = ping.text + " " + ping.consequence;

    assert.equal(ping.id, "weekly-forecast");
    assert.equal(ping.state, scenario.expected_forecast.state);
    assert.equal(ping.text, expectation.text);
    assert.equal(ping.amount.cents, expectation.cents);
    assert.equal(ping.amount.role, expectation.role);
    assert.equal(ping.consequence, expectation.consequence);
    assert.equal(ping.cta.label, expectation.cta);
    assert.equal(
      ping.cta.action.type,
      scenario.expected_forecast.recommended_action.type,
    );
    assert.equal(
      ping.cta.action.target_payer_id,
      scenario.expected_forecast.recommended_action.target_payer_id,
    );
    assert.equal(
      ping.cta.action.target_invoice_id,
      scenario.expected_forecast.recommended_action.target_invoice_id,
    );
    assert.match(renderedCopy, /\$\d/);
    assert.doesNotMatch(
      renderedCopy,
      /bank balance|account balance|funds available|financial advice/i,
    );
  }
});

test("does not describe no-history payers as late or risky", () => {
  const payers: Payer[] = [
    {
      id: "new",
      name: "New Client",
      reliability: "no_history",
      avg_days_late: null,
    },
  ];
  const invoices: Invoice[] = [
    {
      id: "new-invoice",
      payer_id: "new",
      amount: 10_000,
      due_date: "2026-07-25",
      status: "unpaid",
    },
  ];
  const declaredExpenses: DeclaredExpense[] = [
    {
      id: "weekly-draw",
      type: "weekly_draw",
      amount: 5_000,
      due_date: null,
      note: "Weekly living draw",
    },
  ];
  const ping = createForecastPing({
    today: "2026-07-25",
    payers,
    invoices,
    payment_history: [],
    declared_expenses: declaredExpenses,
  });
  const renderedCopy = ping.text + " " + ping.consequence;

  assert.equal(ping.state, "tight");
  assert.equal(ping.cta.label, "Create Pinch payment link");
  assert.doesNotMatch(renderedCopy, /payment history|days late/i);
  assert.doesNotMatch(renderedCopy, /risky|likely|confidence|days late/i);
});

test("labels a no-target forecast without telling the user to sit tight", () => {
  const declaredExpenses: DeclaredExpense[] = [
    {
      id: "weekly-draw",
      type: "weekly_draw",
      amount: 5_000,
      due_date: null,
      note: "Weekly living draw",
    },
  ];
  const ping = createForecastPing({
    today: "2026-07-25",
    payers: [],
    invoices: [],
    payment_history: [],
    declared_expenses: declaredExpenses,
  });

  assert.equal(ping.state, "shortfall");
  assert.equal(ping.cta.label, "No Pinch collection to target");
  assert.match(ping.consequence, /no known unpaid Pinch invoice/i);
});
