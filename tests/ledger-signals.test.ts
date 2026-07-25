import assert from "node:assert/strict";
import test from "node:test";

import type { Invoice, Payer, RunwayDataSnapshot } from "../lib/contracts.ts";
import {
  applyLedgerSignals,
  isDishonourEvent,
  type LedgerSignals,
} from "../lib/pinch/ledger-signals.ts";
import { buildRunwayView } from "../lib/runway-view.ts";

const TODAY = "2026-07-25";

function payer(
  id: string,
  name: string,
  reliability: Payer["reliability"] = "never_late",
  avgDaysLate: number | null = 0,
): Payer {
  return { id, name, reliability, avg_days_late: avgDaysLate };
}

function invoice(
  id: string,
  payerId: string,
  amount: number,
  dueDate: string,
  extra: Partial<Invoice> = {},
): Invoice {
  return { id, payer_id: payerId, amount, due_date: dueDate, status: "unpaid", ...extra };
}

function snapshot(
  payers: readonly Payer[],
  invoices: readonly Invoice[],
): RunwayDataSnapshot {
  return {
    data_source: {
      source: "pinch_sandbox",
      connection_state: "connected",
      is_live: true,
      display_label: "Live Pinch sandbox data",
      last_synced_at: TODAY + "T00:00:00.000Z",
    },
    payers,
    invoices,
    payment_history: [],
    declared_expenses: [
      { id: "weekly-draw", type: "weekly_draw", amount: 50_000, due_date: null, note: "Weekly living draw" },
    ],
  };
}

function signals(partial: Partial<LedgerSignals> = {}): LedgerSignals {
  return {
    sharedRemindersByInvoiceId: partial.sharedRemindersByInvoiceId ?? new Map(),
    dishonouredPaymentIds: partial.dishonouredPaymentIds ?? new Set(),
  };
}

test("applyLedgerSignals overlays shared reminders and webhook dishonours", () => {
  const base = snapshot(
    [payer("p1", "Payer One")],
    [
      invoice("inv-1", "p1", 100_000, "2026-07-27", { provider_payment_id: "inv-1" }),
      invoice("inv-2", "p1", 50_000, "2026-07-28", { provider_payment_id: "inv-2" }),
    ],
  );

  const result = applyLedgerSignals(
    base,
    signals({
      sharedRemindersByInvoiceId: new Map([["inv-1", "2026-07-24T09:00:00.000Z"]]),
      dishonouredPaymentIds: new Set(["inv-2"]),
    }),
  );

  const one = result.invoices.find((item) => item.id === "inv-1");
  const two = result.invoices.find((item) => item.id === "inv-2");
  assert.equal(one?.reminder_shared_at, "2026-07-24T09:00:00.000Z");
  assert.notEqual(one?.pinch_dishonoured, true);
  assert.equal(two?.pinch_dishonoured, true);
  assert.equal(two?.reminder_shared_at, undefined);
});

test("applyLedgerSignals matches a dishonour by provider_payment_id and never widens an existing dishonour to false", () => {
  const base = snapshot(
    [payer("p1", "Payer One")],
    [
      invoice("inv-3", "p1", 30_000, "2026-07-27", { provider_payment_id: "pay-3" }),
      invoice("inv-4", "p1", 30_000, "2026-07-27", { provider_payment_id: "pay-4", pinch_dishonoured: true }),
    ],
  );

  const result = applyLedgerSignals(base, signals({ dishonouredPaymentIds: new Set(["pay-3"]) }));

  assert.equal(result.invoices.find((item) => item.id === "inv-3")?.pinch_dishonoured, true);
  // inv-4 has no matching webhook signal but was already dishonoured; it stays dishonoured.
  assert.equal(result.invoices.find((item) => item.id === "inv-4")?.pinch_dishonoured, true);
});

test("applyLedgerSignals returns the same snapshot when there are no signals", () => {
  const base = snapshot([payer("p1", "Payer One")], [invoice("inv-1", "p1", 100_000, "2026-07-27")]);
  assert.equal(applyLedgerSignals(base, signals()), base);
});

test("isDishonourEvent recognises a dishonour status or a dishonour event type", () => {
  assert.equal(isDishonourEvent("dishonoured", null), true);
  assert.equal(isDishonourEvent("Dishonoured", "payment.updated"), true);
  assert.equal(isDishonourEvent(null, "payment.dishonoured"), true);
  assert.equal(isDishonourEvent("settled", "payment.settled"), false);
  assert.equal(isDishonourEvent(null, null), false);
});

test("a verified webhook dishonour turns a covered invoice into a flagged collection target", () => {
  const base = snapshot(
    [payer("p1", "Reliable Payer")],
    [invoice("inv-1", "p1", 100_000, "2026-07-27", { payment_method_on_file: true, provider_payment_id: "inv-1" })],
  );

  const before = buildRunwayView(base, TODAY);
  assert.equal(before.forecast.recommended_action.type, "wait");
  assert.ok(before.analysis.ledgers.reliable.scheduled_receipts.some((receipt) => receipt.invoice_id === "inv-1"));

  const after = buildRunwayView(
    applyLedgerSignals(base, signals({ dishonouredPaymentIds: new Set(["inv-1"]) })),
    TODAY,
  );

  assert.equal(after.forecast.recommended_action.type, "create_payment_link");
  assert.equal(after.forecast.recommended_action.target_invoice_id, "inv-1");
  assert.match(after.forecast.recommended_action.rationale, /recorded Pinch dishonour/);
  // A dishonoured invoice must no longer count as planned/reliable coverage.
  assert.equal(after.analysis.ledgers.reliable.scheduled_receipts.length, 0);
});

test("a shared reminder older than 48 hours leaves the reliable ledger and is flagged; a fresh one does not", () => {
  const base = snapshot(
    [payer("p1", "Reliable Payer")],
    [invoice("inv-1", "p1", 100_000, "2026-07-27", { payment_method_on_file: true, provider_payment_id: "inv-1" })],
  );

  // Shared three days ago (>= 48h): stale -> drops out of reliable coverage and is flagged.
  const staleView = buildRunwayView(
    applyLedgerSignals(base, signals({ sharedRemindersByInvoiceId: new Map([["inv-1", "2026-07-22T09:00:00.000Z"]]) })),
    TODAY,
  );
  assert.equal(staleView.forecast.recommended_action.type, "create_payment_link");
  assert.equal(staleView.forecast.recommended_action.target_invoice_id, "inv-1");
  assert.match(staleView.forecast.recommended_action.rationale, /shared reminder still unpaid after 48 hours/);
  assert.equal(staleView.analysis.ledgers.reliable.scheduled_receipts.length, 0);

  // Shared today (< 48h): not stale -> stays in reliable coverage, still a wait.
  const freshView = buildRunwayView(
    applyLedgerSignals(base, signals({ sharedRemindersByInvoiceId: new Map([["inv-1", TODAY + "T09:00:00.000Z"]]) })),
    TODAY,
  );
  assert.equal(freshView.forecast.recommended_action.type, "wait");
  assert.ok(freshView.analysis.ledgers.reliable.scheduled_receipts.some((receipt) => receipt.invoice_id === "inv-1"));
});
