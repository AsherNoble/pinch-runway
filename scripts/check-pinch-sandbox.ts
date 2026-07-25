import { PinchSandboxClient } from "../lib/pinch/client";
import { getPinchReadiness, getPinchRuntimeConfig } from "../lib/pinch/config";

async function main() {
  const config = getPinchRuntimeConfig();
  const readiness = getPinchReadiness(config);
  if (readiness.state !== "ready") {
    throw new Error(
      `Cannot verify Pinch sandbox: ${readiness.display_label}. Set RUNWAY_DATA_SOURCE=sandbox and provide server-only sandbox credentials.`,
    );
  }

  const client = new PinchSandboxClient(config);
  const payers = await client.listPayers({ page: 1, page_size: 1 });
  console.info(`Pinch sandbox reachable. Received ${payers.length} payer record(s) on the first page.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Pinch sandbox verification failure.";
  console.error(message);
  process.exitCode = 1;
});
