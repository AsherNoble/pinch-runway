import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  agentMessages,
  agentPermissions,
  agentRuns,
  agentToolCalls,
  demoAgentState,
  simulatedOutbox,
} from "@/db/schema";
import type {
  ActionClass,
  PermissionMode,
  Provenance,
} from "@/lib/agent/contracts";
import type {
  SimulatedGmailOutboxMessage,
  SimulatedGmailOutboxStore,
} from "@/lib/agent-integrations/google-seeded";

export type StoredPermissionMode = PermissionMode;
export type StoredActionClass = ActionClass;
export type StoredProvenance = Provenance;

export async function loadAgentPermissions(): Promise<
  Record<StoredActionClass, StoredPermissionMode>
> {
  const rows = await (await getDb()).select().from(agentPermissions);
  const defaults: Record<StoredActionClass, StoredPermissionMode> = {
    collection_email: "auto",
    payment_link: "auto",
    calendar_edit: "blocked",
    receipt_request: "ask",
  };
  for (const row of rows) defaults[row.actionClass] = row.mode;
  return defaults;
}

export async function setAgentPermission(
  actionClass: StoredActionClass,
  mode: StoredPermissionMode,
): Promise<void> {
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  await db
    .insert(agentPermissions)
    .values({ actionClass, mode, updatedAt })
    .onConflictDoUpdate({
      target: agentPermissions.actionClass,
      set: { mode, updatedAt },
    });
}

export async function beginAgentRun(input: {
  id: string;
  triggerType: "demo_event" | "whatsapp" | "manual";
  provenance: StoredProvenance;
}): Promise<void> {
  await (await getDb()).insert(agentRuns).values({
    id: input.id,
    triggerType: input.triggerType,
    status: "running",
    provenance: input.provenance,
    startedAt: new Date().toISOString(),
  });
}

export async function completeAgentRun(input: {
  id: string;
  status: "awaiting_approval" | "completed" | "failed";
  provenance?: StoredProvenance;
  summary?: string;
  forecast?: unknown;
  errorCode?: string;
}): Promise<void> {
  await (await getDb())
    .update(agentRuns)
    .set({
      status: input.status,
      completedAt: new Date().toISOString(),
      ...(input.provenance ? { provenance: input.provenance } : {}),
      summary: input.summary ?? null,
      forecastJson:
        input.forecast === undefined ? null : JSON.stringify(input.forecast),
      errorCode: input.errorCode ?? null,
    })
    .where(eq(agentRuns.id, input.id));
}

