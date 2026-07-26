import assert from "node:assert/strict";
import test from "node:test";

import type { TaxProfile } from "../lib/contracts.ts";
import { TaxInputError, calculateTaxSetAside, currentBasQuarter } from "../lib/tax.ts";

const PERIOD = { start: "2026-07-01", end: "2026-09-30" };

function profile(overrides: Partial<TaxProfile> = {}): TaxProfile {
  return {
    gst_registered: true,
    income_tax_rate_bp: 5000,
    ...overrides,
  };
}

test("GST-registered: derives GST from income, nets credits, sums with income tax", () => {
  const result = calculateTaxSetAside({
    period: PERIOD,
    income_received: 1100,
    expense_gst_credits: 30,
    tax_profile: profile({ income_tax_rate_bp: 5000 }),
  });

  assert.equal(result.gst_collected, 100); // 1100 / 11
  assert.equal(result.income_tax_set_aside, 500); // (1100 - 100) * 50%
  assert.equal(result.net_gst_payable, 70); // 100 - 30
  assert.equal(result.total_set_aside, 570);
  assert.deepEqual(result.period, PERIOD);
});

test("not GST-registered: no GST collected, income tax applies to the full amount", () => {
  const result = calculateTaxSetAside({
    period: PERIOD,
    income_received: 1100,
    expense_gst_credits: 30,
    tax_profile: profile({ gst_registered: false, income_tax_rate_bp: 5000 }),
  });

  assert.equal(result.gst_collected, 0);
  assert.equal(result.income_tax_set_aside, 550); // 1100 * 50%
  assert.equal(result.net_gst_payable, 0);
  assert.equal(result.total_set_aside, 550);
});

test("GST credits exceeding collected GST clamp net_gst_payable to zero, never negative", () => {
  const result = calculateTaxSetAside({
    period: PERIOD,
    income_received: 1100,
    expense_gst_credits: 1000,
    tax_profile: profile({ income_tax_rate_bp: 0 }),
  });

  assert.equal(result.gst_collected, 100);
  assert.equal(result.net_gst_payable, 0);
  assert.equal(result.income_tax_set_aside, 0);
  assert.equal(result.total_set_aside, 0);
});

test("rounds the 1/11 GST split and the income tax rate independently", () => {
  const result = calculateTaxSetAside({
    period: PERIOD,
    income_received: 1000,
    expense_gst_credits: 0,
    tax_profile: profile({ income_tax_rate_bp: 3250 }),
  });

  assert.equal(result.gst_collected, 91); // round(1000 / 11)
  assert.equal(result.income_tax_set_aside, 295); // round((1000 - 91) * 32.5%)
  assert.equal(result.total_set_aside, 386);
});

test("rejects a negative income_received", () => {
  assert.throws(
    () =>
      calculateTaxSetAside({
        period: PERIOD,
        income_received: -1,
        expense_gst_credits: 0,
        tax_profile: profile(),
      }),
    TaxInputError,
  );
});

test("rejects an out-of-range or fractional tax rate", () => {
  for (const income_tax_rate_bp of [-1, 10001, 32.5]) {
    assert.throws(
      () =>
        calculateTaxSetAside({
          period: PERIOD,
          income_received: 1000,
          expense_gst_credits: 0,
          tax_profile: profile({ income_tax_rate_bp }),
        }),
      TaxInputError,
    );
  }
});

test("currentBasQuarter maps every month to its AU BAS quarter", () => {
  assert.deepEqual(currentBasQuarter("2026-07-15"), { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(currentBasQuarter("2026-09-30"), { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(currentBasQuarter("2026-10-01"), { start: "2026-10-01", end: "2026-12-31" });
  assert.deepEqual(currentBasQuarter("2027-01-01"), { start: "2027-01-01", end: "2027-03-31" });
  assert.deepEqual(currentBasQuarter("2027-02-15"), { start: "2027-01-01", end: "2027-03-31" });
  assert.deepEqual(currentBasQuarter("2027-04-01"), { start: "2027-04-01", end: "2027-06-30" });
});

test("currentBasQuarter rejects a malformed date", () => {
  assert.throws(() => currentBasQuarter("15-07-2026"), TaxInputError);
});

test("rejects a malformed period date", () => {
  assert.throws(
    () =>
      calculateTaxSetAside({
        period: { start: "01-07-2026", end: PERIOD.end },
        income_received: 1000,
        expense_gst_credits: 0,
        tax_profile: profile(),
      }),
    TaxInputError,
  );
});
