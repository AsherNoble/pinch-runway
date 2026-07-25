import type {
  Cents,
  DeclaredExpense,
  ForecastState,
  Invoice,
  IsoDate,
  Payer,
  ReliabilityBucket,
  WeeklyDrawExpense,
} from "./contracts";
import {
  FORECAST_WINDOW_END_OFFSET_DAYS,
  deriveForecastState,
  type ForecastCoverageFloors,
} from "./forecast-policy.ts";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const ISO_CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ForecastInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForecastInputError";
  }
}

export interface ForecastInput {
  /**
   * Injected by the caller instead of reading the system clock. This keeps
   * seven-day projections deterministic in tests, the UI, and API handlers.
   */
  today: IsoDate;
  payers: readonly Payer[];
  invoices: readonly Invoice[];
  declared_expenses: readonly DeclaredExpense[];
}

export type ForecastReceiptLedgerName =
  | "reliable"
  | "expected"
  | "optimistic";

export interface ForecastWindow {
  start: IsoDate;
  end: IsoDate;
}

export interface ScheduledCommitment {
  expense_id: string;
  type: "weekly_draw" | "lumpy";
  amount: Cents;
  date: IsoDate;
  note: string;
}

export interface ScheduledReceipt {
  invoice_id: Invoice["id"];
  payer_id: Payer["id"];
  payer_name: Payer["name"];
  reliability: ReliabilityBucket;
  amount: Cents;
  due_date: IsoDate;
  expected_arrival_date: IsoDate;
}

export interface LedgerPosition {
  date: IsoDate;
  receipts_arrived: Cents;
  commitments_due: Cents;
  position: Cents;
}

export interface ForecastReceiptLedger {
  name: ForecastReceiptLedgerName;
  scheduled_receipts: readonly ScheduledReceipt[];
  coverage_floor: Cents;
  positions: readonly LedgerPosition[];
}

/**
 * The pure engine output intentionally stops short of a live payment action.
 * ENG-03 consumes this analysis to choose a known invoice and create the
 * structured RecommendationAction required by ForecastResult.
 */
export interface ForecastAnalysis {
  state: ForecastState;
  /**
   * Lowest expected receipts less declared commitments. It is a coverage
   * position, not a bank balance or funds-availability statement.
   */
  lowest_balance: Cents;
  cause: string;
  window: ForecastWindow;
  weekly_draw: ScheduledCommitment;
  in_window_lumpy_expenses: readonly ScheduledCommitment[];
  total_commitments: Cents;
  scheduled_commitments: readonly ScheduledCommitment[];
  ledgers: {
    reliable: ForecastReceiptLedger;
    expected: ForecastReceiptLedger;
    optimistic: ForecastReceiptLedger;
  };
  coverage_floors: ForecastCoverageFloors;
  earliest_reliable_shortfall_date: IsoDate | null;
}

interface ValidatedForecastInput {
  today: IsoDate;
  payers_by_id: ReadonlyMap<Payer["id"], Payer>;
  invoices: readonly Invoice[];
  weekly_draw: WeeklyDrawExpense;
  lumpy_expenses: readonly Extract<DeclaredExpense, { type: "lumpy" }>[];
}

function fail(message: string): never {
  throw new ForecastInputError(message);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(field + " must be a non-empty string");
  }

  return value;
}

function dateToEpoch(date: IsoDate, field: string): number {
  if (typeof date !== "string" || !ISO_CALENDAR_DATE_PATTERN.test(date)) {
    fail(field + " must be an ISO calendar date (YYYY-MM-DD)");
  }

  const [yearText, monthText, dayText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  const epoch = parsed.getTime();

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    fail(field + " must be a real ISO calendar date");
  }

  return epoch;
}

function compareDates(left: IsoDate, right: IsoDate): number {
  return dateToEpoch(left, "date") - dateToEpoch(right, "date");
}

function addCalendarDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isSafeInteger(days)) {
    fail("date offset must be an integer number of days");
  }

  const result = new Date(dateToEpoch(date, "date") + days * DAY_IN_MILLISECONDS);
  return result.toISOString().slice(0, 10);
}

function daysBetween(earlier: IsoDate, later: IsoDate): number {
  return (dateToEpoch(later, "later date") - dateToEpoch(earlier, "earlier date")) /
    DAY_IN_MILLISECONDS;
}

function assertCents(value: unknown, field: string): asserts value is Cents {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    fail(field + " must be a positive integer-cent value");
  }
}

