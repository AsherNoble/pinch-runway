import type {
  ForecastResult,
  Invoice,
  PaymentHistoryEntry,
  Payer,
  RecommendationAction,
  ReliabilityBucket,
  WaitRecommendationAction,
} from "./contracts";
import {
  calculateForecast,
  getCalendarDayDifference,
  type ForecastAnalysis,
  type ForecastInput,
} from "./forecast.ts";

export interface RecommendationInput extends ForecastInput {
  /**
   * Payment history is only used to state an observed lateness range for a
   * sometimes-late payer. Payer.reliability remains Lane A's authoritative
   * derived bucket; no population score is calculated here.
   */
  payment_history: readonly PaymentHistoryEntry[];
}

interface CollectionCandidate {
  invoice: Invoice;
  payer: Payer;
  covers_deficit: boolean;
  is_overdue: boolean;
  overdue_days: number;
  reliability_priority: number;
  selection_arrival_date: string;
}

interface ReliableCoverageInvoice {
  payer_name: string;
  amount: number;
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

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareIsoDates(left: string, right: string): number {
  return compareStrings(left, right);
}

function reliabilityPriority(reliability: ReliabilityBucket): number {
  if (reliability === "sometimes_late") return 0;
  if (reliability === "no_history") return 1;
  return 2;
}

function findSingleReliableCoverage(
  analysis: ForecastAnalysis,
): ReliableCoverageInvoice | null {
  const reliableReceipts = analysis.ledgers.reliable.scheduled_receipts;

  for (const receipt of reliableReceipts) {
    const coversEveryCheckpoint = analysis.ledgers.reliable.positions.every(
      (position) =>
        compareIsoDates(receipt.expected_arrival_date, position.date) <= 0 &&
        receipt.amount >= position.commitments_due,
    );

    if (!coversEveryCheckpoint) continue;

    return {
      payer_name: receipt.payer_name,
      amount: receipt.amount,
    };
  }

  return null;
}

function buildWaitForReliableCoverage(
  analysis: ForecastAnalysis,
): WaitRecommendationAction {
  const singleInvoice = findSingleReliableCoverage(analysis);

  if (singleInvoice) {
    return {
      type: "wait",
      reason: "reliable_coverage",
      target_payer_id: null,
      target_invoice_id: null,
      rationale:
        "Sit tight — " +
        singleInvoice.payer_name +
        "'s " +
        formatAud(singleInvoice.amount) +
        " invoice alone covers " +
        formatAud(analysis.total_commitments) +
        " of declared commitments in the next seven days, and they have never paid late.",
    };
  }

  return {
    type: "wait",
    reason: "reliable_coverage",
    target_payer_id: null,
    target_invoice_id: null,
    rationale:
      "Sit tight — timely never-late collections cover " +
      formatAud(analysis.total_commitments) +
      " of declared commitments in the next seven days.",
  };
}

function buildWaitForNoTarget(
  analysis: ForecastAnalysis,
  deficit: number,
): WaitRecommendationAction {
  return {
    type: "wait",
    reason: "no_collection_target",
    target_payer_id: null,
    target_invoice_id: null,
    rationale:
      "Declared commitments have a " +
      formatAud(deficit) +
      " reliable coverage gap, but there is no unpaid Pinch invoice due in the next seven days to target with a payment link.",
  };
}

function getSelectionArrivalDate(
  invoice: Invoice,
  analysis: ForecastAnalysis,
): string {
  const expectedReceipt = analysis.ledgers.expected.scheduled_receipts.find(
    (receipt) => receipt.invoice_id === invoice.id,
  );

  return expectedReceipt?.expected_arrival_date ?? invoice.due_date;
}

function toCandidate(
  invoice: Invoice,
  payer: Payer,
  today: string,
  deficit: number,
  analysis: ForecastAnalysis,
): CollectionCandidate {
  const overdueDays = Math.max(
    0,
    getCalendarDayDifference(invoice.due_date, today),
  );

  return {
    invoice,
    payer,
    covers_deficit: invoice.amount >= deficit,
    is_overdue: overdueDays > 0,
    overdue_days: overdueDays,
    reliability_priority: reliabilityPriority(payer.reliability),
    selection_arrival_date: getSelectionArrivalDate(invoice, analysis),
  };
}

function compareCandidates(
  left: CollectionCandidate,
  right: CollectionCandidate,
): number {
  if (left.covers_deficit !== right.covers_deficit) {
    return left.covers_deficit ? -1 : 1;
  }

  if (left.is_overdue !== right.is_overdue) {
    return left.is_overdue ? -1 : 1;
  }

  if (left.overdue_days !== right.overdue_days) {
    return right.overdue_days - left.overdue_days;
  }

  if (left.reliability_priority !== right.reliability_priority) {
    return left.reliability_priority - right.reliability_priority;
  }

  const bySelectionArrival = compareIsoDates(
    left.selection_arrival_date,
    right.selection_arrival_date,
  );
  if (bySelectionArrival !== 0) return bySelectionArrival;

  if (left.invoice.amount !== right.invoice.amount) {
    return right.invoice.amount - left.invoice.amount;
  }

  const byDueDate = compareIsoDates(
    left.invoice.due_date,
    right.invoice.due_date,
  );
  if (byDueDate !== 0) return byDueDate;

  const byPayerName = compareStrings(left.payer.name, right.payer.name);
  if (byPayerName !== 0) return byPayerName;

  return compareStrings(left.invoice.id, right.invoice.id);
}

function observedLatenessText(
  payer: Payer,
  paymentHistory: readonly PaymentHistoryEntry[],
): string {
  if (payer.reliability === "no_history") {
    return "They have no payment history yet.";
  }

  if (payer.reliability === "never_late") {
    return "Their recorded payment history is never late.";
  }

  const observedDaysLate = paymentHistory
    .filter(
      (entry) =>
        entry.payer_id === payer.id &&
        Number.isFinite(entry.days_late) &&
        entry.days_late > 0,
    )
    .map((entry) => entry.days_late);

  if (observedDaysLate.length === 0) {
    return (
      "Their observed average is about " +
      Math.ceil(payer.avg_days_late ?? 0) +
      " days late."
    );
  }

  const earliest = Math.min(...observedDaysLate);
  const latest = Math.max(...observedDaysLate);

  if (earliest === latest) {
    return "Their observed payments were " + earliest + " days late.";
  }

  return (
    "Their observed payments were " +
    earliest +
    "–" +
    latest +
    " days late."
  );
}

function buildCreatePaymentLinkRationale(
  candidate: CollectionCandidate,
  analysis: ForecastAnalysis,
  paymentHistory: readonly PaymentHistoryEntry[],
  deficit: number,
): string {
  const overdueText = candidate.is_overdue
    ? " It is " + candidate.overdue_days + " days overdue."
    : " It is due on " + candidate.invoice.due_date + ".";
  const reliabilityText = observedLatenessText(
    candidate.payer,
    paymentHistory,
  );
  const consequence =
    analysis.state === "shortfall"
      ? " Even if all in-window invoices land, declared commitments still have a " +
        formatAud(-analysis.coverage_floors.optimistic_floor) +
        " gap."
      : " The earliest reliable coverage gap is " + formatAud(deficit) + ".";

  return (
    "Create a payment link for " +
    candidate.payer.name +
    "'s " +
    formatAud(candidate.invoice.amount) +
    " invoice today." +
    overdueText +
    " " +
    reliabilityText +
    consequence
  );
}

function getCandidates(
  input: RecommendationInput,
  analysis: ForecastAnalysis,
  atRiskDate: string,
  deficit: number,
): CollectionCandidate[] {
  const payersById = new Map(input.payers.map((payer) => [payer.id, payer]));
  const unpaidInvoices = input.invoices.filter(
    (invoice) => invoice.status === "unpaid",
  );
  const primary = unpaidInvoices.filter(
    (invoice) => compareIsoDates(invoice.due_date, atRiskDate) <= 0,
  );
  const fallback = unpaidInvoices.filter(
    (invoice) => compareIsoDates(invoice.due_date, analysis.window.end) <= 0,
  );
  const candidates = primary.length > 0 ? primary : fallback;

  return candidates
    .map((invoice) => {
      const payer = payersById.get(invoice.payer_id);
      if (!payer) {
        throw new Error("Forecast analysis contains an invoice with an unknown payer");
      }

      return toCandidate(invoice, payer, input.today, deficit, analysis);
    })
    .sort(compareCandidates);
}

/**
 * Produce the one actionable recommendation from already-calculated ledger
 * analysis. It makes no Pinch call; the frontend or Lane A action endpoint
 * performs the real Payment Link request only after the user confirms.
 */
export function recommendCollectionAction(
  input: RecommendationInput,
  analysis: ForecastAnalysis = calculateForecast(input),
): RecommendationAction {
  const atRiskDate = analysis.earliest_reliable_shortfall_date;

  if (!atRiskDate) {
    return buildWaitForReliableCoverage(analysis);
  }

  const atRiskPosition = analysis.ledgers.reliable.positions.find(
    (position) => position.date === atRiskDate,
  );
  const deficit = Math.max(0, -(atRiskPosition?.position ?? 0));
  const candidate = getCandidates(input, analysis, atRiskDate, deficit)[0];

  if (!candidate) {
    return buildWaitForNoTarget(analysis, deficit);
  }

  return {
    type: "create_payment_link",
    target_payer_id: candidate.payer.id,
    target_invoice_id: candidate.invoice.id,
    rationale: buildCreatePaymentLinkRationale(
      candidate,
      analysis,
      input.payment_history,
      deficit,
    ),
  };
}

/**
 * Compose the pure forecast math and the deterministic recommendation into the
 * stable shared result consumed by UI and future API routes.
 */
export function calculateForecastResult(
  input: RecommendationInput,
): ForecastResult {
  const analysis = calculateForecast(input);

  return {
    state: analysis.state,
    lowest_balance: analysis.lowest_balance,
    cause: analysis.cause,
    recommended_action: recommendCollectionAction(input, analysis),
  };
}
