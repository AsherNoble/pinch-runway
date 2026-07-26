import type {
  Cents,
  IsoDate,
  TaxProfile,
  TaxSetAsidePeriod,
  TaxSetAsideResult,
} from "./contracts";

export class TaxInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxInputError";
  }
}

function fail(message: string): never {
  throw new TaxInputError(message);
}

function assertCents(value: unknown, field: string): asserts value is Cents {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(field + " must be a non-negative integer-cent value");
  }
}

function assertRateBp(value: unknown, field: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 10000
  ) {
    fail(field + " must be an integer number of basis points between 0 and 10000");
  }
}

const ISO_CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: unknown, field: string): void {
  if (typeof value !== "string" || !ISO_CALENDAR_DATE_PATTERN.test(value)) {
    fail(field + " must be an ISO calendar date (YYYY-MM-DD)");
  }
}

const BAS_QUARTER_START_MONTHS = [7, 10, 1, 4] as const;

/**
 * The AU BAS quarter (Jul-Sep, Oct-Dec, Jan-Mar, Apr-Jun) that `today` falls
 * inside. GST is lodged on this cadence regardless of the business's own
 * financial year.
 */
export function currentBasQuarter(today: IsoDate): TaxSetAsidePeriod {
  assertIsoDate(today, "today");
  const [yearText, monthText] = today.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  const startMonth =
    [...BAS_QUARTER_START_MONTHS]
      .sort((left, right) => right - left)
      .find((candidate) => candidate <= month) ?? BAS_QUARTER_START_MONTHS[2];
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, "0");

  return {
    start: `${year}-${pad(startMonth)}-01`,
    end: `${year}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

export interface TaxSetAsideInput {
  period: TaxSetAsidePeriod;
  /** Integer cents; sum of Pinch payments received within the period. */
  income_received: Cents;
  /** Integer cents; sum of receipt-expense GST credits within the period. */
  expense_gst_credits: Cents;
  tax_profile: TaxProfile;
}

/**
 * Estimate money already received that is earmarked for income tax and net
 * GST, using an owner-declared rate. This is a planning approximation, not a
 * lodged BAS or tax return, and it performs no I/O.
 */
export function calculateTaxSetAside(input: TaxSetAsideInput): TaxSetAsideResult {
  assertIsoDate(input.period.start, "period.start");
  assertIsoDate(input.period.end, "period.end");
  assertCents(input.income_received, "income_received");
  assertCents(input.expense_gst_credits, "expense_gst_credits");
  assertRateBp(input.tax_profile.income_tax_rate_bp, "tax_profile.income_tax_rate_bp");

  // AU GST is 1/11 of a GST-inclusive amount; Runway assumes a registered
  // owner's invoice totals are GST-inclusive, the standard AU convention.
  const gstCollected = input.tax_profile.gst_registered
    ? Math.round(input.income_received / 11)
    : 0;

  const incomeTaxBase = input.income_received - gstCollected;
  const incomeTaxSetAside = Math.round(
    (incomeTaxBase * input.tax_profile.income_tax_rate_bp) / 10000,
  );
  const netGstPayable = Math.max(0, gstCollected - input.expense_gst_credits);

  return {
    period: input.period,
    income_received: input.income_received,
    gst_collected: gstCollected,
    gst_credits: input.expense_gst_credits,
    net_gst_payable: netGstPayable,
    income_tax_set_aside: incomeTaxSetAside,
    total_set_aside: incomeTaxSetAside + netGstPayable,
  };
}
