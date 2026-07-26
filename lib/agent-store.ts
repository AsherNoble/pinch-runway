import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  agentApprovals,
  agentMessages,
  agentHeartbeatExecutions,
  agentHeartbeatSettings,
  agentPermissions,
  agentRuns,
  agentToolCalls,
  demoAgentState,
  simulatedCalendarEdits,
  simulatedOutbox,
} from "@/db/schema";
import type {
  ActionClass,
  AgentApprovalStatus,
  PermissionMode,
  Provenance,
} from "@/lib/agent/contracts";
import type {
  SeededCalendarEdit,
  SimulatedGmailOutboxMessage,
  SimulatedGmailOutboxStore,
} from "@/lib/agent-integrations/google-seeded";

export type StoredPermissionMode = PermissionMode;
export type StoredActionClass = ActionClass;
export type StoredProvenance = Provenance;
export type StoredApprovalStatus = AgentApprovalStatus;
export type AgentHeartbeatExecutionStatus =
  | "running"
  | "completed"
  | "failed"
  | "skipped";

const AGENT_HEARTBEAT_SETTINGS_ID = 1;

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
  triggerType: "demo_event" | "whatsapp" | "manual" | "heartbeat";
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

export async function loadAgentHeartbeatSettings() {
  const db = await getDb();
  const [settings] = await db
    .select()
    .from(agentHeartbeatSettings)
    .where(eq(agentHeartbeatSettings.id, AGENT_HEARTBEAT_SETTINGS_ID))
    .limit(1);
  const [latestExecution] = await db
    .select()
    .from(agentHeartbeatExecutions)
    .orderBy(desc(agentHeartbeatExecutions.startedAt))
    .limit(1);

  return {
    enabled: settings?.enabled ?? true,
    updatedAt: settings?.updatedAt ?? null,
    latestExecution: latestExecution ?? null,
  };
}

export async function setAgentHeartbeatEnabled(enabled: boolean): Promise<void> {
  const db = await getDb();
  await db
    .insert(agentHeartbeatSettings)
    .values({
      id: AGENT_HEARTBEAT_SETTINGS_ID,
      enabled,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: agentHeartbeatSettings.id,
      set: { enabled, updatedAt: new Date().toISOString() },
    });
}

export async function reserveAgentHeartbeatExecution(input: {
  scheduledHour: string;
  startedAt: string;
}): Promise<boolean> {
  const db = await getDb();
  const inserted = await db
    .insert(agentHeartbeatExecutions)
    .values({
      scheduledHour: input.scheduledHour,
      startedAt: input.startedAt,
      status: "running",
    })
    .onConflictDoNothing()
    .returning({ scheduledHour: agentHeartbeatExecutions.scheduledHour });
  return inserted.length === 1;
}

