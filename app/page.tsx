import { RunwayDashboard } from "@/components/runway-dashboard";
import { getPinchReadiness } from "@/lib/pinch/config";
import { getPinchRuntimeConfig } from "@/lib/pinch/config";
import { loadPinchSnapshot } from "@/lib/pinch/snapshot";
import { buildRunwayView } from "@/lib/runway-view";
import { getDemoRunwayView } from "@/lib/runway-view";

export const dynamic = "force-dynamic";

export default async function Home() {
  const readiness = getPinchReadiness();
  let view = getDemoRunwayView();
  if (getPinchRuntimeConfig().data_source === "sandbox" && readiness.state === "ready") {
    try {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      view = buildRunwayView(await loadPinchSnapshot(today), today);
    } catch {
      // A failed live read remains unavailable rather than being swapped for fixtures.
      view = { ...view, snapshot: { ...view.snapshot, data_source: { source: "pinch_sandbox", connection_state: "error", is_live: false, display_label: "Pinch sandbox not connected", last_synced_at: null, error_message: "Live Pinch data could not be loaded." } } };
    }
  }

  return <RunwayDashboard view={view} readiness={readiness} />;
}
