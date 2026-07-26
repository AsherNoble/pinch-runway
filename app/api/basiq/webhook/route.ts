import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { basiqWebhookEvents } from "@/db/schema";
import { verifyBasiqWebhook } from "@/lib/basiq/webhook";
import { purgeDerivedBankData } from "@/lib/runway-store";

export const dynamic = "force-dynamic";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  const raw = await request.text();
  const eventId = request.headers.get("webhook-id");
  const valid = await verifyBasiqWebhook({
    raw_body: raw,
    webhook_id: eventId,
    webhook_timestamp: request.headers.get("webhook-timestamp"),
    webhook_signature: request.headers.get("webhook-signature"),
    secret: process.env.BASIQ_WEBHOOK_SECRET,
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = object(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const eventType = typeof body.eventTypeId === "string"
    ? body.eventTypeId
    : typeof body.type === "string"
      ? body.type
      : "unknown";
  if (!eventId) {
    return NextResponse.json({ error: "Webhook id is required." }, { status: 400 });
  }
  const db = await getDb();
  const duplicate = (
    await db
      .select({ id: basiqWebhookEvents.eventId })
      .from(basiqWebhookEvents)
      .where(eq(basiqWebhookEvents.eventId, eventId))
      .limit(1)
  )[0];
  if (duplicate) {
    return NextResponse.json(
      { duplicate: true },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const links = object(body.links);
  await db.insert(basiqWebhookEvents).values({
    eventId,
    receivedAt: new Date().toISOString(),
    eventType,
    entityUrl:
      typeof links.eventEntity === "string" ? links.eventEntity : null,
  });
  if (["consent.revoked", "consent.expired", "consent.updated"].includes(eventType)) {
    await purgeDerivedBankData({
      bank_state: "consent_required",
      consent_status: eventType === "consent.expired" ? "expired" : "revoked",
      message: "Basiq consent is no longer valid. Bank-derived data was removed.",
    });
  } else if (eventType === "connection.deleted") {
    await purgeDerivedBankData({
      bank_state: "consent_required",
      consent_status: "required",
      message: "The Basiq connection was deleted. Bank-derived data was removed.",
    });
  }
  return NextResponse.json(
    { accepted: true },
    { status: 202, headers: { "cache-control": "no-store" } },
  );
}
