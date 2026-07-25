import type { Invoice, RunwayDataSnapshot } from "../contracts";

export interface LedgerSignals {
  /** Most recent explicit share time per invoice id (collection_actions.shared_at). */
  sharedRemindersByInvoiceId: ReadonlyMap<string, string>;
  /** Provider payment ids a verified webhook reported as dishonoured. */
  dishonouredPaymentIds: ReadonlySet<string>;
}

/**
 * A verified webhook event that represents a dishonoured payment. Kept aligned
 * with the live snapshot's status check (snapshot.ts uses `status ===
 * "dishonoured"`); the real Pinch event shape is confirmed during the live
 * rehearsal, so we also accept a dishonour-typed event.
 */
export function isDishonourEvent(status: string | null, eventType: string | null): boolean {
  return status?.toLowerCase() === "dishonoured" || (eventType?.toLowerCase().includes("dishonour") ?? false);
}

/**
 * Overlay the D1 ledgers onto a live snapshot: the owner's explicit share
 * confirmation (which drives the 48-hour stale-reminder warning) and dishonours
 * reported by a verified Pinch webhook. `contracts.ts` documents
 * `pinch_dishonoured` as normalised "from a Pinch Payment or a verified
 * webhook" — this is the webhook half. Pure, and it never widens an existing
 * dishonour back to false.
 */
export function applyLedgerSignals(
  snapshot: RunwayDataSnapshot,
  signals: LedgerSignals,
): RunwayDataSnapshot {
  if (signals.sharedRemindersByInvoiceId.size === 0 && signals.dishonouredPaymentIds.size === 0) {
    return snapshot;
  }

  const invoices: Invoice[] = snapshot.invoices.map((invoice) => {
    const sharedAt = signals.sharedRemindersByInvoiceId.get(invoice.id);
    const dishonoured =
      invoice.pinch_dishonoured === true ||
      signals.dishonouredPaymentIds.has(invoice.id) ||
      (invoice.provider_payment_id != null && signals.dishonouredPaymentIds.has(invoice.provider_payment_id));

    if (sharedAt === undefined && dishonoured === (invoice.pinch_dishonoured === true)) {
      return invoice;
    }

    return {
      ...invoice,
      ...(sharedAt === undefined ? {} : { reminder_shared_at: sharedAt }),
      pinch_dishonoured: dishonoured,
    };
  });

  return { ...snapshot, invoices };
}
