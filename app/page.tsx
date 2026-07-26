import { AgentCommandCenter } from "@/components/agent-command-center";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import type { RunwaySnapshot } from "@/lib/runway-contracts";
import { loadAgentCommandState } from "@/lib/agent-store";
import { buildAgentCommandCenterModel } from "@/lib/agent-view";
import {
  ensureRunwayProfile,
  loadRunwaySnapshot,
} from "@/lib/runway-store";

export const dynamic = "force-dynamic";

function unavailableSnapshot(message: string): RunwaySnapshot {
  return {
    generated_at: new Date().toISOString(),
    bank_source: {
      state: "error",
      display_label: "Bank data unavailable",
      last_synced_at: null,
      message,
    },
    receivables_source: {
      state: "error",
      display_label: "Receivables unavailable",
      last_synced_at: null,
      message: "The D1 ledger could not be read.",
    },
    accounts: [],
    operating_cash_cents: 0,
    liabilities_cents: 0,
    earned_not_received_cents: 0,
    expense_profile: null,
    expense_exclusion_patterns: [],
    receivables: [],
    receivables_aging: {
      not_due_cents: 0,
      overdue_1_7_cents: 0,
      overdue_8_30_cents: 0,
      overdue_31_plus_cents: 0,
      total_unpaid_cents: 0,
    },
    forecast: null,
    reminder_decision: null,
    automation_mode: "off",
  };
}

export default async function Home() {
  const user = await getChatGPTUser();
  let snapshot: RunwaySnapshot;
  let commandState: Awaited<ReturnType<typeof loadAgentCommandState>> | null =
    null;
  try {
    if (user) await ensureRunwayProfile(user.email);
    snapshot = await loadRunwaySnapshot();
    commandState = await loadAgentCommandState();
  } catch (error) {
    snapshot = unavailableSnapshot(
      error instanceof Error
        ? error.message
        : "Runway data could not be loaded.",
    );
  }
  return (
    <AgentCommandCenter
      model={buildAgentCommandCenterModel({ snapshot, commandState })}
      endpoints={{
        permission: "/api/agent/permissions",
        approval: "/api/agent/approvals",
        trigger: "/api/internal/demo/agent/trigger",
        reset: "/api/internal/demo/agent/reset",
      }}
    />
  );
}