function sumCents(values: readonly Cents[], field: string): Cents {
  const total = values.reduce((sum, amount) => sum + amount, 0);

  if (!Number.isSafeInteger(total)) {
    fail(field + " exceeds the supported integer-cent range");
  }

  return total;
}

function validatePayer(payer: Payer): void {
  requireNonEmptyString(payer.id, "payer.id");
  requireNonEmptyString(payer.name, "payer.name");

  if (payer.reliability === "no_history") {
    if (payer.avg_days_late !== null) {
      fail("no_history payer " + payer.id + " must have avg_days_late: null");
    }
    return;
  }

  if (payer.reliability === "never_late") {
    if (payer.avg_days_late !== 0) {
      fail("never_late payer " + payer.id + " must have avg_days_late: 0");
    }
    return;
  }

  if (payer.reliability === "sometimes_late") {
    if (
      typeof payer.avg_days_late !== "number" ||
      !Number.isFinite(payer.avg_days_late) ||
      payer.avg_days_late <= 0
    ) {
      fail(
        "sometimes_late payer " +
          payer.id +
          " must have a positive avg_days_late",
      );
    }
    return;
  }

  fail("payer " + payer.id + " has an unknown reliability bucket");
}

function validateInput(input: ForecastInput): ValidatedForecastInput {
  dateToEpoch(input.today, "today");

  const payersById = new Map<Payer["id"], Payer>();
  for (const payer of input.payers) {
    validatePayer(payer);
    if (payersById.has(payer.id)) {
      fail("duplicate payer id: " + payer.id);
    }
    payersById.set(payer.id, payer);
  }

  const invoiceIds = new Set<Invoice["id"]>();
  for (const invoice of input.invoices) {
    requireNonEmptyString(invoice.id, "invoice.id");
    requireNonEmptyString(invoice.payer_id, "invoice.payer_id");
    assertCents(invoice.amount, "invoice " + invoice.id + " amount");
    dateToEpoch(invoice.due_date, "invoice " + invoice.id + " due_date");

    if (invoice.status !== "paid" && invoice.status !== "unpaid") {
      fail("invoice " + invoice.id + " has an unknown status");
    }
    if (!payersById.has(invoice.payer_id)) {
      fail("invoice " + invoice.id + " references an unknown payer");
    }
    if (invoiceIds.has(invoice.id)) {
      fail("duplicate invoice id: " + invoice.id);
    }
    invoiceIds.add(invoice.id);
  }

  const expenseIds = new Set<string>();
  let weeklyDraw: WeeklyDrawExpense | undefined;
  const lumpyExpenses: Extract<DeclaredExpense, { type: "lumpy" }>[] = [];

  for (const expense of input.declared_expenses) {
    requireNonEmptyString(expense.id, "declared expense id");
    requireNonEmptyString(expense.note, "declared expense " + expense.id + " note");
    assertCents(expense.amount, "declared expense " + expense.id + " amount");

    if (expenseIds.has(expense.id)) {
      fail("duplicate declared expense id: " + expense.id);
    }
    expenseIds.add(expense.id);

    if (expense.type === "weekly_draw") {
      if (expense.due_date !== null) {
        fail("weekly draw " + expense.id + " must have due_date: null");
      }
      if (weeklyDraw) {
        fail("exactly one weekly draw is required");
      }
      weeklyDraw = expense;
      continue;
    }

    if (expense.type === "lumpy") {
      dateToEpoch(expense.due_date, "lumpy expense " + expense.id + " due_date");
      lumpyExpenses.push(expense);
      continue;
    }

    fail("declared expense has an unknown type");
  }

  if (!weeklyDraw) {
    fail("exactly one weekly draw is required");
  }

  return {
    today: input.today,
    payers_by_id: payersById,
    invoices: input.invoices,
    weekly_draw: weeklyDraw,
    lumpy_expenses: lumpyExpenses,
  };
}

function sortCommitments(
  commitments: readonly ScheduledCommitment[],
): ScheduledCommitment[] {
  return [...commitments].sort((left, right) => {
    const byDate = compareDates(left.date, right.date);
    if (byDate !== 0) return byDate;
    const byType = left.type.localeCompare(right.type);
    if (byType !== 0) return byType;
    return left.expense_id.localeCompare(right.expense_id);
  });
}

function sortReceipts(receipts: readonly ScheduledReceipt[]): ScheduledReceipt[] {
  return [...receipts].sort((left, right) => {
    const byArrival = compareDates(
      left.expected_arrival_date,
      right.expected_arrival_date,
    );
    if (byArrival !== 0) return byArrival;
    const byDueDate = compareDates(left.due_date, right.due_date);
    if (byDueDate !== 0) return byDueDate;
    const byPayer = left.payer_name.localeCompare(right.payer_name);
    if (byPayer !== 0) return byPayer;
    return left.invoice_id.localeCompare(right.invoice_id);
  });
}

