import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { pinchWebhookEvents } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Webhook redirects are never payment confirmation: only a verified event is recorded. */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("pinch-signature") ?? request.headers.get("x-pinch-signature");
  if (!(await validSignature(raw, signature))) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  let body: Record<string, unknown>; try { body = JSON.parse(raw) as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const eventId = text(body.id) ?? text(body.eventId); const eventType = text(body.type) ?? "unknown";
  const data = object(body.data) ?? body; const payment = object(data.payment) ?? data;
  if (!eventId) return NextResponse.json({ error: "Webhook event ID is required." }, { status: 400 });
  const db = await getDb();
  if ((await db.select().from(pinchWebhookEvents).where(eq(pinchWebhookEvents.eventId, eventId)).limit(1))[0]) return NextResponse.json({ duplicate: true }, { headers: { "cache-control": "no-store" } });
  await db.insert(pinchWebhookEvents).values({ eventId, receivedAt: new Date().toISOString(), eventType, paymentId: text(payment.id) ?? null, status: text(payment.status) ?? null });
  return NextResponse.json({ accepted: true }, { status: 202, headers: { "cache-control": "no-store" } });
}
function text(value: unknown) { return typeof value === "string" && value ? value : undefined; }
function object(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
async function validSignature(raw: string, supplied: string | null) {
  const secret = process.env.PINCH_WEBHOOK_SECRET; if (!secret || !supplied) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = Array.from(digest).map((item) => item.toString(16).padStart(2, "0")).join("");
  if (expected.length !== supplied.length) return false; let different = 0; for (let i = 0; i < expected.length; i += 1) different |= expected.charCodeAt(i) ^ supplied.charCodeAt(i); return different === 0;
}
