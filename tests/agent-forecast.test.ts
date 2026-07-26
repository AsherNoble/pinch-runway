import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentForecast,
  type AgentForecastInput,
} from "../lib/agent/forecast.ts";

function baseInput(): AgentForecastInput {
  return {
    today: "2026-07-27",
    opening_cash_cents: 1_000_000,
    daily_variable_spend_cents: 10_000,
    risk_buffer_cents: 100_000,
    recurring_outflows: [],
    known_outflows: [],
    evidence_commitments: [],
    receivables: [],
  };
}

test("builds exactly 13 deterministic weekly buckets", () => {
  const result = buildAgentForecast(baseInput());

  assert.equal(result.weeks.length, 13);
  assert.deepEqual(result.window, {
    start_date: "2026-07-27",
    end_date: "2026-10-25",
    weeks: 13,
  });
  assert.equal(result.weeks[0]?.variable_spend_cents, 70_000);
  assert.equal(result.weeks[12]?.end_date, "2026-10-25");
  assert.equal(result.cash_only.closing_cents, 90_000);
  assert.equal(result.material_risk_date, "2026-10-25");
});

test("combines recurring, known, and seeded evidence outflows", () => {
  const result = buildAgentForecast({
    ...baseInput(),
    opening_cash_cents: 2_000_000,
    recurring_outflows: [
      {
        id: "rent",
        label: "Studio rent",
        amount_cents: 100_000,
        next_due_date: "2026-07-28",
        cadence_days: 14,
      },
    ],
    known_outflows: [
      {
        id: "insurance",
        label: "Insurance",
        amount_cents: 50_000,
        due_date: "2026-07-29",
        provenance: "live",
      },
    ],
    evidence_commitments: [
      {
        id: "supplier-bill",
        label: "Unexpected supplier bill",
        amount_cents: 300_000,
        due_date: "2026-07-30",
        source: "gmail",
        source_id: "gmail-42",
        provenance: "simulated",
      },
    ],
  });

  assert.equal(result.weeks[0]?.scheduled_outflows_cents, 450_000);
  assert.equal(result.weeks[2]?.scheduled_outflows_cents, 100_000);
});

test("shows cash-only and expected-receipts paths independently", () => {
  const result = buildAgentForecast({
    ...baseInput(),
    receivables: [
      {
        id: "invoice-1",
        payer_name: "Acme",
        amount_cents: 500_000,
        due_date: "2026-07-25",
        expected_date: "2026-08-03",
        status: "unpaid",
      },
    ],
  });

  assert.equal(
    result.expected_with_receivables.closing_cents -
      result.cash_only.closing_cents,
    500_000,
  );
  assert.equal(result.weeks[1]?.expected_receipts_cents, 500_000);
});

test("an unexpected bill creates material risk and ranks the best collection target", () => {
  const result = buildAgentForecast({
    ...baseInput(),
    opening_cash_cents: 500_000,
    evidence_commitments: [
      {
        id: "bill",
        label: "Equipment repair",
        amount_cents: 350_000,
        due_date: "2026-07-30",
        source: "gmail",
        source_id: "email-bill",
        provenance: "simulated",
      },
    ],
    receivables: [
      {
        id: "small-old",
        payer_name: "Old Client",
        amount_cents: 5_000,
        due_date: "2026-07-01",
        expected_date: "2026-08-10",
        status: "unpaid",
      },
      {
        id: "covers-gap",
        payer_name: "Best Client",
        amount_cents: 200_000,
        due_date: "2026-07-20",
        expected_date: "2026-08-15",
        status: "unpaid",
      },
    ],
  });

  assert.equal(result.material_risk_date, "2026-08-01");
  assert.ok(result.repair_amount_cents > 0);
  assert.equal(
    result.ranked_collection_targets[0]?.receivable_id,
    "covers-gap",
  );
  assert.equal(result.ranked_collection_targets[0]?.overdue_days, 7);
});

test("rejects duplicate IDs across financial evidence", () => {
  assert.throws(
    () =>
      buildAgentForecast({
        ...baseInput(),
        known_outflows: [
          {
            id: "same-id",
            label: "Known",
            amount_cents: 1,
            due_date: "2026-07-28",
            provenance: "live",
          },
        ],
        receivables: [
          {
            id: "same-id",
            payer_name: "Client",
            amount_cents: 1,
            due_date: "2026-07-28",
            expected_date: "2026-07-28",
            status: "unpaid",
          },
        ],
      }),
    /duplicate forecast item id/,
  );
});
