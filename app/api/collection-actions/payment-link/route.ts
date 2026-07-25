import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { collectionActions } from "@/db/schema";
import { PinchApiError, PinchSandboxClient } from "@/lib/pinch/client";
import { getPinchRuntimeConfig } from "@/lib/pinch/config";
import { loadPinchSnapshot } from "@/lib/pinch/snapshot";
import { buildRunwayView } from "@/lib/runway-view";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };
function sydneyDay(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
function sameOrigin(request: Request) { const origin = request.headers.get("origin"); const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host"); try { return !!origin && !!host && new URL(origin).host === host; } catch { return false; } }

export async function POST(request: Request) {
  if (!sameOrigin(request) || !(await getChatGPTUser())) return NextResponse.json({ error: "Operator sign-in is required." }, { status: 401, headers });
  const payload = await request.json().catch(() => ({})) as { invoice_id?: unknown };
  const invoiceId = typeof payload.invoice_id === "string" ? payload.invoice_id.trim() : "";
  if (!invoiceId) return NextResponse.json({ error: "invoice_id is required." }, { status: 400, headers });
  const now = new Date(); const day = sydneyDay(now);
  try {
    const snapshot = await loadPinchSnapshot(day);
    const view = buildRunwayView(snapshot, day);
    if (view.forecast.recommended_action.type !== "create_payment_link" || view.forecast.recommended_action.target_invoice_id !== invoiceId) return NextResponse.json({ error: "That invoice is no longer the current collection recommendation." }, { status: 409, headers });
    const invoice = snapshot.invoices.find((item) => item.id === invoiceId);
    if (!invoice) return NextResponse.json({ error: "Invoice is no longer available." }, { status: 404, headers });
    const db = await getDb(); const timestamp = now.toISOString();
    const row = (await db.select().from(collectionActions).where(and(eq(collectionActions.invoiceId, invoiceId), eq(collectionActions.actionDate, day))).limit(1))[0];
    if (row?.pinchLinkId) {
      const link = await new PinchSandboxClient(getPinchRuntimeConfig()).getPaymentLink(row.pinchLinkId);
      return NextResponse.json({ state: row.state, payment_link: link, reused: true }, { headers });
    }
    if (row?.state === "outcome_unknown") return NextResponse.json({ error: "The previous request outcome is unknown; it will not be retried automatically." }, { status: 409, headers });
    if (!row || row.state === "failed_known") {
      if (row) await db.update(collectionActions).set({ state: "reserving", reservedAt: timestamp, errorCode: null, errorStatus: null }).where(eq(collectionActions.id, row.id));
      else {
        try { await db.insert(collectionActions).values({ invoiceId, actionDate: day, state: "reserving", createdAt: timestamp, reservedAt: timestamp }); }
        catch { return NextResponse.json({ error: "Another request is reserving this invoice. Try again shortly." }, { status: 409, headers }); }
      }
    } else return NextResponse.json({ error: "A request is already being reserved for this invoice." }, { status: 409, headers });
    try {
      const link = await new PinchSandboxClient(getPinchRuntimeConfig()).createPaymentLink({ amount: invoice.amount, payer_id: invoice.payer_id, description: `Invoice ${invoice.id}`, return_url: new URL("/", request.url).toString(), allowed_payment_methods: ["credit-card", "bank-account"], metadata: { invoice_id: invoice.id } });
      await db.update(collectionActions).set({ state: "link_created", pinchLinkId: link.id, linkCreatedAt: new Date().toISOString() }).where(and(eq(collectionActions.invoiceId, invoiceId), eq(collectionActions.actionDate, day)));
      return NextResponse.json({ state: "link_created", payment_link: link, reused: false }, { status: 201, headers });
    } catch (error) {
      const known = error instanceof PinchApiError && error.status !== undefined;
      await db.update(collectionActions).set({ state: known ? "failed_known" : "outcome_unknown", errorCode: error instanceof Error ? error.name : "unknown", errorStatus: error instanceof PinchApiError ? error.status ?? null : null }).where(and(eq(collectionActions.invoiceId, invoiceId), eq(collectionActions.actionDate, day)));
      return NextResponse.json({ error: known ? "Pinch rejected the request; you can retry." : "Pinch request outcome is unknown; no automatic retry was made." }, { status: known ? 502 : 503, headers });
    }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Collection action is unavailable." }, { status: 503, headers }); }
}
