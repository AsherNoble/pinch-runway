import Link from "next/link";
import { RunwayDashboard } from "@/components/runway-dashboard";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ensureRunwayProfile, loadRunwaySnapshot } from "@/lib/runway-store";

export const dynamic = "force-dynamic";

export default async function BankSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getChatGPTUser();
  if (user) await ensureRunwayProfile(user.email);
  const snapshot = await loadRunwaySnapshot();
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
      />
    </>
  );
}
