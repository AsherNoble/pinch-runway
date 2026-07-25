import type {
  ForecastResult,
  Invoice,
  PaymentHistoryEntry,
  Payer,
  RecommendationAction,
  InvoiceWarningInputs,
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
  warning_count: number;
  warnings: InvoiceWarningInputs;
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

function warningInputs(invoice: Invoice, today: string, invoices: readonly Invoice[]): InvoiceWarningInputs {
  const overdue_days = Math.max(0, getCalendarDayDifference(invoice.due_date, today));
  const stale_shared_reminder = !!invoice.reminder_shared_at &&
    getCalendarDayDifference(invoice.reminder_shared_at.slice(0, 10), today) >= 2;
  const unpaid = invoices.filter((candidate) => candidate.status === "unpaid");
  const amounts = unpaid.map((candidate) => candidate.amount).sort((a, b) => a - b);
  const median = amounts.length ? amounts[Math.floor(amounts.length / 2)] : invoice.amount;
  return {
    overdue_days,
    pinch_dishonour: invoice.pinch_dishonoured === true,
    stale_shared_reminder,
    no_payment_method: invoice.payment_method_on_file === false,
    unusually_old_or_large: overdue_days >= 14 || (amounts.length >= 3 && invoice.amount > median * 2),
  };
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
  invoices: readonly Invoice[],
): CollectionCandidate {
  const warnings = warningInputs(invoice, today, invoices);

  return {
    invoice,
    payer,
    covers_deficit: invoice.amount >= deficit,
    is_overdue: warnings.overdue_days > 0,
    overdue_days: warnings.overdue_days,
    warning_count: Object.values(warnings).filter(Boolean).length,
    warnings,
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

  if (left.warning_count !== right.warning_count) {
    return right.warning_count - left.warning_count;
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

export function getObservedLatenessText(
  payer: Payer,
  paymentHistory: readonly PaymentHistoryEntry[],
): string {
  const settled = paymentHistory
    .filter(
      (entry) =>
        entry.payer_id === payer.id &&
        Number.isFinite(entry.days_late) &&
        entry.days_late > 0,
    )
    .map((entry) => entry.days_late);

  // Absence of history is not displayed as a signal; history is secondary
  // context only after at least two settled invoices.
  if (settled.length < 2) return "";

  const earliest = Math.min(...settled);
  const latest = Math.max(...settled);

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
  const warningLabels = [
    candidate.warnings.pinch_dishonour && "a recorded Pinch dishonour",
    candidate.warnings.stale_shared_reminder && "a shared reminder still unpaid after 48 hours",
    candidate.warnings.no_payment_method && "no Pinch payment method or mandate on file",
    candidate.warnings.unusually_old_or_large && "an unusually old or large invoice",
  ].filter(Boolean);
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
    (warningLabels.length ? " Flagged for " + warningLabels.join(", ") + "." : "") +
    (getObservedLatenessText(candidate.payer, paymentHistory) ? " " + getObservedLatenessText(candidate.payer, paymentHistory) : "") +
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

      return toCandidate(invoice, payer, input.today, deficit, analysis, input.invoices);
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
