import {
  completeAgentHeartbeatExecution,
  loadAgentHeartbeatSettings,
  reserveAgentHeartbeatExecution,
} from "@/lib/agent-store";
import {
  runHourlyHeartbeatAgent,
  type AgentRuntimeOptions,
} from "@/lib/agent-runtime";

export type AgentHeartbeatResult =
  | { state: "disabled" | "duplicate"; scheduled_hour: string }
  | {
      state: "completed";
      scheduled_hour: string;
      run_id: string;
      provenance: "live" | "simulated" | "fallback";
    }
  | { state: "failed"; scheduled_hour: string; reason: string };

export function heartbeatHourKey(now: Date): string {
  return now.toISOString().slice(0, 13);
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  return error.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80);
}

export async function runHourlyHeartbeat(
  now = new Date(),
  options: AgentRuntimeOptions = {},
): Promise<AgentHeartbeatResult> {
  const scheduledHour = heartbeatHourKey(now);
  const settings = await loadAgentHeartbeatSettings();
  if (!settings.enabled) {
    return { state: "disabled", scheduled_hour: scheduledHour };
  }

  const reserved = await reserveAgentHeartbeatExecution({
    scheduledHour,
    startedAt: now.toISOString(),
  });
  if (!reserved) {
    return { state: "duplicate", scheduled_hour: scheduledHour };
  }

  try {
    const run = await runHourlyHeartbeatAgent(now, options);
    await completeAgentHeartbeatExecution({
      scheduledHour,
      status: "completed",
      runId: run.run_id,
    });
    return {
      state: "completed",
      scheduled_hour: scheduledHour,
      run_id: run.run_id,
      provenance: run.provenance,
    };
  } catch (error) {
    const reason = errorCode(error);
    await completeAgentHeartbeatExecution({
      scheduledHour,
      status: "failed",
      errorCode: reason,
    });
    console.error("agent.heartbeat.failed", { scheduledHour, reason });
    return { state: "failed", scheduled_hour: scheduledHour, reason };
  }
}
