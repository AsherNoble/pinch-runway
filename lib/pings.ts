import type {
  ForecastPing,
  ForecastPingCta,
  Invoice,
  Payer,
  RecommendationAction,
} from "./contracts";
import {
  calculateForecast,
  getCalendarDayDifference,
  type ForecastAnalysis,
} from "./forecast.ts";
import {
  getObservedLatenessText,
  recommendCollectionAction,
  type RecommendationInput,
} from "./recommendation.ts";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

interface ActionTarget {
  invoice: Invoice;
  payer: Payer;
}

function formatAud(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const wholeDollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  const groupedWholeDollars = wholeDollars.toLocaleString("en-AU");

  if (remainder === 0) {
    return sign + "$" + groupedWholeDollars;
  }

  return sign + "$" + groupedWholeDollars + "." + String(remainder).padStart(2, "0");
}

function formatDate(date: string): string {
  const parsed = new Date(date + "T00:00:00.000Z");

  return (
    WEEKDAY_NAMES[parsed.getUTCDay()] +
    " " +
    parsed.getUTCDate() +
    " " +
    MONTH_NAMES[parsed.getUTCMonth()]
  );
}

function joinWithAnd(parts: readonly string[]): string {
  if (parts.length === 0) return "your declared commitments";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] + " and " + parts[1];

  return parts.slice(0, -1).join(", ") + ", and " + parts.at(-1);
}

function capitalizeFirst(value: string): string {
  return value.length === 0
    ? value
    : value.slice(0, 1).toUpperCase() + value.slice(1);
}

function describeCommitments(analysis: ForecastAnalysis): string {
  const lumpyItems = analysis.in_window_lumpy_expenses.map(
    (expense) =>
      formatAud(expense.amount) +
      " " +
      expense.note +
      " due " +
      formatDate(expense.date),
  );

  return joinWithAnd([
    "your declared " + formatAud(analysis.weekly_draw.amount) + " weekly draw",
    ...lumpyItems,
  ]);
}

function findSingleTimelyReliableInvoice(
  analysis: ForecastAnalysis,
) {
  return (
    analysis.ledgers.reliable.scheduled_receipts.find((receipt) =>
      analysis.ledgers.reliable.positions.every(
        (position) =>
          receipt.expected_arrival_date <= position.date &&
          receipt.amount >= position.commitments_due,
      ),
    ) ?? null
  );
}

function findActionTarget(
  input: RecommendationInput,
  action: RecommendationAction,
): ActionTarget | null {
  if (action.type !== "create_payment_link") return null;

  const invoice = input.invoices.find(
    (candidate) => candidate.id === action.target_invoice_id,
  );
  const payer = input.payers.find(
    (candidate) => candidate.id === action.target_payer_id,
  );

  return invoice && payer ? { invoice, payer } : null;
}

function getCta(action: RecommendationAction): ForecastPingCta {
  if (action.type === "create_payment_link") {
    return {
      label: "Create Pinch payment link",
      action,
    };
  }

  if (action.reason === "no_collection_target") {
    return {
      label: "No Pinch collection to target",
      action,
    };
  }

  return {
    label: "Sit tight",
    action,
  };
}

function targetCollectionConsequence(
  target: ActionTarget | null,
  input: RecommendationInput,
): string {
  if (!target) {
    return "There is no known unpaid Pinch invoice to target with a payment link.";
  }

  const daysOverdue = Math.max(
    0,
    getCalendarDayDifference(target.invoice.due_date, input.today),
  );
  const dueText =
    daysOverdue > 0
      ? " is " + daysOverdue + " days overdue."
      : " is due " + formatDate(target.invoice.due_date) + ".";
  const history = getObservedLatenessText(target.payer, input.payment_history);

  return (
    target.payer.name +
    "'s " +
    formatAud(target.invoice.amount) +
    " invoice" +
    dueText + (history ? " " + history : "")
  );
}

