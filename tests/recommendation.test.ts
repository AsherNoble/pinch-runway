import assert from "node:assert/strict";
import test from "node:test";

import type {
  DeclaredExpense,
  Invoice,
  Payer,
  PaymentHistoryEntry,
} from "../lib/contracts.ts";
import { DEMO_SCENARIOS } from "../lib/demo-fixtures.ts";
import { calculateForecast } from "../lib/forecast.ts";
import {
  calculateForecastResult,
  recommendCollectionAction,
} from "../lib/recommendation.ts";

function getScenario(id: string) {
  const scenario = DEMO_SCENARIOS.find((candidate) => candidate.id === id);
  assert.ok(scenario, "scenario " + id + " must exist");
  return scenario;
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
): Invoice {
  return {
    id,
    payer_id: payerId,
    amount,
    due_date: dueDate,
    status: "unpaid",
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

function input(
  payers: readonly Payer[],
  invoices: readonly Invoice[],
  paymentHistory: readonly PaymentHistoryEntry[] = [],
) {
  return {
    today: "2026-07-25",
    payers,
    invoices,
    payment_history: paymentHistory,
    declared_expenses: [weeklyDraw(10_000)],
  };
}

test("composes every fixture into the shared forecast result with the expected target", () => {
  for (const scenario of DEMO_SCENARIOS) {
    const result = calculateForecastResult({
      today: scenario.today,
      payers: scenario.payers,
      invoices: scenario.invoices,
      payment_history: scenario.payment_history,
      declared_expenses: scenario.declared_expenses,
    });
    const expected = scenario.expected_forecast;

    assert.equal(result.state, expected.state);
    assert.equal(result.lowest_balance, expected.lowest_balance);
    assert.equal(
      result.recommended_action.type,
      expected.recommended_action.type,
    );
    assert.equal(
      result.recommended_action.target_payer_id,
      expected.recommended_action.target_payer_id,
    );
    assert.equal(
      result.recommended_action.target_invoice_id,
      expected.recommended_action.target_invoice_id,
    );
  }
});

test("returns the flagship wait recommendation when one timely payer covers commitments", () => {
  const scenario = getScenario("demo-comfortable-reliable-coverage");
  const result = calculateForecastResult({
    today: scenario.today,
    payers: scenario.payers,
    invoices: scenario.invoices,
    payment_history: scenario.payment_history,
    declared_expenses: scenario.declared_expenses,
  });

  assert.equal(result.recommended_action.type, "wait");
  assert.equal(result.recommended_action.reason, "reliable_coverage");
  assert.match(result.recommended_action.rationale, /Demo Reliable Studio/);
  assert.match(result.recommended_action.rationale, /\$990/);
  assert.match(result.recommended_action.rationale, /Sit tight/);
});

test("targets the observed-late payer and only cites supplied lateness history", () => {
  const scenario = getScenario("demo-tight-overdue-unreliable-invoice");
  const result = calculateForecastResult({
    today: scenario.today,
    payers: scenario.payers,
    invoices: scenario.invoices,
    payment_history: scenario.payment_history,
    declared_expenses: scenario.declared_expenses,
  });

  assert.equal(result.recommended_action.type, "create_payment_link");
  assert.equal(
    result.recommended_action.target_payer_id,
    "demo-payer-slow-steady",
  );
  assert.equal(
    result.recommended_action.target_invoice_id,
    "demo-invoice-slow-tight",
  );
  assert.match(result.recommended_action.rationale, /5 days overdue/);
  assert.match(result.recommended_action.rationale, /5–9 days late/);
  assert.match(result.recommended_action.rationale, /\$240/);
});

test("explains the bounded optimistic shortfall for the target payer", () => {
  const scenario = getScenario("demo-shortfall-chase-late-payer");
  const result = calculateForecastResult({
    today: scenario.today,
    payers: scenario.payers,
    invoices: scenario.invoices,
    payment_history: scenario.payment_history,
    declared_expenses: scenario.declared_expenses,
  });

  assert.equal(result.recommended_action.type, "create_payment_link");
  assert.equal(
    result.recommended_action.target_payer_id,
    "demo-payer-late-client",
  );
  assert.match(result.recommended_action.rationale, /4 days overdue/);
  assert.match(result.recommended_action.rationale, /5–9 days late/);
  assert.match(result.recommended_action.rationale, /\$210 gap/);
});

test("keeps a no-history payer genuinely unknown", () => {
  const recommendationInput = input(
    [payer("new", "New Client", "no_history", null)],
    [invoice("new-invoice", "new", 10_000, "2026-07-25")],
  );
  const analysis = calculateForecast(recommendationInput);
  const action = recommendCollectionAction(recommendationInput, analysis);

  assert.equal(action.type, "create_payment_link");
  assert.equal(action.target_payer_id, "new");
  assert.doesNotMatch(action.rationale, /payment history|days late/i);
  assert.doesNotMatch(action.rationale, /risky|likely|confidence|days late/i);
});

test("uses the documented candidate tie-breakers deterministically", () => {
  const coverageFirst = calculateForecastResult(
    input(
      [
        payer("late", "Late Client", "sometimes_late", 20),
        payer("new", "New Client", "no_history", null),
      ],
      [
        invoice("late-small-overdue", "late", 5_000, "2026-07-20"),
        invoice("new-covering", "new", 10_000, "2026-07-25"),
      ],
    ),
  );
  assert.equal(
    coverageFirst.recommended_action.target_invoice_id,
    "new-covering",
  );

  const overdueFirst = calculateForecastResult(
    input(
      [
        payer("late", "Late Client", "sometimes_late", 20),
        payer("new", "New Client", "no_history", null),
      ],
      [
        invoice("late-current", "late", 10_000, "2026-07-25"),
        invoice("new-overdue", "new", 10_000, "2026-07-24"),
      ],
    ),
  );
  assert.equal(
    overdueFirst.recommended_action.target_invoice_id,
    "new-overdue",
  );

  const lexicalFallback = calculateForecastResult(
    input(
      [
        payer("zulu", "Zulu Client", "sometimes_late", 20),
        payer("able", "Able Client", "sometimes_late", 20),
      ],
      [
        invoice("zulu-invoice", "zulu", 10_000, "2026-07-25"),
        invoice("able-invoice", "able", 10_000, "2026-07-25"),
      ],
    ),
  );
  assert.equal(
    lexicalFallback.recommended_action.target_invoice_id,
    "able-invoice",
  );
});

test("does not turn a no-target shortfall into a sit-tight recommendation", () => {
  const result = calculateForecastResult(input([], []));

  assert.equal(result.state, "shortfall");
  assert.equal(result.recommended_action.type, "wait");
  assert.equal(result.recommended_action.reason, "no_collection_target");
  assert.match(result.recommended_action.rationale, /no unpaid Pinch invoice/i);
});
