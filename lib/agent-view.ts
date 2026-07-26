import type {
  AgentCommandCenterViewModel,
  AgentProvenance,
} from "@/components/agent-command-center";
import type { AgentForecastResult } from "@/lib/agent";
import { getTwilioWhatsAppReadiness } from "@/lib/agent-integrations";
import type { loadAgentCommandState } from "@/lib/agent-store";
import { getPinchReadiness } from "@/lib/pinch/config";
import type { RunwaySnapshot } from "@/lib/runway-contracts";

type StoredCommandState = Awaited<ReturnType<typeof loadAgentCommandState>>;

export function buildAgentCommandCenterModel(input: {
  snapshot: RunwaySnapshot;
  commandState: StoredCommandState | null;
  now?: Date;
}): AgentCommandCenterViewModel {
  const now = input.now ?? new Date();
  const run = input.commandState?.latestRun ?? null;
  const forecast = isAgentForecast(run?.forecast) ? run.forecast : null;
  const provenance = (run?.provenance ?? "simulated") as AgentProvenance;
  const materialRisk = forecast?.material_risk_date !== null && forecast != null;
  const target = forecast?.ranked_collection_targets[0];
  const actionCompleted = run?.status === "completed";
  const actionPaused = run?.status === "awaiting_approval" || run?.status === "failed";

  return {
    generatedAt: now.toISOString(),
    greeting: materialRisk
      ? "I spotted a squeeze and moved early."
      : "Your money ops are quiet for now.",
    risk: {
      level: materialRisk ? "material" : input.snapshot.forecast ? "watch" : "comfortable",
      eyebrow: materialRisk ? "Material cash pressure" : "Current position",
      title: materialRisk
        ? `The new supplier bill puts your buffer at risk`
        : "No agent intervention is active",
      summary: materialRisk
        ? `${target?.payer_name ?? "The ranked collection"} can repair ${aud(
            target?.repair_cents ?? forecast.repair_amount_cents,
          )} of the first gap. Runway keeps the provider evidence and simulated context separate.`
        : "Runway is watching connected cash, collections and finance-relevant commitments. Inject the demo bill to run the golden path.",
      riskDate: forecast?.material_risk_date ?? null,
      projectedLowCents: forecast?.cash_only.low_cents ?? null,
      repairAmountCents: forecast?.repair_amount_cents ?? null,
      actionLabel: materialRisk
        ? actionCompleted
          ? "Collection follow-up completed and receipt logged"
          : "Collect the ranked overdue invoice"
        : "Keep monitoring",
      actionState: actionPaused
        ? "paused"
        : actionCompleted
          ? "completed"
          : run
            ? "in_progress"
            : "recommended",
      provenance,
    },
    forecast: {
      bufferCents:
        forecast?.risk_buffer_cents ??
        input.snapshot.forecast?.risk_buffer_cents ??
        0,
      weeks:
        forecast?.weeks.map((week) => ({
          id: `week-${week.week}`,
          label: `W${week.week}`,
          startsOn: week.start_date,
          cashOnlyCents: week.cash_only_closing_cents,
          expectedCents: week.expected_closing_cents,
        })) ?? [],
    },
    activity: buildActivity(input.commandState),
    sources: [
      {
        name: "Basiq",
        status: bankStatus(input.snapshot.bank_source.state),
        detail: input.snapshot.bank_source.display_label,
        updatedAt: input.snapshot.bank_source.last_synced_at,
        provenance:
          input.snapshot.bank_source.state === "connected" ||
          input.snapshot.bank_source.state === "stale"
            ? "live"
            : "fallback",
      },
      {
        name: "Pinch",
        status:
          getPinchReadiness().state === "ready" ? "ready" : "not_configured",
        detail: getPinchReadiness().display_label,
        updatedAt: null,
        provenance: getPinchReadiness().state === "ready" ? "live" : "fallback",
      },
      {
        name: "Gmail",
        status: "seeded",
        detail: "Finance-relevant inbox fixture and simulated outbox",
        updatedAt: "2026-07-26T19:15:00+10:00",
        provenance: "simulated",
      },
      {
        name: "Calendar",
        status: "seeded",
        detail: "Project and delivery evidence fixture",
        updatedAt: "2026-07-26T19:15:00+10:00",
        provenance: "simulated",
      },
      {
        name: "Workers AI",
        status: "ready",
        detail: "GLM-4.7-Flash via native binding or authenticated gateway",
        updatedAt: null,
        provenance: "live",
      },
      {
        name: "WhatsApp",
        status:
          getTwilioWhatsAppReadiness().state === "ready"
            ? "ready"
            : "not_configured",
        detail: getTwilioWhatsAppReadiness().display_label,
        updatedAt: null,
        provenance:
          getTwilioWhatsAppReadiness().state === "ready" ? "live" : "fallback",
      },
    ],
    permissions: permissionRows(input.commandState),
    presenter: {
      enabled: process.env.RUNWAY_ENABLE_DEMO_AGENT !== "0",
      scenarioLabel:
        input.commandState?.demoState.scenarioState === "completed"
          ? "Large supplier bill · completed"
          : input.commandState?.demoState.scenarioState === "triggered"
            ? "Large supplier bill · running"
            : "Large supplier bill · ready",
      triggerLabel: "Inject large bill",
      resetLabel: "Reset agent run",
    },
  };
}

