import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { collectionActions } from "@/db/schema";
import {
  ApprovalNotPendingError,
  executeApprovedAction,
  runProactiveDemoAgent,
  runWhatsAppAgentTurn,
} from "@/lib/agent-runtime";
import { WORKERS_AI_MODEL } from "@/lib/agent/workers-ai.server";
import type { WorkersAiBinding } from "@/lib/agent/workers-ai.server";
import {
  denyAgentApproval,
  loadAgentCommandState,
  loadSimulatedCalendarEdits,
  resetDemoAgent,
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

// The "Ask me" permission mode is only meaningful if the parked action can
// later be approved and actually run. These cover both halves of that loop, and
// the two action classes (calendar_edit, receipt_request) that previously had
// no tool mapped to them and so were unenforceable.
describe("ask-me approval queue", () => {
  // These assertions read tables globally (the approval queue and the calendar
  // overlay are not scoped to one run), so they need a known-empty starting
  // point. The pool's `isolatedStorage` flag does not provide one: it is not a
  // recognised option in @cloudflare/vitest-pool-workers 0.18.8's
  // `cloudflareTest` schema and is silently dropped, so D1 writes persist
  // across tests in a file. Reset explicitly instead of depending on it.
  beforeEach(async () => {
    await resetDemoAgent();
  });

  async function proposeWith(input: {
    body: string;
    providerMessageId: string;
    toolName: string;
    args: string;
  }) {
    let call = 0;
    const ai = fakeAi(() => {
      call += 1;
      if (call === 1) {
        return completion({
          toolCall: {
            id: `tool-${input.toolName}`,
            name: input.toolName,
            arguments: input.args,
          },
        });
      }
      return completion({ content: "I have queued that for your approval." });
    });
    return runWhatsAppAgentTurn(
      {
        body: input.body,
        providerMessageId: input.providerMessageId,
        now: new Date("2026-07-26T10:00:00.000Z"),
      },
      { ai },
    );
  }

  it("parks a receipt request instead of sending it, then sends it on approval", async () => {
    configureTwilio();
    await setAgentPermission("receipt_request", "ask");

    await proposeWith({
      body: "Chase the receipt for FL-8821.",
      providerMessageId: "SM-owner-receipt-ask",
      toolName: "request_receipt",
      args: '{"document_reference":"FL-8821"}',
    });
    const parked = await loadAgentCommandState();

    // Nothing may have happened yet: no outbox record, one pending approval.
    expect(parked.outbox).toHaveLength(0);
    expect(parked.approvals).toHaveLength(1);
    expect(parked.approvals[0]).toMatchObject({
      actionClass: "receipt_request",
      toolName: "request_receipt",
      status: "pending",
    });
    expect(parked.approvals[0]?.summary).toContain("Frame & Light Rentals");
    expect(parked.toolCalls).toEqual([
      expect.objectContaining({
        toolName: "request_receipt",
        status: "awaiting_approval",
      }),
    ]);

    const outcome = await executeApprovedAction(
      parked.approvals[0]!.id,
      new Date("2026-07-26T11:00:00.000Z"),
    );
    const approved = await loadAgentCommandState();

    expect(outcome.status).toBe("executed");
    expect(approved.approvals).toHaveLength(0);
    expect(approved.outbox).toHaveLength(1);
    expect(approved.outbox[0]).toMatchObject({
      recipient: "accounts@frame-light.example",
      subject: "Receipt request — FL-8821",
      status: "sent",
    });
    // The original audit row is settled in place rather than duplicated.
    expect(approved.toolCalls).toEqual([
      expect.objectContaining({
        toolName: "request_receipt",
        status: "succeeded",
        provenance: "simulated",
      }),
    ]);
  });

  it("does not run the action twice when approval is repeated", async () => {
    configureTwilio();
    await setAgentPermission("receipt_request", "ask");
    await proposeWith({
      body: "Chase the receipt for FL-8821.",
      providerMessageId: "SM-owner-receipt-double",
      toolName: "request_receipt",
      args: '{"document_reference":"FL-8821"}',
    });
    const [approval] = (await loadAgentCommandState()).approvals;

    await executeApprovedAction(approval!.id);
    await expect(executeApprovedAction(approval!.id)).rejects.toBeInstanceOf(
      ApprovalNotPendingError,
    );

    expect((await loadAgentCommandState()).outbox).toHaveLength(1);
  });

  it("denying leaves the side effect unrun and the queue empty", async () => {
    configureTwilio();
    await setAgentPermission("receipt_request", "ask");
    await proposeWith({
      body: "Chase the receipt for FL-8821.",
      providerMessageId: "SM-owner-receipt-deny",
      toolName: "request_receipt",
      args: '{"document_reference":"FL-8821"}',
    });
    const [approval] = (await loadAgentCommandState()).approvals;

    expect(await denyAgentApproval(approval!.id)).toMatchObject({
      status: "denied",
    });
    // A second decision on the same action is a no-op, not a rewrite.
    expect(await denyAgentApproval(approval!.id)).toBeNull();

    const state = await loadAgentCommandState();
    expect(state.outbox).toHaveLength(0);
    expect(state.approvals).toHaveLength(0);
  });

  it("parks a calendar edit and applies it to the seeded calendar on approval", async () => {
    configureTwilio();
    await setAgentPermission("calendar_edit", "ask");

    await proposeWith({
      body: "Move the Frame & Light return a day earlier.",
      providerMessageId: "SM-owner-calendar-ask",
      toolName: "update_calendar_event",
      args: '{"event_id":"calendar-frame-light-return","start_date_time":"2026-07-19T09:00:00+10:00"}',
    });
    const [approval] = (await loadAgentCommandState()).approvals;

    expect(approval).toMatchObject({ actionClass: "calendar_edit" });
    expect(await loadSimulatedCalendarEdits()).toHaveLength(0);

    const outcome = await executeApprovedAction(approval!.id);

    expect(outcome.status).toBe("executed");
    expect(await loadSimulatedCalendarEdits()).toEqual([
      expect.objectContaining({
        event_id: "calendar-frame-light-return",
        start_date_time: "2026-07-19T09:00:00+10:00",
      }),
    ]);
  });
});

describe("calendar and receipt action classes", () => {
  // See the note in "ask-me approval queue": storage is not isolated per test.
  beforeEach(async () => {
    await resetDemoAgent();
  });

  it("blocks a calendar edit when the owner blocked that action class", async () => {
    configureTwilio();
    await setAgentPermission("calendar_edit", "blocked");
    let call = 0;
    const ai = fakeAi(() => {
      call += 1;
      if (call === 1) {
        return completion({
          toolCall: {
            id: "tool-blocked-calendar",
            name: "update_calendar_event",
            arguments:
              '{"event_id":"calendar-frame-light-return","note":"Should never land"}',
          },
        });
      }
      return completion({ content: "Calendar edits are blocked." });
    });

    await runWhatsAppAgentTurn(
      {
        body: "Reschedule the kit return.",
        providerMessageId: "SM-owner-calendar-blocked",
        now: new Date("2026-07-26T10:00:00.000Z"),
      },
      { ai },
    );
    const state = await loadAgentCommandState();

    expect(await loadSimulatedCalendarEdits()).toHaveLength(0);
    expect(state.approvals).toHaveLength(0);
    expect(state.toolCalls).toEqual([
      expect.objectContaining({
        toolName: "update_calendar_event",
        actionClass: "calendar_edit",
        status: "failed",
      }),
    ]);
  });

  it("runs a calendar edit under auto and reflects it in the next context read", async () => {
    configureTwilio();
    await setAgentPermission("calendar_edit", "auto");
    let call = 0;
    const ai = fakeAi(() => {
      call += 1;
      if (call === 1) {
        return completion({
          toolCall: {
            id: "tool-auto-calendar",
            name: "update_calendar_event",
            arguments:
              '{"event_id":"calendar-frame-light-return","start_date_time":"2026-07-21T09:00:00+10:00"}',
          },
        });
      }
      if (call === 2) {
        return completion({
          toolCall: {
            id: "tool-auto-context",
            name: "search_business_context",
            arguments: '{"query":"calendar"}',
          },
        });
      }
      return completion({ content: "Moved the return and confirmed it." });
    });

    await runWhatsAppAgentTurn(
      {
        body: "Move the kit return to the 21st.",
        providerMessageId: "SM-owner-calendar-auto",
        now: new Date("2026-07-26T10:00:00.000Z"),
      },
      { ai },
    );
    const state = await loadAgentCommandState();

    expect(state.toolCalls.map((toolCall) => toolCall.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(state.calendarEdits).toEqual([
      expect.objectContaining({
        event_id: "calendar-frame-light-return",
        start_date_time: "2026-07-21T09:00:00+10:00",
      }),
    ]);
  });

  it("refuses a calendar event id that is not in the seeded fixture", async () => {
    configureTwilio();
    await setAgentPermission("calendar_edit", "auto");
    let call = 0;
    const ai = fakeAi(() => {
      call += 1;
      if (call === 1) {
        return completion({
          toolCall: {
            id: "tool-unknown-calendar",
            name: "update_calendar_event",
            arguments: '{"event_id":"calendar-does-not-exist","note":"nope"}',
          },
        });
      }
      return completion({ content: "That event does not exist." });
    });

    await runWhatsAppAgentTurn(
      {
        body: "Move the launch party.",
        providerMessageId: "SM-owner-calendar-unknown",
        now: new Date("2026-07-26T10:00:00.000Z"),
      },
      { ai },
    );

    expect(await loadSimulatedCalendarEdits()).toHaveLength(0);
    expect((await loadAgentCommandState()).toolCalls).toEqual([
      expect.objectContaining({
        toolName: "update_calendar_event",
        status: "failed",
      }),
    ]);
  });

  it("blocks a receipt request when the owner blocked that action class", async () => {
    configureTwilio();
    await setAgentPermission("receipt_request", "blocked");
    let call = 0;
    const ai = fakeAi(() => {
      call += 1;
      if (call === 1) {
        return completion({
          toolCall: {
            id: "tool-blocked-receipt",
            name: "request_receipt",
            arguments: '{"document_reference":"FL-8821"}',
          },
        });
      }
      return completion({ content: "Receipt requests are blocked." });
    });

    await runWhatsAppAgentTurn(
      {
        body: "Ask for the receipt.",
        providerMessageId: "SM-owner-receipt-blocked",
        now: new Date("2026-07-26T10:00:00.000Z"),
      },
      { ai },
    );
    const state = await loadAgentCommandState();

    expect(state.outbox).toHaveLength(0);
    expect(state.approvals).toHaveLength(0);
    expect(state.toolCalls).toEqual([
      expect.objectContaining({
        toolName: "request_receipt",
        actionClass: "receipt_request",
        status: "failed",
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
