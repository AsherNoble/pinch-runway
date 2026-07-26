import type { IsoDate } from "./contracts";
import { addDays, compareDates, daysBetween } from "./date-utils.ts";
import type {
  BankTransaction,
  ExpenseProfile,
  RecurringCadence,
  RecurringExpense,
} from "./runway-contracts";

export interface ExpenseDerivationInput {
  today: IsoDate;
  transactions: readonly BankTransaction[];
  selected_account_ids: readonly string[];
  exclusion_patterns?: readonly string[];
  lookback_days?: number;
}

interface Candidate {
  transaction: BankTransaction;
  key: string;
}

const TRANSFER_CLASS = /(^|[-_\s])(transfer|payment)([-_\s]|$)/i;
const CARD_REPAYMENT = /\b(card|visa|mastercard|amex).{0,20}(payment|repayment)\b|\bpayment.{0,20}(card|visa|mastercard|amex)\b/i;

export function normaliseMerchant(description: string): string {
  return description
    .toLowerCase()
    .replace(/\b\d{2,}\b/g, " ")
    .replace(/[^a-z]+/g, " ")
    .replace(/\b(pos|eftpos|purchase|direct debit|payment to|from)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "unknown merchant";
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function detectCadence(intervals: readonly number[]): {
  cadence: RecurringCadence;
  days: 7 | 14 | 30;
} | null {
  const candidates = [
    { cadence: "weekly" as const, days: 7 as const, tolerance: 2 },
    { cadence: "fortnightly" as const, days: 14 as const, tolerance: 3 },
    { cadence: "monthly" as const, days: 30 as const, tolerance: 5 },
  ];
  return candidates.find(({ days, tolerance }) =>
    intervals.every((value) => Math.abs(value - days) <= tolerance),
  ) ?? null;
}

function recurringFromGroup(
  today: IsoDate,
  group: readonly Candidate[],
): RecurringExpense | null {
  if (group.length < 3) return null;
  const sorted = [...group].sort((left, right) =>
    compareDates(left.transaction.post_date, right.transaction.post_date),
  );
  const amounts = sorted.map(({ transaction }) => transaction.amount_cents);
  const typical = median(amounts);
  if (typical <= 0 || amounts.some((amount) => Math.abs(amount - typical) / typical > 0.1)) {
    return null;
  }
  const intervals = sorted.slice(1).map((item, index) =>
    daysBetween(sorted[index].transaction.post_date, item.transaction.post_date),
  );
  const detected = detectCadence(intervals);
  if (!detected) return null;

  const lastSeen = sorted.at(-1)!.transaction.post_date;
  const projectedDates: IsoDate[] = [];
  let next = addDays(lastSeen, detected.days);
  while (compareDates(next, today) < 0) next = addDays(next, detected.days);
  const end = addDays(today, 29);
  while (compareDates(next, end) <= 0) {
    projectedDates.push(next);
    next = addDays(next, detected.days);
  }

  return {
    merchant_key: group[0].key,
    label: sorted.at(-1)!.transaction.description,
    cadence: detected.cadence,
    cadence_days: detected.days,
    typical_amount_cents: typical,
    occurrences: sorted.length,
    last_seen_on: lastSeen,
    projected_dates: projectedDates,
  };
}

export function deriveExpenseProfile(
  input: ExpenseDerivationInput,
  now = new Date(),
): ExpenseProfile {
  const lookbackDays = input.lookback_days ?? 90;
  const selected = new Set(input.selected_account_ids);
  const patterns = (input.exclusion_patterns ?? [])
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean);
  const from = addDays(input.today, -(lookbackDays - 1));

  const relevant = input.transactions.filter((transaction) =>
    selected.has(transaction.account_id) &&
    compareDates(transaction.post_date, from) >= 0 &&
    compareDates(transaction.post_date, input.today) <= 0,
  );
  const postedDebits = relevant.filter((transaction) =>
    transaction.status === "posted" && transaction.direction === "debit",
  );
  const pendingDebits = relevant
    .filter((transaction) =>
      transaction.status === "pending" && transaction.direction === "debit",
    )
    .map((transaction) => ({
      id: transaction.id,
      description: transaction.description,
      amount_cents: transaction.amount_cents,
      post_date: transaction.post_date,
      changeable: true as const,
    }));

  const excluded: BankTransaction[] = [];
  const candidates: Candidate[] = [];
  for (const transaction of postedDebits) {
    const key = normaliseMerchant(transaction.description);
    const personallyExcluded = patterns.some((pattern) =>
      `${transaction.description} ${key}`.toLowerCase().includes(pattern),
    );
    const transfer =
      TRANSFER_CLASS.test(transaction.transaction_class ?? "") ||
      /\btransfer\b/i.test(transaction.description);
    const cardRepayment =
      CARD_REPAYMENT.test(transaction.description) &&
      relevant.some((candidate) =>
        candidate.status === "posted" &&
        candidate.direction === "credit" &&
        candidate.account_id !== transaction.account_id &&
        candidate.amount_cents === transaction.amount_cents &&
        Math.abs(daysBetween(candidate.post_date, transaction.post_date)) <= 3 &&
        (
          /loan-repayment|transfer/i.test(candidate.transaction_class ?? "") ||
          CARD_REPAYMENT.test(candidate.description)
        ),
      );
    if (personallyExcluded || transfer || cardRepayment) {
      excluded.push(transaction);
    } else {
      candidates.push({ transaction, key });
    }
  }

  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const existing = groups.get(candidate.key) ?? [];
    existing.push(candidate);
    groups.set(candidate.key, existing);
  }
  const recurring = [...groups.values()]
    .map((group) => recurringFromGroup(input.today, group))
    .filter((item): item is RecurringExpense => item !== null)
    .sort((left, right) => left.label.localeCompare(right.label));
  const recurringKeys = new Set(recurring.map((item) => item.merchant_key));
  const variable = candidates.filter((candidate) => !recurringKeys.has(candidate.key));

  const postedDebitsCents = postedDebits.reduce(
    (sum, transaction) => sum + transaction.amount_cents,
    0,
  );
  const excludedDebitsCents = excluded.reduce(
    (sum, transaction) => sum + transaction.amount_cents,
    0,
  );
  const variableDebitsCents = variable.reduce(
    (sum, candidate) => sum + candidate.transaction.amount_cents,
    0,
  );
  const variableDailyAverageCents = Math.round(variableDebitsCents / lookbackDays);
  const recurringDailyAverageCents = Math.round(
    recurring.reduce(
      (sum, item) => sum + item.typical_amount_cents / item.cadence_days,
      0,
    ),
  );

  return {
    lookback_days: lookbackDays,
    posted_debits_cents: postedDebitsCents,
    excluded_debits_cents: excludedDebitsCents,
    variable_debits_cents: variableDebitsCents,
    variable_daily_average_cents: variableDailyAverageCents,
    normal_daily_spend_cents:
      variableDailyAverageCents + recurringDailyAverageCents,
    recurring,
    pending_debits: pendingDebits,
    derived_at: now.toISOString(),
  };
}
