import type { Cents, IsoDate } from "./contracts";
import { addDays, compareDates, daysBetween } from "./date-utils.ts";
import type {
  DataSourceReadiness,
  DualForecast,
  ExpenseProfile,
  Receivable,
  ReceivableAging,
  ReminderDecision,
} from "./runway-contracts";

export function receivableArrivalDate(receivable: Receivable): {
  date: IsoDate;
  uncertain: boolean;
} {
  if (receivable.avg_days_late === null || receivable.payer_history_count === 0) {
    return { date: receivable.due_date, uncertain: true };
  }
  return {
    date: addDays(receivable.due_date, Math.max(0, Math.round(receivable.avg_days_late))),
    uncertain: false,
  };
}

export function ageReceivables(
  receivables: readonly Receivable[],
  today: IsoDate,
): ReceivableAging {
  const aging: ReceivableAging = {
    not_due_cents: 0,
    overdue_1_7_cents: 0,
    overdue_8_30_cents: 0,
    overdue_31_plus_cents: 0,
    total_unpaid_cents: 0,
  };
  for (const item of receivables) {
    if (item.status !== "unpaid") continue;
    aging.total_unpaid_cents += item.amount_cents;
    const overdue = daysBetween(item.due_date, today);
    if (overdue <= 0) aging.not_due_cents += item.amount_cents;
    else if (overdue <= 7) aging.overdue_1_7_cents += item.amount_cents;
    else if (overdue <= 30) aging.overdue_8_30_cents += item.amount_cents;
    else aging.overdue_31_plus_cents += item.amount_cents;
  }
  return aging;
}

export function buildDualForecast(input: {
  today: IsoDate;
  opening_operating_cash_cents: Cents;
  expense_profile: ExpenseProfile;
  receivables: readonly Receivable[];
}): DualForecast {
  const dates = Array.from({ length: 30 }, (_, index) => addDays(input.today, index));
  const riskBuffer = input.expense_profile.normal_daily_spend_cents * 7;
  let cashOnly = input.opening_operating_cash_cents;
  let expected = input.opening_operating_cash_cents;
  let cashLowest = cashOnly;
  let expectedLowest = expected;
  let cashLowestDate = input.today;
  let expectedLowestDate = input.today;
  let cashBreach: IsoDate | null = null;
  let expectedBreach: IsoDate | null = null;

  const points = dates.map((date) => {
    const recurring = input.expense_profile.recurring
      .filter((item) => item.projected_dates.includes(date))
      .reduce((sum, item) => sum + item.typical_amount_cents, 0);
    const projectedExpenses =
      input.expense_profile.variable_daily_average_cents + recurring;
    const pendingDebits = input.expense_profile.pending_debits
      .filter((item) => item.post_date === date)
      .reduce((sum, item) => sum + item.amount_cents, 0);
    const arriving = input.receivables.filter((item) => {
      if (item.status !== "unpaid") return false;
      const observed = receivableArrivalDate(item).date;
      const forecastDate =
        compareDates(observed, input.today) < 0 ? input.today : observed;
      return forecastDate === date;
    });
    const receipts = arriving.reduce((sum, item) => sum + item.amount_cents, 0);

    cashOnly -= projectedExpenses + pendingDebits;
    expected += receipts - projectedExpenses - pendingDebits;
    if (cashOnly < cashLowest) {
      cashLowest = cashOnly;
      cashLowestDate = date;
    }
    if (expected < expectedLowest) {
      expectedLowest = expected;
      expectedLowestDate = date;
    }
    if (cashBreach === null && cashOnly < riskBuffer) cashBreach = date;
    if (expectedBreach === null && expected < riskBuffer) expectedBreach = date;

    return {
      date,
      projected_expenses_cents: projectedExpenses,
      pending_debits_cents: pendingDebits,
      expected_receipts_cents: receipts,
      cash_only_cents: cashOnly,
      expected_with_receivables_cents: expected,
      uncertain_receivable_ids: arriving
        .filter((item) => {
          const arrival = receivableArrivalDate(item);
          return arrival.uncertain || compareDates(arrival.date, input.today) < 0;
        })
        .map((item) => item.id),
    };
  });

  return {
    opening_operating_cash_cents: input.opening_operating_cash_cents,
    risk_buffer_cents: riskBuffer,
    cash_only: {
      closing_position_cents: cashOnly,
      lowest_position_cents: cashLowest,
      lowest_position_date: cashLowestDate,
      first_buffer_breach_date: cashBreach,
    },
    expected_with_receivables: {
      closing_position_cents: expected,
      lowest_position_cents: expectedLowest,
      lowest_position_date: expectedLowestDate,
      first_buffer_breach_date: expectedBreach,
    },
    points,
  };
}

