import type { Invoice, Payer, RunwayDataSnapshot } from "../contracts";
import { PinchSandboxClient } from "./client";
import { getPinchRuntimeConfig } from "./config";

type RecordValue = Record<string, unknown>;

function string(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) ? value : undefined; }
function hasMethod(payer: RecordValue): boolean {
  const sources = payer.sources ?? payer.paymentSources;
  const agreements = payer.agreements ?? payer.mandates;
  return (Array.isArray(sources) && sources.length > 0) || (Array.isArray(agreements) && agreements.length > 0);
}

/** Normalises actual Pinch Payer and Payment records; it never fabricates a live snapshot. */
export async function loadPinchSnapshot(today: string): Promise<RunwayDataSnapshot> {
  const client = new PinchSandboxClient(getPinchRuntimeConfig());
  const rawPayers = await client.listPayers({ page: 1, page_size: 100 });
  const detailed = await Promise.all(rawPayers.map(async (item) => {
    const id = string(item.id);
    return id ? client.getPayer(id) : item;
  }));
  const payers: Payer[] = detailed.flatMap((item) => {
    const id = string(item.id); if (!id) return [];
    const name = [string(item.firstName), string(item.lastName)].filter(Boolean).join(" ") || string(item.emailAddress) || id;
    return [{ id, name, reliability: "no_history", avg_days_late: null }];
  });
  const payerDetails = new Map(detailed.map((item) => [string(item.id), item]));
  const invoices: Invoice[] = [];
  for (const payer of payers) {
    const payments = await client.listPaymentsForPayer(payer.id, { page: 1, page_size: 100 });
    for (const payment of payments) {
      const id = string(payment.id); const amount = number(payment.amountInCents) ?? number(payment.amount);
      const due = string(payment.transactionDate) ?? today; const status = string(payment.status)?.toLowerCase() ?? "";
      if (!id || !amount) continue;
      invoices.push({ id, payer_id: payer.id, amount, due_date: due.slice(0, 10), status: /paid|settled|completed/.test(status) ? "paid" : "unpaid", provider_payment_id: id, payment_method_on_file: hasMethod(payerDetails.get(payer.id) ?? {}), pinch_dishonoured: status === "dishonoured" });
    }
  }
  return { data_source: { source: "pinch_sandbox", connection_state: "connected", is_live: true, display_label: "Live Pinch sandbox data", last_synced_at: new Date().toISOString() }, payers, invoices, payment_history: [], declared_expenses: [{ id: "weekly-draw", type: "weekly_draw", amount: 1, due_date: null, note: "Configure your weekly draw" }] };
}
