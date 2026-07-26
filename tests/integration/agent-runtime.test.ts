import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { collectionActions } from "@/db/schema";
import {
  runProactiveDemoAgent,
  runWhatsAppAgentTurn,
} from "@/lib/agent-runtime";
import { WORKERS_AI_MODEL } from "@/lib/agent/workers-ai.server";
import type { WorkersAiBinding } from "@/lib/agent/workers-ai.server";
import {
  loadAgentCommandState,
  setAgentPermission,
} from "@/lib/agent-store";
import { resetPinchAccessTokenCacheForTests } from "@/lib/pinch/client";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function completion(input: {
  content?: string | null;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
}): unknown {
  return {
    id: "completion-integration",
    object: "chat.completion",
    created: 1,
    model: WORKERS_AI_MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: input.content ?? null,
          ...(input.toolCall
            ? {
                tool_calls: [
                  {
                    id: input.toolCall.id,
                    type: "function",
                    function: {
                      name: input.toolCall.name,
                      arguments: input.toolCall.arguments,
                    },
                  },
                ],
              }
            : {}),
        },
        finish_reason: input.toolCall ? "tool_calls" : "stop",
        logprobs: null,
      },
    ],
  };
}

function fakeAi(
  handler: (
    model: typeof WORKERS_AI_MODEL,
    input: Parameters<WorkersAiBinding["run"]>[1],
  ) => unknown | Promise<unknown>,
): WorkersAiBinding {
  return {
    async run(model, input) {
      return handler(model, input);
    },
  };
}

let twilioRequests: URLSearchParams[];
let pinchPaymentLinkRequests: number;
const originalEnvironment = {
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioFrom: process.env.TWILIO_WHATSAPP_FROM,
  twilioOwner: process.env.RUNWAY_OWNER_WHATSAPP,
};

beforeEach(() => {
  resetPinchAccessTokenCacheForTests();
  twilioRequests = [];
  pinchPaymentLinkRequests = 0;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_WHATSAPP_FROM;
  delete process.env.RUNWAY_OWNER_WHATSAPP;
  vi.stubGlobal(
    "fetch",
    async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = input instanceof URL ? input : new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();
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
        pinchPaymentLinkRequests += 1;
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
  restoreEnvironment("TWILIO_ACCOUNT_SID", originalEnvironment.twilioAccountSid);
  restoreEnvironment("TWILIO_AUTH_TOKEN", originalEnvironment.twilioAuthToken);
  restoreEnvironment("TWILIO_WHATSAPP_FROM", originalEnvironment.twilioFrom);
  restoreEnvironment("RUNWAY_OWNER_WHATSAPP", originalEnvironment.twilioOwner);
});

describe("always-on agent golden path", () => {
  it("uses the deterministic proactive path when Workers AI fails", async () => {
    const result = await runProactiveDemoAgent(
      new Date("2026-07-26T10:00:00.000Z"),
      {
        ai: fakeAi(() => {
          throw new Error("binding unavailable");
        }),
      },
    );
    const state = await loadAgentCommandState();

    expect(result.provenance).toBe("fallback");
    expect(state.latestRun).toMatchObject({
      id: result.run_id,
      status: "completed",
      provenance: "fallback",
      errorCode: "WorkersAiInferenceError",
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

  it("grounds 'What changed?' with a financial tool and deduplicates replay", async () => {
    configureTwilio();
    const requestBodies: Parameters<WorkersAiBinding["run"]>[1][] = [];
    let call = 0;
    const ai = fakeAi((model, input) => {
      expect(model).toBe(WORKERS_AI_MODEL);
      requestBodies.push(input);
      call += 1;
      if (call === 1) {
        return completion({
          toolCall: {
            id: "tool-financial-snapshot",
            name: "get_financial_snapshot",
            arguments: "{}",
          },
        });
      }
      return completion({
        content:
          "The first pressure date is 3 August. The immediate repair gap is $1,100.",
      });
    });

    const input = {
      body: "What changed?",
      providerMessageId: "SM-owner-question",
      now: new Date("2026-07-26T10:00:00.000Z"),
    };
    const result = await runWhatsAppAgentTurn(input, { ai });
    const replay = await runWhatsAppAgentTurn(input, { ai });
    const state = await loadAgentCommandState();

    expect(result).toMatchObject({
      message:
        "The first pressure date is 3 August. The immediate repair gap is $1,100.",
      duplicate: false,
    });
    expect(replay).toMatchObject({ duplicate: true, run_id: "" });
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.messages.at(-1)).toEqual({
      role: "user",
      content: "What changed?",
    });
    expect(
      requestBodies[0]?.messages.filter(
        (message) => message.content === "What changed?",
      ),
    ).toHaveLength(1);
    expect(requestBodies[0]?.parallel_tool_calls).toBe(false);
    expect(
      requestBodies[0]?.tools.some(
        (tool) => tool.function.name === "send_owner_whatsapp",
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
  });

  it("uses a grounded fallback when Workers AI quota is exhausted", async () => {
    configureTwilio();
    let inferenceCalls = 0;
    const ai = fakeAi(() => {
      inferenceCalls += 1;
      throw new Error("quota exhausted");
    });

    const result = await runWhatsAppAgentTurn(
      {
        body: "How is cash looking?",
        providerMessageId: "SM-owner-fallback",
        now: new Date("2026-07-26T10:00:00.000Z"),
      },
      { ai },
    );
    const state = await loadAgentCommandState();

    expect(inferenceCalls).toBe(1);
    expect(result.message).toContain("first material pressure date");
    expect(twilioRequests).toHaveLength(1);
    expect(state.latestRun).toMatchObject({
      status: "completed",
      provenance: "fallback",
      errorCode: "WorkersAiInferenceError",
    });
  });

  it("enforces action permissions after the model requests a tool", async () => {
    configureTwilio();
    await setAgentPermission("payment_link", "blocked");
    let call = 0;
    const ai = fakeAi(() => {
      call += 1;
      if (call === 1) {
        return completion({
          toolCall: {
            id: "tool-blocked-payment",
            name: "create_pinch_payment_link",
            arguments: '{"invoice_id":"INV-1047"}',
          },
        });
      }
      return completion({
        content: "The payment-link action is blocked by your Runway permission.",
      });
    });

    const result = await runWhatsAppAgentTurn(
      {
        body: "Create the link.",
        providerMessageId: "SM-owner-blocked-action",
        now: new Date("2026-07-26T10:00:00.000Z"),
      },
      { ai },
    );
    const state = await loadAgentCommandState();

    expect(result.message).toContain("blocked");
    expect(pinchPaymentLinkRequests).toBe(0);
    expect(state.toolCalls).toEqual([
      expect.objectContaining({
        toolName: "create_pinch_payment_link",
        actionClass: "payment_link",
        status: "failed",
        provenance: "simulated",
      }),
    ]);
  });
});

function configureTwilio(): void {
  process.env.TWILIO_ACCOUNT_SID = `AC${"a".repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = "b".repeat(32);
  process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886";
  process.env.RUNWAY_OWNER_WHATSAPP = "whatsapp:+61400000000";
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