function ready(source: DataSourceReadiness): boolean {
  return source.state === "connected" || source.state === "demo";
}

export function decideReminder(input: {
  now: Date;
  today: IsoDate;
  bank_source: DataSourceReadiness;
  receivables_source: DataSourceReadiness;
  forecast: DualForecast;
  receivables: readonly Receivable[];
  require_weekday_evaluation?: boolean;
}): ReminderDecision {
  const id = `${input.today}:${input.now.toISOString()}`;
  const base = {
    id,
    evaluated_at: input.now.toISOString(),
    local_date: input.today,
    earliest_breach_date: input.forecast.cash_only.first_buffer_breach_date,
    risk_buffer_cents: input.forecast.risk_buffer_cents,
  };
  const breachDate = input.forecast.cash_only.first_buffer_breach_date;
  const breachPoint = breachDate
    ? input.forecast.points.find((point) => point.date === breachDate)
    : null;
  const inSevenDays =
    breachDate !== null && compareDates(breachDate, addDays(input.today, 6)) <= 0;

  const suppressed = (
    reason: ReminderDecision["suppression_reason"],
  ): ReminderDecision => ({
    ...base,
    eligible: false,
    target_receivable_id: null,
    cash_at_breach_cents: breachPoint?.cash_only_cents ?? null,
    repair_amount_cents: null,
    suppression_reason: reason,
  });

  if (!ready(input.bank_source)) return suppressed("bank_data_not_ready");
  if (!ready(input.receivables_source)) return suppressed("receivables_not_ready");
  if (!inSevenDays) return suppressed("no_cash_risk");

  const overdue = input.receivables.filter((item) =>
    item.status === "unpaid" && compareDates(item.due_date, input.today) < 0,
  );
  if (!overdue.length) return suppressed("no_overdue_invoice");
  const cadenceEligible = overdue.filter((item) =>
    !item.last_reminder_at ||
    input.now.getTime() - Date.parse(item.last_reminder_at) >= 72 * 60 * 60 * 1000,
  );
  if (!cadenceEligible.length) return suppressed("cadence_limit");
  const belowCap = cadenceEligible.filter((item) => item.reminder_count < 5);
  if (!belowCap.length) return suppressed("send_cap");

  const cashAtBreach = breachPoint?.cash_only_cents ?? 0;
  const deficit = Math.max(0, input.forecast.risk_buffer_cents - cashAtBreach);
  const ranked = [...belowCap].sort((left, right) => {
    const leftRepair = Math.min(left.amount_cents, deficit);
    const rightRepair = Math.min(right.amount_cents, deficit);
    return (
      rightRepair - leftRepair ||
      compareDates(left.due_date, right.due_date) ||
      right.amount_cents - left.amount_cents ||
      left.reminder_count - right.reminder_count ||
      left.id.localeCompare(right.id)
    );
  });
  const target = ranked[0];
  return {
    ...base,
    eligible: true,
    target_receivable_id: target.id,
    cash_at_breach_cents: cashAtBreach,
    repair_amount_cents: Math.min(target.amount_cents, deficit),
    suppression_reason: null,
  };
}
