import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import {
  agentHeartbeatExecutions,
  agentMessages,
  simulatedOutbox,
} from "@/db/schema";
import { runHourlyHeartbeat } from "@/lib/agent-heartbeat";
import { WORKERS_AI_MODEL, type WorkersAiBinding } from "@/lib/agent/workers-ai.server";
import {
  loadAgentCommandState,
  setAgentHeartbeatEnabled,
} from "@/lib/agent-store";

function completion(content: string): unknown {
  return {
    id: "heartbeat-completion",
    object: "chat.completion",
    created: 1,
    model: WORKERS_AI_MODEL,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
  };
}

describe("hourly agent heartbeat", () => {
  it("checks every mock source once per hour without taking action", async () => {
    await setAgentHeartbeatEnabled(true);
    const requests: Parameters<WorkersAiBinding["run"]>[1][] = [];
    const ai: WorkersAiBinding = {
      async run(model, input) {
        expect(model).toBe(WORKERS_AI_MODEL);
        requests.push(input);
        return completion(
          "Mock inbox and calendar checked. The forecast still shows a 3 August pressure date; no action was taken.",
        );
      },
    };
    const now = new Date("2026-07-26T10:00:00.000Z");

    const first = await runHourlyHeartbeat(now, { ai });
    const replay = await runHourlyHeartbeat(now, { ai });
    const state = await loadAgentCommandState();
    const db = await getDb();

    expect(first).toMatchObject({ state: "completed", provenance: "live" });
    expect(replay).toEqual({
      state: "duplicate",
      scheduled_hour: "2026-07-26T10",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.tools).toEqual([]);
    expect(requests[0]?.messages.at(-1)?.content).toContain(
      "mocked_gmail_and_calendar",
    );
    expect(state.latestRun).toMatchObject({
      triggerType: "heartbeat",
      status: "completed",
      provenance: "live",
    });
    expect(state.toolCalls.map((call) => call.toolName)).toEqual([
      "get_financial_snapshot",
      "search_business_context",
      "get_action_history",
    ]);
    expect(await db.select().from(simulatedOutbox)).toEqual([]);
    expect(await db.select().from(agentMessages)).toEqual([]);
    expect(await db.select().from(agentHeartbeatExecutions)).toEqual([
      expect.objectContaining({
        scheduledHour: "2026-07-26T10",
        status: "completed",
        runId: first.state === "completed" ? first.run_id : undefined,
      }),
    ]);
  });

  it("respects the dashboard toggle before reserving an hourly execution", async () => {
    await setAgentHeartbeatEnabled(false);

    const result = await runHourlyHeartbeat(
      new Date("2026-07-26T11:00:00.000Z"),
      {
        ai: {
          async run() {
            throw new Error("The model must not run while the heartbeat is off.");
          },
        },
      },
    );

    expect(result).toEqual({
      state: "disabled",
      scheduled_hour: "2026-07-26T11",
    });
    expect(
      (await (await getDb()).select().from(agentHeartbeatExecutions)).some(
        (execution) => execution.scheduledHour === "2026-07-26T11",
      ),
    ).toBe(false);
  });
});
