import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { PinchSandboxClient } from "@/lib/pinch/client";
import { getPinchRuntimeConfig } from "@/lib/pinch/config";
import {
  getPinchSandboxSetupConfig,
  matchesSandboxSetupToken,
  nextBusinessDate,
  sandboxPaymentDescription,
} from "@/lib/pinch/sandbox-setup";
import {
  getRunwaySandboxTestPayer,
  isRunwaySandboxPayerKey,
} from "@/lib/pinch/sandbox-fixtures";

export const dynamic = "force-dynamic";

const TEST_PAYMENT_AMOUNT = 1_000;

/**
 * Local/internal utility only. CaptureJS tokenises the test bank account in the
 * browser; this route receives the opaque token once and never logs or stores it.
 */
export async function POST(request: Request) {
  const setup = getPinchSandboxSetupConfig();
  if (!setup.enabled) return unavailable();
  if (!(await isAuthorisedSetupRequest(request, setup.operator_token, setup.operator_email))) {
    return forbidden();
  }

  const payload = await readJson(request);
  const captureToken = stringValue(payload.capture_token);
  const payerKey = payload.payer_key;
  const providedSetupToken = stringValue(payload.setup_token);

  if (!captureToken || !isRunwaySandboxPayerKey(payerKey)) {
    return message("A CaptureJS token and recognised labelled test Payer are required.", 400);
  }
  if (!matchesSandboxSetupToken(providedSetupToken, setup.operator_token)) {
    return forbidden();
  }

  try {
    const client = new PinchSandboxClient(getPinchRuntimeConfig());
    const payer = getRunwaySandboxTestPayer(payerKey);
    const providerPayerId = await resolvePayerId(client, payer.email_address);
    const source = await client.createPaymentSource({
      payer_id: providerPayerId,
      token: captureToken,
    });
    const transactionDate = nextBusinessDate();
    const payment = await client.createScheduledPayment({
      payer_id: providerPayerId,
      source_id: source.id,
      amount: TEST_PAYMENT_AMOUNT,
      description: sandboxPaymentDescription(payerKey),
      transaction_date: transactionDate,
      nonce: `runway-g3-${payerKey}-${crypto.randomUUID()}`,
    });

    return NextResponse.json(
      {
        payer_key: payerKey,
        provider_payer_id: providerPayerId,
        provider_source_id: source.id,
        provider_payment_id: payment.id,
        transaction_date: payment.transaction_date ?? transactionDate,
        status: payment.raw_status ?? null,
      },
      { headers: noStoreHeaders() },
    );
  } catch {
    return message(
      "Pinch sandbox source or scheduled Payment creation failed. No success was assumed.",
      502,
    );
  }
}

async function resolvePayerId(
  client: PinchSandboxClient,
  emailAddress: string,
): Promise<string> {
  const payers = await client.listPayers({ page: 1, page_size: 100 });
  const payer = payers.find((candidate) => payerEmail(candidate) === emailAddress);
  if (!payer || typeof payer.id !== "string") {
    throw new Error("The labelled Pinch sandbox Payer could not be resolved.");
  }
  return payer.id;
}

async function isAuthorisedSetupRequest(
  request: Request,
  operatorToken: string | undefined,
  operatorEmail: string | undefined,
): Promise<boolean> {
  if (!hasSameOrigin(request)) return false;
  if (!operatorToken) return false;

  if (process.env.NODE_ENV !== "production") return true;

  const user = await getChatGPTUser();
  if (!user) return false;
  return !operatorEmail || user.email.toLowerCase() === operatorEmail;
}

function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const payload = await request.json();
    return isRecord(payload) ? payload : {};
  } catch {
    return {};
  }
}

function payerEmail(payer: Record<string, unknown>): string | undefined {
  const candidate = payer.emailAddress ?? payer.email;
  return typeof candidate === "string" ? candidate.toLowerCase() : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unavailable() {
  return message("Pinch sandbox setup is not enabled.", 404);
}

function forbidden() {
  return message("Pinch sandbox setup is not authorised.", 403);
}

function message(value: string, status: number) {
  return NextResponse.json({ message: value }, { status, headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "cache-control": "no-store" };
}
