import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../db/schema.ts";
import { isDishonourEvent, type LedgerSignals } from "./ledger-signals.ts";

const { collectionActions, pinchWebhookEvents } = schema;

/**
 * Read the collection-action and webhook ledgers from D1. Errors surface to the
 * caller: a missing binding or table must stay a visible error, never a silent
 * "no signals" that would mask live state.
 */
export async function readLedgerSignals(
  db: DrizzleD1Database<typeof schema>,
): Promise<LedgerSignals> {
  const sharedRows = await db
    .select({ invoiceId: collectionActions.invoiceId, sharedAt: collectionActions.sharedAt })
    .from(collectionActions)
    .where(eq(collectionActions.state, "shared"));

  const sharedRemindersByInvoiceId = new Map<string, string>();
  for (const row of sharedRows) {
    if (!row.sharedAt) continue;
    const existing = sharedRemindersByInvoiceId.get(row.invoiceId);
    if (!existing || row.sharedAt > existing) {
      sharedRemindersByInvoiceId.set(row.invoiceId, row.sharedAt);
    }
  }

  const eventRows = await db
    .select({
      paymentId: pinchWebhookEvents.paymentId,
      status: pinchWebhookEvents.status,
      eventType: pinchWebhookEvents.eventType,
    })
    .from(pinchWebhookEvents);

  const dishonouredPaymentIds = new Set<string>();
  for (const row of eventRows) {
    if (row.paymentId && isDishonourEvent(row.status, row.eventType)) {
      dishonouredPaymentIds.add(row.paymentId);
    }
  }

  return { sharedRemindersByInvoiceId, dishonouredPaymentIds };
}
