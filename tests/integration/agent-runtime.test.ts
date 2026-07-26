import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { collectionActions } from "@/db/schema";
import { runProactiveDemoAgent } from "@/lib/agent-runtime";
import { loadAgentCommandState } from "@/lib/agent-store";
import { resetPinchAccessTokenCacheForTests } from "@/lib/pinch/client";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  resetPinchAccessTokenCacheForTests();
  vi.stubGlobal(
    "fetch",
    async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = input instanceof URL ? input : new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.host === "auth.getpinch.com.au") {
        return json({ access_token: "agent_test_token", expires_in: 3_600 });
      }
      if (method === "GET" && url.pathname === "/test/payers") {
        return json({ data: [{ id: "payer-agent-demo" }] });
      }
      if (method === "POST" && url.pathname === "/test/payment-links") {
        return json(
          {
            id: "plink-agent-demo",
            url: "https://pay.example.test/plink-agent-demo",
            amountInCents: 940_000,
            payerId: "payer-agent-demo",
            status: "active",
          },
          201,
        );
      }
      throw new Error(
        `Unexpected agent integration fetch: ${method} ${url.toString()}`,
      );
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetPinchAccessTokenCacheForTests();
});

describe("always-on agent golden path", () => {
  it("forecasts risk, creates a real sandbox link, records simulated email, and audits WhatsApp fallback", async () => {
    const result = await runProactiveDemoAgent(
      new Date("2026-07-26T10:00:00.000Z"),
    );
    const state = await loadAgentCommandState();

    expect(result.provenance).toBe("fallback");
    expect(state.latestRun).toMatchObject({
      id: result.run_id,
      status: "completed",
    });
    expect(state.latestRun?.forecast).toMatchObject({
      material_risk_date: expect.any(String),
      ranked_collection_targets: [
        expect.objectContaining({ receivable_id: "INV-1047" }),
      ],
    });
    expect(state.toolCalls.map((call) => [call.toolName, call.status])).toEqual([
      ["get_financial_snapshot", "succeeded"],
      ["search_business_context", "succeeded"],
      ["create_pinch_payment_link", "succeeded"],
      ["send_client_email", "succeeded"],
    ]);
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0]).toMatchObject({
      runId: result.run_id,
      status: "sent",
      recipient: "jordan@northstar-pilates.example",
    });
    expect(state.messages.some((message) => message.channel === "whatsapp")).toBe(
      true,
    );
    expect(await (await getDb()).select().from(collectionActions)).toEqual([
      expect.objectContaining({
        invoiceId: "INV-1047",
        state: "link_created",
        pinchLinkId: "plink-agent-demo",
      }),
    ]);
  });
});