export async function completeAgentHeartbeatExecution(input: {
  scheduledHour: string;
  status: Exclude<AgentHeartbeatExecutionStatus, "running">;
  runId?: string;
  errorCode?: string;
}): Promise<void> {
  await (await getDb())
    .update(agentHeartbeatExecutions)
    .set({
      status: input.status,
      completedAt: new Date().toISOString(),
      runId: input.runId ?? null,
      errorCode: input.errorCode ?? null,
    })
    .where(eq(agentHeartbeatExecutions.scheduledHour, input.scheduledHour));
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

export async function agentToolCallsForRun(runId: string) {
  const rows = await (await getDb())
    .select()
    .from(agentToolCalls)
    .where(eq(agentToolCalls.runId, runId))
    .orderBy(agentToolCalls.createdAt);
  return rows.map((row) => ({
    ...row,
    input: safelyParseJson(row.inputJson),
    result: row.resultJson ? safelyParseJson(row.resultJson) : null,
  }));
}

export async function updateAgentToolCall(input: {
  id: string;
  status: "proposed" | "awaiting_approval" | "succeeded" | "failed";
  provenance?: StoredProvenance;
  result?: unknown;
}): Promise<void> {
  await (await getDb())
    .update(agentToolCalls)
    .set({
      status: input.status,
      ...(input.provenance ? { provenance: input.provenance } : {}),
      ...(input.result === undefined
        ? {}
        : { resultJson: JSON.stringify(input.result) }),
    })
    .where(eq(agentToolCalls.id, input.id));
}

/**
 * Parks a proposed action in the owner's approval queue.
 *
 * Called only when the action class is set to "ask". Keyed on the audited tool
 * call so a retry of the same proposal cannot enqueue it twice.
 */
export async function enqueueAgentApproval(input: {
  runId: string;
  toolCallId: string;
  toolName: string;
  actionClass: StoredActionClass;
  toolInput: unknown;
  summary: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const inserted = await (await getDb())
    .insert(agentApprovals)
    .values({
      id,
      runId: input.runId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      actionClass: input.actionClass,
      inputJson: JSON.stringify(input.toolInput),
      summary: input.summary,
      status: "pending",
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing({ target: agentApprovals.toolCallId })
    .returning({ id: agentApprovals.id });
  if (inserted[0]) return inserted[0].id;
  const [existing] = await (await getDb())
    .select({ id: agentApprovals.id })
    .from(agentApprovals)
    .where(eq(agentApprovals.toolCallId, input.toolCallId))
    .limit(1);
  return existing?.id ?? id;
}

/**
 * Atomically moves a pending approval to `executing` and returns it.
 *
 * The `status = 'pending'` predicate is the concurrency guard: two approve
 * requests for the same action race on this UPDATE and exactly one sees a row,
 * so a double-clicked Approve button cannot send the email twice. Returns null
 * when the approval is missing or already decided.
 */
export async function claimAgentApproval(id: string) {
  const claimed = await (await getDb())
    .update(agentApprovals)
    .set({ status: "executing", decidedAt: new Date().toISOString() })
    .where(and(eq(agentApprovals.id, id), eq(agentApprovals.status, "pending")))
    .returning();
  const row = claimed[0];
  if (!row) return null;
  return { ...row, input: safelyParseJson(row.inputJson) };
}

export async function settleAgentApproval(input: {
  id: string;
  status: Exclude<StoredApprovalStatus, "pending" | "executing">;
  result?: unknown;
}): Promise<void> {
  await (await getDb())
    .update(agentApprovals)
    .set({
      status: input.status,
      decidedAt: new Date().toISOString(),
      ...(input.result === undefined
        ? {}
        : { resultJson: JSON.stringify(input.result) }),
    })
    .where(eq(agentApprovals.id, input.id));
}

/**
 * Rejects a pending approval. Same conditional-UPDATE guard as the claim path,
 * so denying an already-executed action is a no-op rather than a rewrite.
 */
export async function denyAgentApproval(id: string) {
  const denied = await (await getDb())
    .update(agentApprovals)
    .set({ status: "denied", decidedAt: new Date().toISOString() })
    .where(and(eq(agentApprovals.id, id), eq(agentApprovals.status, "pending")))
    .returning();
  return denied[0] ?? null;
}

export async function pendingAgentApprovals() {
  const rows = await (await getDb())
    .select()
    .from(agentApprovals)
    .where(eq(agentApprovals.status, "pending"))
    .orderBy(agentApprovals.createdAt);
  return rows.map((row) => ({ ...row, input: safelyParseJson(row.inputJson) }));
}

/**
 * Records a simulated calendar mutation. See db/schema.ts
 * `simulated_calendar_edits` for why edits are stored rather than sent.
 */
export async function recordSimulatedCalendarEdit(input: {
  runId: string;
  eventId: string;
  summary?: string | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
  note?: string | null;
}): Promise<SeededCalendarEdit> {
  const row = {
    id: crypto.randomUUID(),
    runId: input.runId,
    eventId: input.eventId,
    summary: input.summary ?? null,
    startDateTime: input.startDateTime ?? null,
    endDateTime: input.endDateTime ?? null,
    note: input.note ?? null,
    createdAt: new Date().toISOString(),
  };
  await (await getDb()).insert(simulatedCalendarEdits).values(row);
  return toSeededCalendarEdit(row);
}

export async function loadSimulatedCalendarEdits(): Promise<
  readonly SeededCalendarEdit[]
> {
  const rows = await (await getDb())
    .select()
    .from(simulatedCalendarEdits)
    .orderBy(simulatedCalendarEdits.createdAt);
  return rows.map(toSeededCalendarEdit);
}

function toSeededCalendarEdit(row: {
  eventId: string;
  summary: string | null;
  startDateTime: string | null;
  endDateTime: string | null;
  note: string | null;
  createdAt: string;
}): SeededCalendarEdit {
  return {
    event_id: row.eventId,
    summary: row.summary,
    start_date_time: row.startDateTime,
    end_date_time: row.endDateTime,
    note: row.note,
    created_at: row.createdAt,
  };
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
  await db.delete(agentApprovals);
  await db.delete(simulatedCalendarEdits);
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
  const heartbeat = await loadAgentHeartbeatSettings();
  return {
    permissions: await loadAgentPermissions(),
    // The queue is intentionally global rather than scoped to the latest run:
    // an action the owner has not answered yet still needs a decision after a
    // newer run starts.
    approvals: await pendingAgentApprovals(),
    calendarEdits: await loadSimulatedCalendarEdits(),
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
    heartbeat,
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
