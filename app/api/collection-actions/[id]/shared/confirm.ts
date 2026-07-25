import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { collectionActions } from "@/db/schema";

function day() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

/**
 * Record the owner's explicit "I've shared it" confirmation for today's link,
 * minus the operator auth guard. Extracted so the integration suite can drive
 * it against a real D1 binding without a ChatGPT request context.
 */
export async function confirmShared(id: string): Promise<Response> {
  const db = await getDb(); const date = day();
  const row = (await db.select().from(collectionActions).where(and(eq(collectionActions.invoiceId, id), eq(collectionActions.actionDate, date))).limit(1))[0];
  if (!row?.pinchLinkId) return NextResponse.json({ error: "No created payment link exists for this invoice today." }, { status: 409 });
  const sharedAt = new Date().toISOString(); await db.update(collectionActions).set({ state: "shared", sharedAt }).where(eq(collectionActions.id, row.id));
  return NextResponse.json({ state: "shared", shared_at: sharedAt }, { headers: { "cache-control": "no-store" } });
}
