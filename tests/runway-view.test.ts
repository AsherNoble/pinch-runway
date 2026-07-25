import assert from "node:assert/strict";
import test from "node:test";

import type { RunwayDataSnapshot } from "../lib/contracts.ts";
import { DEMO_SCENARIOS } from "../lib/demo-fixtures.ts";
import {
  buildRunwayView,
  getDemoRunwayView,
} from "../lib/runway-view.ts";

test("the demo adapter feeds every fixture through the shared engine view model", () => {
  for (const scenario of DEMO_SCENARIOS) {
    const view = getDemoRunwayView(scenario.id);

    assert.equal(view.today, scenario.today);
    assert.equal(view.snapshot.data_source.source, "demo_fixture");
    assert.equal(view.snapshot.data_source.is_live, false);
    assert.equal(view.forecast.state, scenario.expected_forecast.state);
    assert.equal(
      view.forecast.lowest_balance,
      scenario.expected_forecast.lowest_balance,
    );
    assert.equal(view.pings.length, 1);
    assert.equal(view.pings[0]?.state, view.forecast.state);
    assert.equal(
      view.pings[0]?.cta.action.target_payer_id,
      view.forecast.recommended_action.target_payer_id,
    );
    assert.equal(
      view.pings[0]?.cta.action.target_invoice_id,
      view.forecast.recommended_action.target_invoice_id,
    );
  }
});

test("the source-to-view seam preserves a labelled non-demo source", () => {
  const scenario = DEMO_SCENARIOS[0];
  const snapshot: RunwayDataSnapshot = {
    data_source: {
      source: "pinch_sandbox",
      connection_state: "error",
      is_live: false,
      display_label: "Pinch sandbox not connected",
      last_synced_at: null,
      error_message: "A real sandbox read failed.",
    },
    payers: scenario.payers,
    invoices: scenario.invoices,
    payment_history: scenario.payment_history,
    declared_expenses: scenario.declared_expenses,
  };
  const view = buildRunwayView(snapshot, scenario.today);

  assert.equal(view.snapshot.data_source.source, "pinch_sandbox");
  assert.equal(view.snapshot.data_source.connection_state, "error");
  assert.equal(view.snapshot.data_source.is_live, false);
  assert.doesNotMatch(view.snapshot.data_source.display_label, /demo/i);
});