/**
 * Generate the pings-first forecast payload from the deterministic forecast
 * and recommendation layers. It performs no provider request; its CTA gives
 * the UI the exact target for a later confirmed Pinch Payment Link action.
 */
export function createForecastPing(
  input: RecommendationInput,
  analysis: ForecastAnalysis = calculateForecast(input),
  action: RecommendationAction = recommendCollectionAction(input, analysis),
): ForecastPing {
  const cta = getCta(action);
  const commitmentDescription = describeCommitments(analysis);

  if (analysis.state === "comfortable") {
    const reliableInvoice = findSingleTimelyReliableInvoice(analysis);

    if (reliableInvoice) {
      return {
        id: "weekly-forecast",
        state: analysis.state,
        text:
          reliableInvoice.payer_name +
          "'s " +
          formatAud(reliableInvoice.amount) +
          " invoice is due " +
          formatDate(reliableInvoice.due_date) +
          " and they have never paid late.",
        amount: {
          cents: reliableInvoice.amount,
          role: "reliable_invoice",
        },
        consequence:
          "It alone covers " +
          commitmentDescription +
          ". Sit tight — no need to create a payment link today.",
        cta,
      };
    }

    return {
      id: "weekly-forecast",
      state: analysis.state,
      text:
        "Timely never-late collections cover " +
        commitmentDescription +
        " in the next seven days.",
      amount: {
        cents: analysis.coverage_floors.reliable_floor,
        role: "reliable_margin",
      },
      consequence:
        formatAud(analysis.coverage_floors.reliable_floor) +
        " of reliable planning cushion remains. Sit tight.",
      cta,
    };
  }

  if (analysis.state === "safe") {
    const reliableInvoice =
      findSingleTimelyReliableInvoice(analysis) ??
      analysis.ledgers.reliable.scheduled_receipts[0] ??
      null;

    return {
      id: "weekly-forecast",
      state: analysis.state,
      text: reliableInvoice
        ? reliableInvoice.payer_name +
          "'s " +
          formatAud(reliableInvoice.amount) +
          " timely invoice covers " +
          commitmentDescription +
          "."
        : "Timely never-late collections cover " + commitmentDescription + ".",
      amount: {
        cents: analysis.coverage_floors.reliable_floor,
        role: "reliable_margin",
      },
      consequence:
        formatAud(analysis.coverage_floors.reliable_floor) +
        " reliable planning margin remains this week. Sit tight.",
      cta,
    };
  }

  const target = findActionTarget(input, action);

  if (analysis.state === "tight") {
    const expectedMargin = analysis.lowest_balance;
    const expectedConsequence =
      expectedMargin >= 0
        ? "Expected coverage leaves only " +
          formatAud(expectedMargin) +
          " of planning margin."
        : "Expected coverage is " +
          formatAud(-expectedMargin) +
          " short before unknown-history collections are considered.";

    return {
      id: "weekly-forecast",
      state: analysis.state,
      text: targetCollectionConsequence(target, input),
      amount: {
        cents: target?.invoice.amount ?? Math.abs(expectedMargin),
        role: target ? "target_invoice" : "expected_margin",
      },
      consequence:
        capitalizeFirst(commitmentDescription) +
        " fall inside this window. " +
        expectedConsequence,
      cta,
    };
  }

  const optimisticShortfall = Math.abs(
    analysis.coverage_floors.optimistic_floor,
  );

  return {
    id: "weekly-forecast",
    state: analysis.state,
    text:
      capitalizeFirst(commitmentDescription) +
      " total " +
      formatAud(analysis.total_commitments) +
      " in the next seven days. Even if every in-window unpaid invoice lands, the planning gap is " +
      formatAud(optimisticShortfall) +
      ".",
    amount: {
      cents: optimisticShortfall,
      role: "optimistic_shortfall",
    },
    consequence: targetCollectionConsequence(target, input),
    cta,
  };
}