function buildActivity(
  state: StoredCommandState | null,
): AgentCommandCenterViewModel["activity"] {
  if (!state?.latestRun) return [];
  const run = state.latestRun;
  const activity: AgentCommandCenterViewModel["activity"][number][] = [
    {
      id: `run:${run.id}`,
      title:
        run.triggerType === "demo_event"
          ? "Unexpected supplier bill detected"
          : "Owner asked Runway",
      detail:
        run.summary ??
        "Runway is checking the financial evidence and permitted playbooks.",
      occurredAt: run.startedAt,
      state:
        run.status === "awaiting_approval"
          ? "needs_approval"
          : run.status === "failed"
            ? "failed"
            : run.status === "completed"
              ? "completed"
              : "running",
      provenance: run.provenance,
    },
  ];
  for (const call of state.toolCalls) {
    activity.push({
      id: call.id,
      title: toolTitle(call.toolName),
      detail: toolDetail(call.toolName, call.status, call.provenance),
      occurredAt: call.createdAt,
      state:
        call.status === "awaiting_approval"
          ? "needs_approval"
          : call.status === "failed"
            ? "failed"
            : call.status === "succeeded"
              ? "completed"
              : "queued",
      provenance: call.provenance,
    });
  }
  return activity.reverse();
}

function permissionRows(
  state: StoredCommandState | null,
): AgentCommandCenterViewModel["permissions"] {
  const permissions = state?.permissions ?? {
    collection_email: "auto" as const,
    payment_link: "auto" as const,
    calendar_edit: "blocked" as const,
    receipt_request: "ask" as const,
  };
  return [
    {
      actionClass: "collection_email",
      label: "Client collection email",
      description: "Write to a client from the connected business inbox.",
      mode: permissions.collection_email,
    },
    {
      actionClass: "payment_link",
      label: "Pinch payment link",
      description: "Create or reuse a provider-confirmed collection link.",
      mode: permissions.payment_link,
    },
    {
      actionClass: "calendar_edit",
      label: "Calendar edits",
      description: "Change business calendar events and admin blocks.",
      mode: permissions.calendar_edit,
    },
    {
      actionClass: "receipt_request",
      label: "Receipt requests",
      description: "Ask for evidence needed by the accountant.",
      mode: permissions.receipt_request,
    },
  ];
}

function isAgentForecast(value: unknown): value is AgentForecastResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as AgentForecastResult).weeks) &&
      typeof (value as AgentForecastResult).risk_buffer_cents === "number",
  );
}

function bankStatus(
  state: RunwaySnapshot["bank_source"]["state"],
): AgentCommandCenterViewModel["sources"][number]["status"] {
  if (state === "connected") return "ready";
  if (state === "demo") return "seeded";
  if (state === "stale" || state === "syncing") return "degraded";
  if (state === "error") return "offline";
  return "not_configured";
}

function toolTitle(name: string): string {
  return (
    {
      get_financial_snapshot: "13-week position checked",
      search_business_context: "Client and supplier context checked",
      get_action_history: "Audit history checked",
      create_pinch_payment_link: "Pinch collection request handled",
      send_client_email: "Client follow-up prepared",
      send_owner_whatsapp: "WhatsApp receipt sent",
    }[name] ?? name.replaceAll("_", " ")
  );
}

function toolDetail(
  name: string,
  status: string,
  provenance: AgentProvenance,
): string {
  const source =
    provenance === "live"
      ? "The provider confirmed this step."
      : provenance === "simulated"
        ? "This step used the clearly seeded demo adapter."
        : "The live step was unavailable, so audited fallback data was used.";
  return `${name.replaceAll("_", " ")} · ${status.replaceAll("_", " ")}. ${source}`;
}

function aud(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
