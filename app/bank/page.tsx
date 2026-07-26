import Link from "next/link";
import { RunwayDashboard } from "@/components/runway-dashboard";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ensureRunwayProfile, loadRunwaySnapshot } from "@/lib/runway-store";
import { getPinchReadiness, getPinchRuntimeConfig } from "@/lib/pinch/config";
import { loadLivePinchSnapshot } from "@/lib/pinch/snapshot";
import { buildRunwayView, getDemoRunwayView, type RunwayViewModel } from "@/lib/runway-view";

export const dynamic = "force-dynamic";

async function loadCollectionPingView(): Promise<RunwayViewModel> {
  const readiness = getPinchReadiness();
  if (getPinchRuntimeConfig().data_source === "sandbox" && readiness.state === "ready") {
    try {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Australia/Sydney",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      return buildRunwayView(await loadLivePinchSnapshot(today), today);
    } catch {
      return getDemoRunwayView();
    }
  }
  return getDemoRunwayView();
}

export default async function BankSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getChatGPTUser();
  if (user) await ensureRunwayProfile(user.email);
  const [snapshot, collectionPing] = await Promise.all([
    loadRunwaySnapshot(),
    loadCollectionPingView(),
  ]);
  const query = await searchParams;
  const jobIds = typeof query.jobIds === "string" ? query.jobIds : undefined;
  return (
    <>
      <div className="bank-back-link">
        <Link href="/">← Agent command center</Link>
      </div>
      <RunwayDashboard
        snapshot={snapshot}
        jobIds={jobIds}
        signedInEmail={user?.email}
        collectionPing={collectionPing}
      />
    </>
  );
}
