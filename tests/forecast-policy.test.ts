import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_SCENARIOS } from "../lib/demo-fixtures.ts";
import {
  FORECAST_POLICY_EXAMPLES,
  FORECAST_WINDOW_DAYS,
  deriveForecastState,
  getComfortableCushion,
} from "../lib/forecast-policy.ts";

test("the policy uses a seven-calendar-day window and deterministic cushion", () => {
  assert.equal(FORECAST_WINDOW_DAYS, 7);
  assert.equal(getComfortableCushion(0), 10_000);
  assert.equal(getComfortableCushion(82_000), 10_000);
  assert.equal(getComfortableCushion(1_250_010), 125_001);
});

test("the policy classifies the four forecast states deterministically", () => {
  assert.equal(
    deriveForecastState({
      reliable_floor: 34_000,
      expected_floor: 34_000,
      optimistic_floor: 34_000,
      total_commitments: 65_000,
    }),
    "comfortable",
  );
  assert.equal(
    deriveForecastState({
      reliable_floor: 8_000,
      expected_floor: 40_000,
      optimistic_floor: 40_000,
      total_commitments: 82_000,
    }),
    "safe",
  );
  assert.equal(
    deriveForecastState({
      reliable_floor: -89_000,
      expected_floor: 4_000,
      optimistic_floor: 4_000,
      total_commitments: 89_000,
    }),
    "tight",
  );
  assert.equal(
    deriveForecastState({
      reliable_floor: -81_000,
      expected_floor: -31_000,
      optimistic_floor: -21_000,
      total_commitments: 81_000,
    }),
    "shortfall",
  );
});

test("state boundaries do not turn zero coverage into a shortfall", () => {
  assert.equal(
    deriveForecastState({
      reliable_floor: -1,
      expected_floor: 0,
      optimistic_floor: 0,
      total_commitments: 10_000,
    }),
    "tight",
  );
  assert.equal(
    deriveForecastState({
      reliable_floor: 0,
      expected_floor: 0,
      optimistic_floor: 0,
      total_commitments: 10_000,
    }),
    "safe",
  );
  assert.equal(
    deriveForecastState({
      reliable_floor: 10_000,
      expected_floor: 10_000,
      optimistic_floor: 10_000,
      total_commitments: 10_000,
    }),
    "comfortable",
  );
});

test("canonical fixtures cover every state and both action paths", () => {
  assert.equal(FORECAST_POLICY_EXAMPLES.length, 4);

  for (const example of FORECAST_POLICY_EXAMPLES) {
    const scenario = DEMO_SCENARIOS.find(
      (candidate) => candidate.id === example.scenario_id,
    );
    assert.ok(scenario, `${example.scenario_id} must exist`);

    const forecast = scenario.expected_forecast;
    assert.equal(forecast.state, example.expected_state);
    assert.equal(forecast.lowest_balance, example.expected_lowest_balance);
    assert.equal(
      forecast.recommended_action.type,
      example.expected_action_type,
    );
    assert.equal(
      forecast.recommended_action.target_payer_id,
      example.expected_target_payer_id,
    );
    assert.equal(
      forecast.recommended_action.target_invoice_id,
      example.expected_target_invoice_id,
    );
  }

  assert.ok(
    FORECAST_POLICY_EXAMPLES.some(
      (example) => example.expected_action_type === "wait",
    ),
  );
  assert.ok(
    FORECAST_POLICY_EXAMPLES.some(
      (example) => example.expected_action_type === "create_payment_link",
    ),
  );
});
