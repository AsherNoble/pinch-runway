import type { Cents, IsoDate } from "../contracts.ts";
import { addDays, compareDates, daysBetween, epochDay } from "../date-utils.ts";
import type { Provenance } from "./contracts.ts";

const FORECAST_DAYS = 13 * 7;

export interface RecurringOutflow {
  id: string;
  label: string;
  amount_cents: Cents;
  next_due_date: IsoDate;
  cadence_days: number;
}

export interface KnownOutflow {
  id: string;
  label: string;
  amount_cents: Cents;
  due_date: IsoDate;
  provenance: Provenance;
}

export interface EvidenceCommitment {
  id: string;
  label: string;
  amount_cents: Cents;
  due_date: IsoDate;
  source: "gmail" | "calendar";
  source_id: string;
  provenance: Provenance;
}

export interface ForecastReceivable {
  id: string;
  payer_name: string;
  amount_cents: Cents;
  due_date: IsoDate;
  expected_date: IsoDate;
  status: "unpaid" | "paid" | "written_off";
  reminder_count?: number;
}

export interface AgentForecastInput {
  today: IsoDate;
  opening_cash_cents: Cents;
  daily_variable_spend_cents: Cents;
  /**
   * Material risk means falling below this owner-configured operating buffer.
   * Defaults to seven days of variable spend.
   */
  risk_buffer_cents?: Cents;
  recurring_outflows: readonly RecurringOutflow[];
  known_outflows: readonly KnownOutflow[];
  evidence_commitments: readonly EvidenceCommitment[];
  receivables: readonly ForecastReceivable[];
}

export interface WeeklyForecastBucket {
  week: number;
  start_date: IsoDate;
  end_date: IsoDate;
  variable_spend_cents: Cents;
  scheduled_outflows_cents: Cents;
  expected_receipts_cents: Cents;
  cash_only_closing_cents: Cents;
  expected_closing_cents: Cents;
  cash_only_low_cents: Cents;
  expected_low_cents: Cents;
}

export interface CollectionCandidate {
  receivable_id: string;
  payer_name: string;
  amount_cents: Cents;
  due_date: IsoDate;
  expected_date: IsoDate;
  overdue_days: number;
  repair_cents: Cents;
}

export interface AgentForecastResult {
  generated_on: IsoDate;
  window: {
    start_date: IsoDate;
    end_date: IsoDate;
    weeks: 13;
  };
  opening_cash_cents: Cents;
  risk_buffer_cents: Cents;
  weeks: readonly WeeklyForecastBucket[];
  cash_only: {
    closing_cents: Cents;
    low_cents: Cents;
    low_date: IsoDate;
    first_risk_date: IsoDate | null;
  };
  expected_with_receivables: {
    closing_cents: Cents;
    low_cents: Cents;
    low_date: IsoDate;
    first_risk_date: IsoDate | null;
  };
  /**
   * The cash-only path determines whether collection intervention is needed.
   * The expected path remains visible so the agent can explain uncertainty.
   */
  material_risk_date: IsoDate | null;
  repair_amount_cents: Cents;
  ranked_collection_targets: readonly CollectionCandidate[];
}

interface ScheduledAmount {
  date: IsoDate;
  amount_cents: Cents;
}

function assertNonNegativeCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer-cent value`);
  }
}

function assertPositiveCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer-cent value`);
  }
}

function sum(items: readonly ScheduledAmount[], date: IsoDate): Cents {
  return items
    .filter((item) => item.date === date)
    .reduce((total, item) => total + item.amount_cents, 0);
}

function validateInput(input: AgentForecastInput): void {
  epochDay(input.today);
  assertNonNegativeCents(input.opening_cash_cents, "opening_cash_cents");
  assertNonNegativeCents(
    input.daily_variable_spend_cents,
    "daily_variable_spend_cents",
  );

  if (input.risk_buffer_cents !== undefined) {
    assertNonNegativeCents(input.risk_buffer_cents, "risk_buffer_cents");
  }

  const ids = new Set<string>();
  const register = (id: string, label: string) => {
    if (!id.trim()) throw new Error(`${label}.id must not be empty`);
    if (ids.has(id)) throw new Error(`duplicate forecast item id: ${id}`);
    ids.add(id);
  };

  for (const item of input.recurring_outflows) {
    register(item.id, "recurring_outflow");
    assertPositiveCents(item.amount_cents, `${item.id}.amount_cents`);
    epochDay(item.next_due_date);
    if (!Number.isSafeInteger(item.cadence_days) || item.cadence_days <= 0) {
      throw new Error(`${item.id}.cadence_days must be a positive integer`);
    }
  }

  for (const item of [...input.known_outflows, ...input.evidence_commitments]) {
    register(item.id, "outflow");
    assertPositiveCents(item.amount_cents, `${item.id}.amount_cents`);
    epochDay(item.due_date);
  }

  for (const item of input.receivables) {
    register(item.id, "receivable");
    assertPositiveCents(item.amount_cents, `${item.id}.amount_cents`);
    epochDay(item.due_date);
    epochDay(item.expected_date);
  }
}

function recurringSchedule(
  item: RecurringOutflow,
  start: IsoDate,
  end: IsoDate,
): ScheduledAmount[] {
  let date = item.next_due_date;

  if (compareDates(date, start) < 0) {
    const elapsed = daysBetween(date, start);
    date = addDays(date, Math.ceil(elapsed / item.cadence_days) * item.cadence_days);
  }

  const scheduled: ScheduledAmount[] = [];
  while (compareDates(date, end) <= 0) {
    scheduled.push({ date, amount_cents: item.amount_cents });
    date = addDays(date, item.cadence_days);
  }
  return scheduled;
}

