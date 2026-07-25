import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { pinchWebhookEvents } from "@/db/schema";
import { POST } from "@/app/api/pinch/webhook/route";
import { readLedgerSignals } from "@/lib/pinch/ledger-store";

const SECRET = "whsec_test_secret"; // matches tests/integration/setup.ts

async function hmacHex(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function webhookRequest(body: unknown, signature?: string): Request {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== undefined) headers["pinch-signature"] = signature;
  return new Request("https://app.local/api/pinch/webhook", { method: "POST", headers, body: raw });
}

async function signedRequest(body: unknown): Promise<Request> {
  const raw = JSON.stringify(body);
  return webhookRequest(body, await hmacHex(SECRET, raw));
}

describe("POST /api/pinch/webhook", () => {
  it("rejects a request with no signature", async () => {
    const response = await POST(webhookRequest({ id: "evt-nosig" }));
    expect(response.status).toBe(401);
  });

  it("rejects a request whose signature does not match the body", async () => {
    const response = await POST(webhookRequest({ id: "evt-badsig" }, "deadbeef"));
    expect(response.status).toBe(401);
  });

  it("rejects a signed body that carries no event id", async () => {
    const response = await POST(await signedRequest({ type: "payment.updated", data: {} }));
    expect(response.status).toBe(400);
  });

  it("accepts a valid signed event once and deduplicates a replay of the same event id", async () => {
    const body = { id: "evt-1", type: "payment.settled", data: { payment: { id: "pay-1", status: "settled" } } };

    const first = await POST(await signedRequest(body));
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ accepted: true });

    const replay = await POST(await signedRequest(body));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ duplicate: true });

    // Exactly one row persisted.
    const db = await getDb();
    const rows = await db.select().from(pinchWebhookEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventId).toBe("evt-1");
  });

  it("records a dishonoured payment so the snapshot overlay flags it (A1 path)", async () => {
    const body = { id: "evt-dh", type: "payment.dishonoured", data: { payment: { id: "pay-dh", status: "dishonoured" } } };
    const response = await POST(await signedRequest(body));
    expect(response.status).toBe(202);

    const signals = await readLedgerSignals(await getDb());
    expect(signals.dishonouredPaymentIds.has("pay-dh")).toBe(true);
  });
});
