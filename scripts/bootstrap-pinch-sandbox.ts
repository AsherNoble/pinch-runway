import { PinchSandboxClient } from "../lib/pinch/client.ts";
import { getPinchReadiness, getPinchRuntimeConfig } from "../lib/pinch/config.ts";

const CONFIRMATION_FLAG = "--confirm-test-write";
const CREATE_LINK_FLAG = "--create-payment-link";

const RUNWAY_TEST_PAYERS = [
  {
    key: "reliable",
    first_name: "Runway",
    last_name: "Sandbox Reliable",
    email_address: "runway-sandbox-reliable@example.com",
  },
  {
    key: "delayed",
    first_name: "Runway",
    last_name: "Sandbox Delayed",
    email_address: "runway-sandbox-delayed@example.com",
  },
] as const;

const DEMO_LINK = {
  amount: 50_000,
  description: "Runway sandbox payment link — demo proof only",
  return_url: "https://pinch-runway.asherthenoble.chatgpt.site/payment-return",
  allowed_payment_methods: ["credit-card", "bank-account"] as const,
};

async function main() {
  const arguments_ = new Set(process.argv.slice(2));
  if (!arguments_.has(CONFIRMATION_FLAG)) {
    throw new Error(
      `Refusing to write to Pinch. Re-run with ${CONFIRMATION_FLAG} after confirming this is test mode.`,
    );
  }

  const config = getPinchRuntimeConfig();
  const readiness = getPinchReadiness(config);
  if (readiness.state !== "ready") {
    throw new Error(`Cannot bootstrap Pinch sandbox: ${readiness.display_label}.`);
  }

  const client = new PinchSandboxClient(config);
  const existingPayers = await client.listPayers({ page: 1, page_size: 100 });
  const payerIds = new Map<string, string>();

  for (const payer of RUNWAY_TEST_PAYERS) {
    const existing = existingPayers.find(
      (candidate) => payerEmail(candidate) === payer.email_address,
    );

    if (existing && typeof existing.id === "string") {
      payerIds.set(payer.key, existing.id);
      console.info(`Reused labelled test payer: ${payer.key} (${redactId(existing.id)}).`);
      continue;
    }

    const created = await client.createPayer(payer);
    payerIds.set(payer.key, created.id);
    console.info(`Created labelled test payer: ${payer.key} (${redactId(created.id)}).`);
  }

  if (!arguments_.has(CREATE_LINK_FLAG)) {
    console.info(
      `No Payment Link was created. Add ${CREATE_LINK_FLAG} to make that separate, explicit test write.`,
    );
    return;
  }

  const payerId = payerIds.get("reliable");
  if (!payerId) throw new Error("The reliable sandbox Payer could not be resolved.");

  const link = await client.createPaymentLink({
    ...DEMO_LINK,
    payer_id: payerId,
  });
  console.info(
    `Created real Pinch sandbox Payment Link (${redactId(link.id)}) for $${(
      link.amount / 100
    ).toFixed(2)}. The URL was returned by Pinch and intentionally is not printed.`,
  );
}

function payerEmail(payer: Record<string, unknown>): string | undefined {
  const candidate = payer.emailAddress ?? payer.email;
  return typeof candidate === "string" ? candidate.toLowerCase() : undefined;
}

function redactId(value: string): string {
  if (value.length <= 8) return "[redacted]";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Pinch sandbox bootstrap failure.";
  console.error(message);
  process.exitCode = 1;
});
