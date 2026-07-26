import { RunwayDashboard } from "@/components/runway-dashboard";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import type { RunwaySnapshot } from "@/lib/runway-contracts";
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

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getChatGPTUser();
  let snapshot: RunwaySnapshot;
  try {
    if (user) await ensureRunwayProfile(user.email);
    snapshot = await loadRunwaySnapshot();
  } catch (error) {
    snapshot = unavailableSnapshot(
      error instanceof Error
        ? error.message
        : "Runway data could not be loaded.",
    );
  }
  const query = await searchParams;
  const jobIds = typeof query.jobIds === "string" ? query.jobIds : undefined;
  return (
    <RunwayDashboard
      snapshot={snapshot}
      jobIds={jobIds}
      signedInEmail={user?.email}
    />
  );
}
