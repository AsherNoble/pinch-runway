import type {
  Cents,
  ForecastState,
  RecommendationAction,
} from "./contracts";

/**
 * The forecast is a seven-calendar-day planning window: `today` plus the
 * following six dates. The engine receives `today` explicitly, so its output
 * is deterministic and does not depend on a machine clock or timezone.
 */
export const FORECAST_WINDOW_DAYS = 7;
export const FORECAST_WINDOW_END_OFFSET_DAYS = FORECAST_WINDOW_DAYS - 1;

/**
 * A Comfortable forecast needs a meaningful reliable cushion: the larger of
 * $100 or 10% of the declared commitments in the seven-day window.
 */
export const MIN_COMFORTABLE_CUSHION_CENTS = 10_000;
export const COMFORTABLE_CUSHION_DIVISOR = 10;

export interface ForecastCoverageFloors {
  /** Coverage using invoices with planned collection coverage. */
  reliable_floor: Cents;
  /** Coverage using the expected-arrival ledger. This becomes lowest_balance. */
  expected_floor: Cents;
  /** Coverage if every unpaid invoice due in the window arrives on time. */
  optimistic_floor: Cents;
  total_commitments: Cents;
}

export interface ForecastPolicyExample {
  scenario_id: string;
  expected_state: ForecastState;
  expected_lowest_balance: Cents;
  expected_action_type: RecommendationAction["type"];
  expected_target_payer_id: string | null;
  expected_target_invoice_id: string | null;
}

/**
 * These fixed examples make the policy reviewable before the engine is wired
 * into the UI. ENG-02 executes the same scenarios through the full engine.
 */
export const FORECAST_POLICY_EXAMPLES: readonly ForecastPolicyExample[] = [
  {
    scenario_id: "demo-comfortable-reliable-coverage",
    expected_state: "comfortable",
    expected_lowest_balance: 34_000,
    expected_action_type: "wait",
    expected_target_payer_id: null,
    expected_target_invoice_id: null,
  },
  {
    scenario_id: "demo-safe-lumpy-expense-covered",
    expected_state: "safe",
    expected_lowest_balance: 40_000,
    expected_action_type: "wait",
    expected_target_payer_id: null,
    expected_target_invoice_id: null,
  },
  {
    scenario_id: "demo-tight-overdue-unreliable-invoice",
    expected_state: "tight",
    expected_lowest_balance: 4_000,
    expected_action_type: "create_payment_link",
    expected_target_payer_id: "demo-payer-slow-steady",
    expected_target_invoice_id: "demo-invoice-slow-tight",
  },
  {
    scenario_id: "demo-shortfall-chase-late-payer",
    expected_state: "shortfall",
    expected_lowest_balance: -31_000,
    expected_action_type: "create_payment_link",
    expected_target_payer_id: "demo-payer-late-client",
    expected_target_invoice_id: "demo-invoice-late-shortfall",
  },
];

export function getComfortableCushion(
  totalCommitments: Cents,
): Cents {
  if (!Number.isSafeInteger(totalCommitments) || totalCommitments < 0) {
    throw new Error("totalCommitments must be a non-negative integer cent value");
  }

  return Math.max(
    MIN_COMFORTABLE_CUSHION_CENTS,
    Math.ceil(totalCommitments / COMFORTABLE_CUSHION_DIVISOR),
  );
}

/**
 * Classify the coverage ledgers without asserting anything about a bank
 * balance. With no declared commitments, there is nothing in scope to cover.
 */
export function deriveForecastState({
  reliable_floor,
  optimistic_floor,
  total_commitments,
}: ForecastCoverageFloors): ForecastState {
  if (total_commitments === 0) return "comfortable";
  if (optimistic_floor < 0) return "shortfall";
  // Possible collection gaps are shortfalls; a planned-coverage gap is tight.
  if (reliable_floor < 0) return "tight";
  if (reliable_floor < getComfortableCushion(total_commitments)) {
    return "safe";
  }

  return "comfortable";
}
