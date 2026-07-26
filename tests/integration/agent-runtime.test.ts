import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { collectionActions } from "@/db/schema";
import {
  runProactiveDemoAgent,
  runWhatsAppAgentTurn,
} from "@/lib/agent-runtime";
import { loadAgentCommandState } from "@/lib/agent-store";
import { resetPinchAccessTokenCacheForTests } from "@/lib/pinch/client";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let anthropicHandler:
  | ((input: unknown, init?: RequestInit) => Response | Promise<Response>)
  | null;
let twilioRequests: URLSearchParams[];
const originalEnvironment = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicModel: process.env.ANTHROPIC_MODEL,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioFrom: process.env.TWILIO_WHATSAPP_FROM,
  twilioOwner: process.env.RUNWAY_OWNER_WHATSAPP,
};

beforeEach(() => {
  resetPinchAccessTokenCacheForTests();
  anthropicHandler = null;
  twilioRequests = [];
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_WHATSAPP_FROM;
  delete process.env.RUNWAY_OWNER_WHATSAPP;
  vi.stubGlobal(
    "fetch",
    async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = input instanceof URL ? input : new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.host === "api.anthropic.com" && anthropicHandler) {
        return anthropicHandler(input, init);
      }
      if (
        url.host === "api.twilio.com" &&
        method === "POST" &&
        url.pathname.endsWith("/Messages.json")
      ) {
        const requestBody = new URLSearchParams(String(init?.body ?? ""));
        twilioRequests.push(requestBody);
        return json({
          sid: "SM-agent-whatsapp-reply",
          status: "queued",
          to: requestBody.get("To"),
          from: requestBody.get("From"),
        });
      }
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
  restoreEnvironment("ANTHROPIC_API_KEY", originalEnvironment.anthropicApiKey);
  restoreEnvironment("ANTHROPIC_MODEL", originalEnvironment.anthropicModel);
  restoreEnvironment("TWILIO_ACCOUNT_SID", originalEnvironment.twilioAccountSid);
  restoreEnvironment("TWILIO_AUTH_TOKEN", originalEnvironment.twilioAuthToken);
  restoreEnvironment("TWILIO_WHATSAPP_FROM", originalEnvironment.twilioFrom);
  restoreEnvironment("RUNWAY_OWNER_WHATSAPP", originalEnvironment.twilioOwner);
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

  it("uses Claude tools for a live WhatsApp turn without duplicating the inbound message", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ANTHROPIC_MODEL = "claude-sonnet-5";
    process.env.TWILIO_ACCOUNT_SID = `AC${"a".repeat(32)}`;
    process.env.TWILIO_AUTH_TOKEN = "b".repeat(32);
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886";
    process.env.RUNWAY_OWNER_WHATSAPP = "whatsapp:+61400000000";

    const requestBodies: Record<string, unknown>[] = [];
    let call = 0;
    anthropicHandler = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      call += 1;
      if (call === 1) {
        return json({
          content: [
            {
              type: "tool_use",
              id: "tool-financial-snapshot",
              name: "get_financial_snapshot",
              input: {},
            },
          ],
          stop_reason: "tool_use",
        });
      }
      return json({
        content: [
          {
            type: "text",
            text: "The first pressure date is 3 August. The immediate repair gap is $1,100.",
          },
        ],
        stop_reason: "end_turn",
      });
    };

    const result = await runWhatsAppAgentTurn({
      body: "What changed?",
      providerMessageId: "SM-owner-question",
      now: new Date("2026-07-26T10:00:00.000Z"),
    });
    const state = await loadAgentCommandState();

    expect(result).toMatchObject({
      message:
        "The first pressure date is 3 August. The immediate repair gap is $1,100.",
      duplicate: false,
    });
    expect(requestBodies[0]?.model).toBe("claude-sonnet-5");
    const firstMessages = requestBodies[0]?.messages as {
      role: string;
      content: string;
    }[];
    expect(firstMessages.at(-1)).toEqual({
      role: "user",
      content: "What changed?",
    });
    expect(
      firstMessages.filter((message) => message.content === "What changed?"),
    ).toHaveLength(1);
    expect(
      (requestBodies[0]?.tools as { name: string }[]).some(
        (tool) => tool.name === "send_owner_whatsapp",
      ),
    ).toBe(false);
    expect(state.latestRun).toMatchObject({
      id: result.run_id,
      status: "completed",
      provenance: "live",
      errorCode: null,
    });
    expect(state.toolCalls).toEqual([
      expect.objectContaining({
        toolName: "get_financial_snapshot",
        status: "succeeded",
      }),
    ]);
    expect(twilioRequests).toHaveLength(1);
    expect(twilioRequests[0]?.get("Body")).toBe(result.message);
    expect(
      state.messages.find(
        (message) => message.providerMessageId === "SM-agent-whatsapp-reply",
      ),
    ).toMatchObject({
      direction: "outbound",
      body: result.message,
    });
  });

  it("falls back safely when Claude is unavailable and still replies on WhatsApp", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ANTHROPIC_MODEL = "claude-sonnet-5";
    process.env.TWILIO_ACCOUNT_SID = `AC${"a".repeat(32)}`;
    process.env.TWILIO_AUTH_TOKEN = "b".repeat(32);
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886";
    process.env.RUNWAY_OWNER_WHATSAPP = "whatsapp:+61400000000";
    anthropicHandler = async () => json({ error: "rate limited" }, 429);

    const result = await runWhatsAppAgentTurn({
      body: "How is cash looking?",
      providerMessageId: "SM-owner-fallback",
      now: new Date("2026-07-26T10:00:00.000Z"),
    });
    const state = await loadAgentCommandState();

    expect(result.message).toContain("first material pressure date");
    expect(twilioRequests).toHaveLength(1);
    expect(state.latestRun).toMatchObject({
      status: "completed",
      provenance: "fallback",
      errorCode: "AnthropicMessagesError",
    });
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