export async function recordAgentToolCall(input: {
  id?: string;
  runId: string;
  toolName: string;
  actionClass?: StoredActionClass;
  status: "proposed" | "awaiting_approval" | "succeeded" | "failed";
  provenance: StoredProvenance;
  toolInput: unknown;
  result?: unknown;
}): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  await (await getDb()).insert(agentToolCalls).values({
    id,
    runId: input.runId,
    toolName: input.toolName,
    actionClass: input.actionClass ?? null,
    status: input.status,
    provenance: input.provenance,
    inputJson: JSON.stringify(input.toolInput),
    resultJson: input.result === undefined ? null : JSON.stringify(input.result),
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function recordAgentMessage(input: {
  runId?: string;
  channel: "whatsapp" | "web" | "system";
  direction: "inbound" | "outbound";
  providerMessageId?: string;
  body: string;
}): Promise<boolean> {
  const inserted = await (await getDb())
    .insert(agentMessages)
    .values({
      runId: input.runId ?? null,
      channel: input.channel,
      direction: input.direction,
      providerMessageId: input.providerMessageId ?? null,
      body: input.body,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .returning({ id: agentMessages.id });
  return inserted.length > 0;
}

export async function recentAgentMessages(limit = 12) {
  const rows = await (await getDb())
    .select()
    .from(agentMessages)
    .orderBy(desc(agentMessages.createdAt))
    .limit(limit);
  return rows.reverse();
}

export async function writeSimulatedEmail(input: {
  runId: string;
  threadId: string;
  recipient: string;
  subject: string;
  body: string;
  status?: "drafted" | "sent";
}) {
  const id = crypto.randomUUID();
  const row = {
    id,
    runId: input.runId,
    threadId: input.threadId,
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    status: input.status ?? ("sent" as const),
    createdAt: new Date().toISOString(),
  };
  await (await getDb()).insert(simulatedOutbox).values(row);
  return row;
}

export const d1SimulatedGmailOutboxStore: SimulatedGmailOutboxStore = {
  async putIfAbsent(candidate: SimulatedGmailOutboxMessage) {
    const db = await getDb();
    const row = {
      id: candidate.id,
      runId: candidate.idempotency_key.split(":")[0] || "agent",
      threadId: candidate.thread_id,
      recipient: candidate.to,
      subject: candidate.subject,
      body: candidate.body_text,
      status: "sent" as const,
      createdAt: candidate.created_at,
    };
    const inserted = await db
      .insert(simulatedOutbox)
      .values(row)
      .onConflictDoNothing({ target: simulatedOutbox.id })
      .returning({ id: simulatedOutbox.id });
    if (inserted.length > 0) {
      return { message: candidate, inserted: true };
    }
    const [existing] = await db
      .select()
      .from(simulatedOutbox)
      .where(eq(simulatedOutbox.id, candidate.id))
      .limit(1);
    if (!existing) {
      throw new Error("The simulated Gmail outbox could not retain its message.");
    }
    return {
      message: {
        id: existing.id,
        idempotency_key: candidate.idempotency_key,
        thread_id: existing.threadId,
        to: existing.recipient,
        subject: existing.subject,
        body_text: existing.body,
        created_at: existing.createdAt,
      },
      inserted: false,
    };
  },
};

export async function setDemoAgentState(
  scenarioState: "ready" | "triggered" | "completed",
  activeRunId: string | null,
): Promise<void> {
  const db = await getDb();
  await db
    .insert(demoAgentState)
    .values({
      id: 1,
      scenarioState,
      activeRunId,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: demoAgentState.id,
      set: {
        scenarioState,
        activeRunId,
        updatedAt: new Date().toISOString(),
      },
    });
}

export async function resetDemoAgent(): Promise<void> {
  const db = await getDb();
  await db.delete(agentToolCalls);
  await db.delete(agentMessages);
  await db.delete(simulatedOutbox);
  await db.delete(agentRuns);
  await setDemoAgentState("ready", null);
}

export async function loadAgentCommandState() {
  const db = await getDb();
  const [latestRun] = await db
    .select()
    .from(agentRuns)
    .orderBy(desc(agentRuns.startedAt))
    .limit(1);
  const toolCalls = latestRun
    ? await db
        .select()
        .from(agentToolCalls)
        .where(eq(agentToolCalls.runId, latestRun.id))
        .orderBy(agentToolCalls.createdAt)
    : [];
  const outbox = latestRun
    ? await db
        .select()
        .from(simulatedOutbox)
        .where(eq(simulatedOutbox.runId, latestRun.id))
        .orderBy(simulatedOutbox.createdAt)
    : [];
  const [demoState] = await db
    .select()
    .from(demoAgentState)
    .where(eq(demoAgentState.id, 1))
    .limit(1);
  return {
    permissions: await loadAgentPermissions(),
    latestRun: latestRun
      ? {
          ...latestRun,
          forecast: latestRun.forecastJson
            ? safelyParseJson(latestRun.forecastJson)
            : null,
        }
      : null,
    toolCalls: toolCalls.map((row) => ({
      ...row,
      input: safelyParseJson(row.inputJson),
      result: row.resultJson ? safelyParseJson(row.resultJson) : null,
    })),
    messages: await recentAgentMessages(),
    outbox,
    demoState: demoState ?? {
      id: 1,
      scenarioState: "ready" as const,
      activeRunId: null,
      updatedAt: null,
    },
  };
}

function safelyParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