function compareTargets(
  left: CollectionCandidate,
  right: CollectionCandidate,
): number {
  return (
    right.repair_cents - left.repair_cents ||
    right.overdue_days - left.overdue_days ||
    compareDates(left.due_date, right.due_date) ||
    right.amount_cents - left.amount_cents ||
    left.receivable_id.localeCompare(right.receivable_id)
  );
}

export function buildAgentForecast(
  input: AgentForecastInput,
): AgentForecastResult {
  validateInput(input);

  const end = addDays(input.today, FORECAST_DAYS - 1);
  const riskBuffer =
    input.risk_buffer_cents ?? input.daily_variable_spend_cents * 7;
  const scheduledOutflows: ScheduledAmount[] = [
    ...input.recurring_outflows.flatMap((item) =>
      recurringSchedule(item, input.today, end),
    ),
    ...input.known_outflows
      .filter(
        (item) =>
          compareDates(item.due_date, input.today) >= 0 &&
          compareDates(item.due_date, end) <= 0,
      )
      .map((item) => ({ date: item.due_date, amount_cents: item.amount_cents })),
    ...input.evidence_commitments
      .filter(
        (item) =>
          compareDates(item.due_date, input.today) >= 0 &&
          compareDates(item.due_date, end) <= 0,
      )
      .map((item) => ({ date: item.due_date, amount_cents: item.amount_cents })),
  ];
  const scheduledReceipts: ScheduledAmount[] = input.receivables
    .filter(
      (item) =>
        item.status === "unpaid" && compareDates(item.expected_date, end) <= 0,
    )
    .map((item) => ({
      date:
        compareDates(item.expected_date, input.today) < 0
          ? input.today
          : item.expected_date,
      amount_cents: item.amount_cents,
    }));

  let cashOnly = input.opening_cash_cents;
  let expected = input.opening_cash_cents;
  let cashLow = cashOnly;
  let expectedLow = expected;
  let cashLowDate = input.today;
  let expectedLowDate = input.today;
  let cashRiskDate: IsoDate | null =
    cashOnly < riskBuffer ? input.today : null;
  let cashAtRisk: Cents | null =
    cashOnly < riskBuffer ? cashOnly : null;
  let expectedRiskDate: IsoDate | null =
    expected < riskBuffer ? input.today : null;

  const buckets: WeeklyForecastBucket[] = [];
  for (let week = 0; week < 13; week += 1) {
    const weekStart = addDays(input.today, week * 7);
    const weekEnd = addDays(weekStart, 6);
    let weeklyOutflows = 0;
    let weeklyReceipts = 0;
    let weeklyCashLow = cashOnly;
    let weeklyExpectedLow = expected;

    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(weekStart, offset);
      const outflows = sum(scheduledOutflows, date);
      const receipts = sum(scheduledReceipts, date);
      weeklyOutflows += outflows;
      weeklyReceipts += receipts;
      cashOnly -= input.daily_variable_spend_cents + outflows;
      expected += receipts - input.daily_variable_spend_cents - outflows;

      if (cashOnly < cashLow) {
        cashLow = cashOnly;
        cashLowDate = date;
      }
      if (expected < expectedLow) {
        expectedLow = expected;
        expectedLowDate = date;
      }
      weeklyCashLow = Math.min(weeklyCashLow, cashOnly);
      weeklyExpectedLow = Math.min(weeklyExpectedLow, expected);
      if (cashRiskDate === null && cashOnly < riskBuffer) {
        cashRiskDate = date;
        cashAtRisk = cashOnly;
      }
      if (expectedRiskDate === null && expected < riskBuffer) {
        expectedRiskDate = date;
      }
    }

    buckets.push({
      week: week + 1,
      start_date: weekStart,
      end_date: weekEnd,
      variable_spend_cents: input.daily_variable_spend_cents * 7,
      scheduled_outflows_cents: weeklyOutflows,
      expected_receipts_cents: weeklyReceipts,
      cash_only_closing_cents: cashOnly,
      expected_closing_cents: expected,
      cash_only_low_cents: weeklyCashLow,
      expected_low_cents: weeklyExpectedLow,
    });
  }

  const repairAmount = Math.max(0, riskBuffer - (cashAtRisk ?? riskBuffer));
  const targets = input.receivables
    .filter((item) => item.status === "unpaid")
    .map<CollectionCandidate>((item) => ({
      receivable_id: item.id,
      payer_name: item.payer_name,
      amount_cents: item.amount_cents,
      due_date: item.due_date,
      expected_date: item.expected_date,
      overdue_days: Math.max(0, daysBetween(item.due_date, input.today)),
      repair_cents: Math.min(item.amount_cents, repairAmount),
    }))
    .sort(compareTargets);

  return {
    generated_on: input.today,
    window: {
      start_date: input.today,
      end_date: end,
      weeks: 13,
    },
    opening_cash_cents: input.opening_cash_cents,
    risk_buffer_cents: riskBuffer,
    weeks: buckets,
    cash_only: {
      closing_cents: cashOnly,
      low_cents: cashLow,
      low_date: cashLowDate,
      first_risk_date: cashRiskDate,
    },
    expected_with_receivables: {
      closing_cents: expected,
      low_cents: expectedLow,
      low_date: expectedLowDate,
      first_risk_date: expectedRiskDate,
    },
    material_risk_date: cashRiskDate,
    repair_amount_cents: repairAmount,
    ranked_collection_targets: targets,
  };
}
