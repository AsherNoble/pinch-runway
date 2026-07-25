import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { collectionActions } from "@/db/schema";
export const dynamic = "force-dynamic";
function day() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getChatGPTUser())) return NextResponse.json({ error: "Operator sign-in is required." }, { status: 401 });
  const { id } = await params; const db = await getDb(); const date = day();
  const row = (await db.select().from(collectionActions).where(and(eq(collectionActions.invoiceId, id), eq(collectionActions.actionDate, date))).limit(1))[0];
  if (!row?.pinchLinkId) return NextResponse.json({ error: "No created payment link exists for this invoice today." }, { status: 409 });
  const sharedAt = new Date().toISOString(); await db.update(collectionActions).set({ state: "shared", sharedAt }).where(eq(collectionActions.id, row.id));
  return NextResponse.json({ state: "shared", shared_at: sharedAt }, { headers: { "cache-control": "no-store" } });
}
