import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { collectionActions } from "@/db/schema";
import { reservePaymentLink } from "@/app/api/collection-actions/payment-link/reserve";
import { resetPinchAccessTokenCacheForTests } from "@/lib/pinch/client";

type ActionInsert = typeof collectionActions.$inferInsert;

function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function paymentLinkReply(id: string) {
  return { id, url: `https://pay.test/${id}`, amountInCents: 100000 };
}

// Per-test behaviour for POST /payment-links (link creation). Default succeeds.
let onCreatePaymentLink: () => Response | Promise<Response>;

// Stub global fetch so the Pinch client (which defaults to global fetch) talks
// to a minimal book whose only unpaid invoice, INV1 with no payment method on
// file, is always the current create_payment_link recommendation. D1 is real.
function installFakePinch(): void {
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = input instanceof URL ? input : new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname;

    if (url.host === "auth.getpinch.com.au") return json({ access_token: "tok_test", expires_in: 3600 });
    if (method === "GET" && path === "/test/payers") return json({ data: [{ id: "P1" }] });
    if (method === "GET" && path === "/test/payers/P1") {
      return json({ id: "P1", firstName: "Test", lastName: "Payer", emailAddress: "p1@example.test" });
    }
    if (method === "GET" && path === "/test/payments/payer/P1") {
      return json({ data: [{ id: "INV1", amountInCents: 100000, status: "pending", transactionDate: sydneyToday() }] });
    }
    if (method === "POST" && path === "/test/payment-links") return onCreatePaymentLink();
    if (method === "GET" && path.startsWith("/test/payment-links/")) {
      return json(paymentLinkReply(path.slice("/test/payment-links/".length)));
    }
    throw new Error(`Unexpected fetch in test: ${method} ${url.toString()}`);
  });
}

function reserveRequest(invoiceId: string): Request {
  return new Request("https://app.local/api/collection-actions/payment-link", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.local", host: "app.local" },
    body: JSON.stringify({ invoice_id: invoiceId }),
  });
}

async function seedRow(fields: Partial<ActionInsert> & Pick<ActionInsert, "state">): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.insert(collectionActions).values({
    invoiceId: "INV1",
    actionDate: sydneyToday(),
    createdAt: now,
    reservedAt: now,
    ...fields,
  });
}

beforeEach(async () => {
  // Ensure a clean ledger per test (storage isolation is not relied upon here).
  await (await getDb()).delete(collectionActions);
  resetPinchAccessTokenCacheForTests();
  onCreatePaymentLink = () => json(paymentLinkReply("plink_default"), 201);
  installFakePinch();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reservePaymentLink", () => {
  it("requires an invoice_id", async () => {
    const response = await reservePaymentLink(
      new Request("https://app.local/x", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.local", host: "app.local" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses when the invoice is not the current recommendation", async () => {
    const response = await reservePaymentLink(reserveRequest("NOT-THE-TARGET"));
    expect(response.status).toBe(409);
  });

  it("creates a link, then reuses it on a repeat click for the same Sydney day", async () => {
    onCreatePaymentLink = () => json(paymentLinkReply("plink_new"), 201);

    const first = await reservePaymentLink(reserveRequest("INV1"));
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { reused: boolean; payment_link: { id: string } };
    expect(firstJson.reused).toBe(false);
    expect(firstJson.payment_link.id).toBe("plink_new");

    const second = await reservePaymentLink(reserveRequest("INV1"));
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as { reused: boolean; payment_link: { id: string } };
    expect(secondJson.reused).toBe(true);
    expect(secondJson.payment_link.id).toBe("plink_new");

    // Sydney-day uniqueness: one row, the link reused rather than recreated.
    const rows = await (await getDb()).select().from(collectionActions);
    expect(rows).toHaveLength(1);
  });

  it("rejects a concurrent second reservation through the unique index", async () => {
    const [a, b] = await Promise.all([
      reservePaymentLink(reserveRequest("INV1")),
      reservePaymentLink(reserveRequest("INV1")),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);

    const rows = await (await getDb()).select().from(collectionActions);
    expect(rows).toHaveLength(1);
  });

  it("marks a known provider failure as retryable (502) and allows the retry to succeed", async () => {
    let attempt = 0;
    onCreatePaymentLink = () => (attempt++ === 0 ? json({ error: "boom" }, 500) : json(paymentLinkReply("plink_retry"), 201));

    const failed = await reservePaymentLink(reserveRequest("INV1"));
    expect(failed.status).toBe(502);
    const db = await getDb();
    expect((await db.select().from(collectionActions))[0]?.state).toBe("failed_known");

    const retried = await reservePaymentLink(reserveRequest("INV1"));
    expect(retried.status).toBe(201);
    expect((await db.select().from(collectionActions))[0]?.state).toBe("link_created");
  });

  it("stores an ambiguous outcome as outcome_unknown and blocks the auto-retry", async () => {
    onCreatePaymentLink = () => {
      throw new Error("socket hang up");
    };

    const unknown = await reservePaymentLink(reserveRequest("INV1"));
    expect(unknown.status).toBe(503);
    const db = await getDb();
    expect((await db.select().from(collectionActions))[0]?.state).toBe("outcome_unknown");

    const retry = await reservePaymentLink(reserveRequest("INV1"));
    expect(retry.status).toBe(409);
  });

  it("reclaims a stale reservation lease", async () => {
    const staleAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // older than the 2-minute lease
    await seedRow({ state: "reserving", createdAt: staleAt, reservedAt: staleAt });

    const reclaimed = await reservePaymentLink(reserveRequest("INV1"));
    expect(reclaimed.status).toBe(201);
    expect((await (await getDb()).select().from(collectionActions))[0]?.state).toBe("link_created");
  });

  it("blocks a fresh in-flight reservation", async () => {
    await seedRow({ state: "reserving" });
    const blocked = await reservePaymentLink(reserveRequest("INV1"));
    expect(blocked.status).toBe(409);
  });

  // Reclaiming an existing row is a read-then-write, unlike the first click which
  // the invoice/day unique index protects. Counting creations at the provider is
  // the assertion that matters: a duplicate here is a real second payment link the
  // ledger has no record of, and the payer could be sent either one.
  for (const scenario of [
    { name: "a failed_known row", seed: () => seedRow({ state: "failed_known" }) },
    {
      name: "a stale reserving row",
      seed: () => {
        const staleAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        return seedRow({ state: "reserving", createdAt: staleAt, reservedAt: staleAt });
      },
    },
  ]) {
    it(`creates only one provider link when two clicks race to reclaim ${scenario.name}`, async () => {
      await scenario.seed();
      const created: string[] = [];
      onCreatePaymentLink = async () => {
        const id = `plink_${created.length + 1}`;
        created.push(id);
        // Provider latency is the window the two callers interleave in.
        await new Promise((resolve) => setTimeout(resolve, 25));
        return json(paymentLinkReply(id), 201);
      };

      const [a, b] = await Promise.all([
        reservePaymentLink(reserveRequest("INV1")),
        reservePaymentLink(reserveRequest("INV1")),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(created).toHaveLength(1);

      // The surviving row must point at the link that actually exists at Pinch.
      const rows = await (await getDb()).select().from(collectionActions);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.state).toBe("link_created");
      expect(rows[0]?.pinchLinkId).toBe(created[0]);
    });
  }
});
