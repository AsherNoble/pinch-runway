import { RunwayDashboard } from "@/components/runway-dashboard";
import { getPinchReadiness } from "@/lib/pinch/config";
import { getDemoRunwayView } from "@/lib/runway-view";

export const dynamic = "force-dynamic";

export default function Home() {
  const readiness = getPinchReadiness();
  const view = getDemoRunwayView();

  return <RunwayDashboard view={view} readiness={readiness} />;
}
