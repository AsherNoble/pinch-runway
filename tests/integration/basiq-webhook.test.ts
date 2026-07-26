import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bankAccounts,
  bankSnapshots,
  basiqWebhookEvents,
  runwayProfiles,
} from "@/db/schema";
import { POST } from "@/app/api/basiq/webhook/route";

const RAW_SECRET = "basiq_webhook_test_secret";

async function signature(id: string, timestamp: string, raw: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(RAW_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${id}.${timestamp}.${raw}`),
    ),
  );
  return btoa(String.fromCharCode(...result));
}

async function request(body: unknown, id = "evt-basiq-1") {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request("https://app.local/api/basiq/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${await signature(id, timestamp, raw)}`,
    },
    body: raw,
  });
}

beforeEach(async () => {
  const db = await getDb();
  await db.delete(basiqWebhookEvents);
  await db.delete(bankSnapshots);
  await db.delete(bankAccounts);
  await db.delete(runwayProfiles);
  await db.insert(runwayProfiles).values({
    id: 1,
    operatorEmail: "operator@example.test",
    basiqUserId: "user-1",
    bankState: "connected",
    consentStatus: "valid",
    lastSyncedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await db.insert(bankAccounts).values({
    accountId: "account-1",
    profileId: 1,
    name: "Business account",
    accountClass: "transaction",
    cashRole: "operating_cash",
    currency: "AUD",
    balanceCents: 10_000,
    selected: true,
    syncedAt: new Date().toISOString(),
  });
  await db.insert(bankSnapshots).values({
    profileId: 1,
    createdAt: new Date().toISOString(),
    operatingCashCents: 10_000,
    liabilitiesCents: 0,
    expenseProfileJson: "{}",
  });
});

describe("POST /api/basiq/webhook", () => {
  it("accepts a signed event once and deduplicates replay by webhook id", async () => {
    const body = {
      eventTypeId: "user.updated",
      links: { eventEntity: "https://au-api.basiq.io/users/user-1" },
    };
    const first = await POST(await request(body));
    expect(first.status).toBe(202);
    const replay = await POST(await request(body));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({ duplicate: true });
    expect(await (await getDb()).select().from(basiqWebhookEvents)).toHaveLength(1);
  });

  it("purges derived bank data and disables automation on consent revocation", async () => {
    const response = await POST(await request({
      eventTypeId: "consent.revoked",
      links: { eventEntity: "https://au-api.basiq.io/users/user-1/consents/c1" },
    }, "evt-revoke"));
    expect(response.status).toBe(202);
    const db = await getDb();
    expect(await db.select().from(bankAccounts)).toEqual([]);
    expect(await db.select().from(bankSnapshots)).toEqual([]);
    const profile = (
      await db
        .select()
        .from(runwayProfiles)
        .where(eq(runwayProfiles.id, 1))
        .limit(1)
    )[0];
    expect(profile?.bankState).toBe("consent_required");
    expect(profile?.consentStatus).toBe("revoked");
    expect(profile?.lastSyncedAt).toBeNull();
  });

  it("rejects an unsigned event without changing local bank state", async () => {
    const response = await POST(new Request(
      "https://app.local/api/basiq/webhook",
      { method: "POST", body: "{}" },
    ));
    expect(response.status).toBe(401);
    expect(await (await getDb()).select().from(bankAccounts)).toHaveLength(1);
  });
});
