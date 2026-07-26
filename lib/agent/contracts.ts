import type { Cents, IsoDate, IsoDateTime } from "../contracts.ts";

export type ActionClass =
  | "collection_email"
  | "payment_link"
  | "calendar_edit"
  | "receipt_request";

export type PermissionMode = "blocked" | "ask" | "auto";

export type Provenance = "live" | "simulated" | "fallback";

export type AgentToolName =
  | "get_financial_snapshot"
  | "search_business_context"
  | "get_action_history"
  | "create_pinch_payment_link"
  | "send_client_email"
  | "send_owner_whatsapp";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed";

export interface AgentEvidence {
  id: string;
  source: "basiq" | "pinch" | "gmail" | "calendar" | "agent";
  provenance: Provenance;
  observed_at: IsoDateTime;
  summary: string;
  external_id?: string;
}

export interface AgentTrigger {
  type: "scheduled" | "provider_event" | "owner_message" | "demo";
  occurred_at: IsoDateTime;
  source: string;
  external_id?: string;
}

export interface AgentToolDefinition {
  name: AgentToolName;
  description: string;
  input_schema: {
    type: "object";
    properties?: Readonly<Record<string, unknown>>;
    required?: readonly string[];
    additionalProperties?: boolean;
  };
}

export interface AgentToolRequest {
  id: string;
  name: AgentToolName;
  input: Readonly<Record<string, unknown>>;
}

export interface AgentToolResult {
  content: unknown;
  provenance: Provenance;
  provider_id?: string;
  is_error?: boolean;
}

export interface AgentToolCallRecord {
  id: string;
  name: AgentToolName;
  requested_at: IsoDateTime;
  completed_at: IsoDateTime | null;
  input: Readonly<Record<string, unknown>>;
  result: unknown | null;
  provenance: Provenance | null;
  provider_id: string | null;
  status: "requested" | "completed" | "failed" | "blocked" | "awaiting_approval";
  error: string | null;
}

export interface AgentForecastSummary {
  generated_on: IsoDate;
  material_risk_date: IsoDate | null;
  projected_low_cents: Cents;
  repair_amount_cents: Cents;
  ranked_collection_target_id: string | null;
}

export interface AgentRun {
  id: string;
  status: AgentRunStatus;
  trigger: AgentTrigger;
  started_at: IsoDateTime | null;
  completed_at: IsoDateTime | null;
  evidence: readonly AgentEvidence[];
  forecast: AgentForecastSummary | null;
  tool_calls: readonly AgentToolCallRecord[];
  final_message: string | null;
  error: string | null;
}

export interface AgentTranscriptMessage {
  role: "user" | "assistant";
  content: string;
}
