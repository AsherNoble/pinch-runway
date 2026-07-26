import assert from "node:assert/strict";
import test from "node:test";
import { verifyBasiqWebhook } from "../lib/basiq/webhook.ts";

function base64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

async function signature(secret: string, id: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret), (character) => character.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  )));
}

test("Basiq webhook verification checks the raw payload, signature, and five-minute window", async () => {
  const rawSecret = base64(new TextEncoder().encode("test-webhook-secret"));
  const now = new Date("2026-07-26T00:00:00.000Z");
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const body = JSON.stringify({ eventTypeId: "consent.revoked" });
  const signed = await signature(rawSecret, "evt-1", timestamp, body);
  assert.equal(await verifyBasiqWebhook({
    raw_body: body,
    webhook_id: "evt-1",
    webhook_timestamp: timestamp,
    webhook_signature: `v1,${signed}`,
    secret: `whsec_${rawSecret}`,
    now,
  }), true);
  assert.equal(await verifyBasiqWebhook({
    raw_body: `${body} `,
    webhook_id: "evt-1",
    webhook_timestamp: timestamp,
    webhook_signature: `v1,${signed}`,
    secret: `whsec_${rawSecret}`,
    now,
  }), false);
  assert.equal(await verifyBasiqWebhook({
    raw_body: body,
    webhook_id: "evt-1",
    webhook_timestamp: String(Number(timestamp) - 301),
    webhook_signature: `v1,${signed}`,
    secret: `whsec_${rawSecret}`,
    now,
  }), false);
});