function makeReceipt(
  invoice: Invoice,
  payer: Payer,
  expectedArrivalDate: IsoDate,
): ScheduledReceipt {
  return {
    invoice_id: invoice.id,
    payer_id: payer.id,
    payer_name: payer.name,
    reliability: payer.reliability,
    amount: invoice.amount,
    due_date: invoice.due_date,
    expected_arrival_date: expectedArrivalDate,
  };
}

function isWithinWindow(
  date: IsoDate,
  window: ForecastWindow,
): boolean {
  return (
    compareDates(date, window.start) >= 0 &&
    compareDates(date, window.end) <= 0
  );
}

function getLaterDate(left: IsoDate, right: IsoDate): IsoDate {
  return compareDates(left, right) >= 0 ? left : right;
}

function buildCommitments(
  weeklyDraw: WeeklyDrawExpense,
  lumpyExpenses: readonly Extract<DeclaredExpense, { type: "lumpy" }>[],
  window: ForecastWindow,
): {
  weekly_draw: ScheduledCommitment;
  lumpy_expenses: readonly ScheduledCommitment[];
  scheduled_commitments: readonly ScheduledCommitment[];
} {
  const weeklyDrawCommitment: ScheduledCommitment = {
    expense_id: weeklyDraw.id,
    type: "weekly_draw",
    amount: weeklyDraw.amount,
    date: window.end,
    note: weeklyDraw.note,
  };

  const inWindowLumpyExpenses = lumpyExpenses
    .filter((expense) => isWithinWindow(expense.due_date, window))
    .map((expense) => ({
      expense_id: expense.id,
      type: "lumpy" as const,
      amount: expense.amount,
      date: expense.due_date,
      note: expense.note,
    }));

  return {
    weekly_draw: weeklyDrawCommitment,
    lumpy_expenses: sortCommitments(inWindowLumpyExpenses),
    scheduled_commitments: sortCommitments([
      weeklyDrawCommitment,
      ...inWindowLumpyExpenses,
    ]),
  };
}

function buildReceiptLedgers(
  invoices: readonly Invoice[],
  payersById: ReadonlyMap<Payer["id"], Payer>,
  window: ForecastWindow,
): {
  reliable: readonly ScheduledReceipt[];
  expected: readonly ScheduledReceipt[];
  optimistic: readonly ScheduledReceipt[];
} {
  const reliable: ScheduledReceipt[] = [];
  const expected: ScheduledReceipt[] = [];
  const optimistic: ScheduledReceipt[] = [];

  for (const invoice of invoices) {
    if (invoice.status !== "unpaid") continue;

    const payer = payersById.get(invoice.payer_id);
    if (!payer) {
      fail("invoice " + invoice.id + " references an unknown payer");
    }

    if (compareDates(invoice.due_date, window.end) <= 0) {
      optimistic.push(
        makeReceipt(invoice, payer, getLaterDate(invoice.due_date, window.start)),
      );
    }

    if (
      payer.reliability === "never_late" &&
      isWithinWindow(invoice.due_date, window)
    ) {
      const timelyReceipt = makeReceipt(invoice, payer, invoice.due_date);
      reliable.push(timelyReceipt);
      expected.push(timelyReceipt);
      continue;
    }

    if (payer.reliability === "sometimes_late") {
      const expectedArrival = addCalendarDays(
        invoice.due_date,
        Math.ceil(payer.avg_days_late ?? 0),
      );

      if (isWithinWindow(expectedArrival, window)) {
        expected.push(makeReceipt(invoice, payer, expectedArrival));
      }
    }
  }

  return {
    reliable: sortReceipts(reliable),
    expected: sortReceipts(expected),
    optimistic: sortReceipts(optimistic),
  };
}

