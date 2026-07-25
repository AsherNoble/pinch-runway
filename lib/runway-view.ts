import type {
  DemoScenario,
  ForecastPing,
  ForecastResult,
  IsoDate,
  RunwayDataSnapshot,
} from "./contracts";
import { DEMO_SCENARIOS } from "./demo-fixtures.ts";
import { calculateForecast, type ForecastAnalysis } from "./forecast.ts";
import { createForecastPing } from "./pings.ts";
import {
  calculateForecastResult,
  type RecommendationInput,
} from "./recommendation.ts";

export interface RunwayViewModel {
  snapshot: RunwayDataSnapshot;
  today: IsoDate;
  analysis: ForecastAnalysis;
  forecast: ForecastResult;
  pings: readonly ForecastPing[];
}

/**
 * This is the one source-to-view seam for the dashboard. Lane A can pass a
 * real labelled Pinch sandbox snapshot here later; the frontend receives the
 * same view model whether the source is a fixture or a live sandbox read.
 */
export function buildRunwayView(
  snapshot: RunwayDataSnapshot,
  today: IsoDate,
): RunwayViewModel {
  const recommendationInput: RecommendationInput = {
    today,
    payers: snapshot.payers,
    invoices: snapshot.invoices,
    payment_history: snapshot.payment_history,
    declared_expenses: snapshot.declared_expenses,
  };
  const analysis = calculateForecast(recommendationInput);
  const forecast = calculateForecastResult(recommendationInput);
  const primaryPing = createForecastPing(
    recommendationInput,
    analysis,
    forecast.recommended_action,
  );

  return {
    snapshot,
    today,
    analysis,
    forecast,
    pings: [primaryPing],
  };
}

function toSnapshot(scenario: DemoScenario): RunwayDataSnapshot {
  return {
    data_source: scenario.data_source,
    payers: scenario.payers,
    invoices: scenario.invoices,
    payment_history: scenario.payment_history,
    declared_expenses: scenario.declared_expenses,
  };
}

/**
 * The current public page deliberately starts here. It is an explicit fixture
 * mode, never an error fallback for a missing Pinch sandbox response.
 */
export function getDemoRunwayView(
  scenarioId: DemoScenario["id"] = DEMO_SCENARIOS[0].id,
): RunwayViewModel {
  const scenario = DEMO_SCENARIOS.find(
    (candidate) => candidate.id === scenarioId,
  );

  if (!scenario) {
    throw new Error("Unknown demo scenario: " + scenarioId);
  }

  return buildRunwayView(toSnapshot(scenario), scenario.today);
}
