import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveGstCents,
  dollarsToCents,
  monthBounds,
  normalizeExtractedExpense,
} from "../lib/expenses.ts";

test("dollarsToCents rounds AUD strings and numbers", () => {
  assert.equal(dollarsToCents(12.34), 1234);
  assert.equal(dollarsToCents("$12.34"), 1234);
  assert.equal(dollarsToCents("1,099.00"), 109900);
  assert.equal(dollarsToCents("nope"), null);
});

test("deriveGstCents uses 1/11 of GST-inclusive total when gst missing", () => {
  assert.equal(deriveGstCents(1100, null, true), 100);
  assert.equal(deriveGstCents(1100, null, false), 0);
  assert.equal(deriveGstCents(1100, 95, true), 95);
});

test("normalizeExtractedExpense fills GST from inclusive amount", () => {
  const expense = normalizeExtractedExpense({
    date: "2026-07-01",
    description: "Coffee",
    company: "Cafe",
    amount: "11.00",
    amountIncludesGst: true,
  });
  assert.equal(expense.amountCents, 1100);
  assert.equal(expense.gstCents, 100);
  assert.equal(expense.amountIncludesGst, true);
});

test("monthBounds returns inclusive calendar month", () => {
  assert.deepEqual(monthBounds("2026-02"), {
    start: "2026-02-01",
    end: "2026-02-28",
  });
  assert.equal(monthBounds("2026-13"), null);
});