function buildLedger(
  name: ForecastReceiptLedgerName,
  receipts: readonly ScheduledReceipt[],
  commitments: readonly ScheduledCommitment[],
): ForecastReceiptLedger {
  const dates = [...new Set(commitments.map((commitment) => commitment.date))];
  const positions: LedgerPosition[] = [];
  let receiptIndex = 0;
  let commitmentIndex = 0;
  let receiptsArrived = 0;
  let commitmentsDue = 0;

  for (const date of dates) {
    while (
      receiptIndex < receipts.length &&
      compareDates(receipts[receiptIndex].expected_arrival_date, date) <= 0
    ) {
      receiptsArrived = sumCents(
        [receiptsArrived, receipts[receiptIndex].amount],
        "scheduled receipts",
      );
      receiptIndex += 1;
    }

    while (
      commitmentIndex < commitments.length &&
      compareDates(commitments[commitmentIndex].date, date) <= 0
    ) {
      commitmentsDue = sumCents(
        [commitmentsDue, commitments[commitmentIndex].amount],
        "scheduled commitments",
      );
      commitmentIndex += 1;
    }

    const position = receiptsArrived - commitmentsDue;
    if (!Number.isSafeInteger(position)) {
      fail("coverage position exceeds the supported integer-cent range");
    }

    positions.push({
      date,
      receipts_arrived: receiptsArrived,
      commitments_due: commitmentsDue,
      position,
    });
  }

  return {
    name,
    scheduled_receipts: receipts,
    coverage_floor:
      positions.length === 0
        ? 0
        : Math.min(...positions.map((position) => position.position)),
    positions,
  };
}

function formatAud(cents: Cents): string {
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

function buildCause(
  state: ForecastState,
  coverageFloors: ForecastCoverageFloors,
): string {
  if (coverageFloors.total_commitments === 0) {
    return "No declared commitments fall inside the next seven days.";
  }

  if (state === "shortfall") {
    return (
      "Even if every in-window unpaid invoice lands, declared commitments are " +
      formatAud(-coverageFloors.optimistic_floor) +
      " higher than those projected receipts."
    );
  }

  if (state === "tight") {
    return (
      "Declared commitments have a " +
      formatAud(-coverageFloors.reliable_floor) +
      " gap without timely never-late collections; coverage depends on late-history or no-history collections."
    );
  }

  if (state === "safe") {
    return (
      "Timely never-late collections cover the declared commitments with a " +
      formatAud(coverageFloors.reliable_floor) +
      " reliable margin."
    );
  }

  return (
    "Timely never-late collections cover the declared commitments with a " +
    formatAud(coverageFloors.reliable_floor) +
    " reliable cushion."
  );
}

/**
 * Calculate a deterministic seven-day coverage forecast using only the
 * supplied shared-contract records. This function performs no I/O and has no
 * concept of a bank account, current bank cash, or external spending data.
 */
export function calculateForecast(input: ForecastInput): ForecastAnalysis {
  const validated = validateInput(input);
  const window: ForecastWindow = {
    start: validated.today,
    end: addCalendarDays(
      validated.today,
      FORECAST_WINDOW_END_OFFSET_DAYS,
    ),
  };
  const commitments = buildCommitments(
    validated.weekly_draw,
    validated.lumpy_expenses,
    window,
  );
  const totalCommitments = sumCents(
    commitments.scheduled_commitments.map((commitment) => commitment.amount),
    "declared commitments",
  );
  const scheduledReceipts = buildReceiptLedgers(
    validated.invoices,
    validated.payers_by_id,
    window,
  );
  const reliable = buildLedger(
    "reliable",
    scheduledReceipts.reliable,
    commitments.scheduled_commitments,
  );
  const expected = buildLedger(
    "expected",
    scheduledReceipts.expected,
    commitments.scheduled_commitments,
  );
  const optimistic = buildLedger(
    "optimistic",
    scheduledReceipts.optimistic,
    commitments.scheduled_commitments,
  );
  const coverageFloors: ForecastCoverageFloors = {
    reliable_floor: reliable.coverage_floor,
    expected_floor: expected.coverage_floor,
    optimistic_floor: optimistic.coverage_floor,
    total_commitments: totalCommitments,
  };
  const state = deriveForecastState(coverageFloors);
  const earliestReliableShortfall =
    reliable.positions.find((position) => position.position < 0)?.date ?? null;

  return {
    state,
    lowest_balance: expected.coverage_floor,
    cause: buildCause(state, coverageFloors),
    window,
    weekly_draw: commitments.weekly_draw,
    in_window_lumpy_expenses: commitments.lumpy_expenses,
    total_commitments: totalCommitments,
    scheduled_commitments: commitments.scheduled_commitments,
    ledgers: {
      reliable,
      expected,
      optimistic,
    },
    coverage_floors: coverageFloors,
    earliest_reliable_shortfall_date: earliestReliableShortfall,
  };
}

export function getCalendarDayDifference(
  earlier: IsoDate,
  later: IsoDate,
): number {
  return daysBetween(earlier, later);
}
