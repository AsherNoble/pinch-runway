import { notFound } from "next/navigation";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getPinchSandboxSetupConfig } from "@/lib/pinch/sandbox-setup";
import { PinchSandboxSetupForm } from "./pinch-sandbox-setup-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pinch sandbox setup | Runway",
  robots: { index: false, follow: false },
};

/**
 * Local/internal tool for making genuine Pinch test data. It is intentionally
 * absent from product navigation and disabled unless its explicit setup flag,
 * test publishable key, and operator token are all configured.
 */
export default async function PinchSandboxSetupPage() {
  const setup = getPinchSandboxSetupConfig();
  if (!setup.enabled || !setup.publishable_key) notFound();

  if (process.env.NODE_ENV === "production") {
    const user = await getChatGPTUser();
    if (!user) notFound();
    if (setup.operator_email && user.email.toLowerCase() !== setup.operator_email) {
      notFound();
    }
  }

  return (
    <main className="runway-shell sandbox-setup-shell">
      <section className="sandbox-setup-hero" aria-labelledby="sandbox-setup-title">
        <p className="eyebrow">Internal · Pinch test mode only</p>
        <h1 id="sandbox-setup-title">Create real history without handling bank data.</h1>
        <p>
          This tool tokenises Pinch&apos;s documented test bank account in the browser,
          then sends only the short-lived opaque token to Runway&apos;s server. It is not
          part of the customer product and is disabled outside an explicit setup flow.
        </p>
      </section>

      <PinchSandboxSetupForm publishableKey={setup.publishable_key} />
    </main>
  );
}
