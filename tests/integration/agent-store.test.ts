import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import {
  agentMessages,
  agentRuns,
  agentToolCalls,
  simulatedOutbox,
} from "@/db/schema";
import { sendSimulatedGmailMessage } from "@/lib/agent-integrations/google-seeded";
import {
  beginAgentRun,
  completeAgentRun,
  d1SimulatedGmailOutboxStore,
  loadAgentCommandState,
  loadAgentPermissions,
  recordAgentMessage,
  recordAgentToolCall,
  resetDemoAgent,
  setAgentPermission,
  setDemoAgentState,
} from "@/lib/agent-store";

describe("always-on agent persistence", () => {
  it("loads safe defaults and persists a permission change", async () => {
    expect(await loadAgentPermissions()).toEqual({
      collection_email: "auto",
      payment_link: "auto",
      calendar_edit: "blocked",
      receipt_request: "ask",
    });

    await setAgentPermission("receipt_request", "auto");

    expect((await loadAgentPermissions()).receipt_request).toBe("auto");
  });

  it("stores a run, audited tool result, and parsed forecast", async () => {
    await beginAgentRun({
      id: "run-agent-store",
      triggerType: "demo_event",
      provenance: "simulated",
    });
    await recordAgentToolCall({
      id: "call-agent-store",
      runId: "run-agent-store",
      toolName: "get_financial_snapshot",
      status: "succeeded",
      provenance: "fallback",
      toolInput: {},
      result: { material_risk: true },
    });
    await completeAgentRun({
      id: "run-agent-store",
      status: "completed",
      summary: "Collection playbook complete.",
      forecast: { low_cents: 640_000 },
    });

    const state = await loadAgentCommandState();
    expect(state.latestRun).toMatchObject({
      id: "run-agent-store",
      status: "completed",
      summary: "Collection playbook complete.",
      forecast: { low_cents: 640_000 },
    });
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0]).toMatchObject({
      id: "call-agent-store",
      status: "succeeded",
      input: {},
      result: { material_risk: true },
    });
  });

  it("deduplicates provider messages and simulated Gmail sends", async () => {
    expect(
      await recordAgentMessage({
        channel: "whatsapp",
        direction: "inbound",
        providerMessageId: "SM-agent-store",
        body: "What changed?",
      }),
    ).toBe(true);
    expect(
      await recordAgentMessage({
        channel: "whatsapp",
        direction: "inbound",
        providerMessageId: "SM-agent-store",
        body: "Duplicate delivery",
      }),
    ).toBe(false);

    await beginAgentRun({
      id: "run-outbox",
      triggerType: "manual",
      provenance: "simulated",
    });
    const sendInput = {
      idempotency_key: "run-outbox:collection-email",
      thread_id: "thread-1047",
      to: "client@example.test",
      subject: "Invoice INV-1047",
      body_text: "A friendly reminder.",
      now: new Date("2026-07-26T10:00:00.000Z"),
    };
    const first = await sendSimulatedGmailMessage(
      sendInput,
      d1SimulatedGmailOutboxStore,
    );
    const second = await sendSimulatedGmailMessage(
      sendInput,
      d1SimulatedGmailOutboxStore,
    );

    expect(first.data.reused).toBe(false);
    expect(second.data.reused).toBe(true);
    expect(await (await getDb()).select().from(agentMessages)).toHaveLength(1);
    expect(await (await getDb()).select().from(simulatedOutbox)).toHaveLength(1);
  });

  it("resets demo evidence while retaining the permission policy", async () => {
    await beginAgentRun({
      id: "run-reset",
      triggerType: "demo_event",
      provenance: "simulated",
    });
    await recordAgentToolCall({
      runId: "run-reset",
      toolName: "search_business_context",
      status: "succeeded",
      provenance: "simulated",
      toolInput: {},
    });
    await recordAgentMessage({
      runId: "run-reset",
      channel: "system",
      direction: "inbound",
      body: "Supplier bill received.",
    });
    await setDemoAgentState("triggered", "run-reset");

    await resetDemoAgent();

    const db = await getDb();
    expect(await db.select().from(agentRuns)).toEqual([]);
    expect(await db.select().from(agentToolCalls)).toEqual([]);
    expect(await db.select().from(agentMessages)).toEqual([]);
    const state = await loadAgentCommandState();
    expect(state.demoState).toMatchObject({
      scenarioState: "ready",
      activeRunId: null,
    });
    expect(state.permissions.payment_link).toBe("auto");
  });
});
