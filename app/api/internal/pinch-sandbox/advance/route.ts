import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { PinchSandboxClient } from "@/lib/pinch/client";
import { getPinchRuntimeConfig } from "@/lib/pinch/config";
import {
  getPinchSandboxSetupConfig,
  isExpectedSandboxPayment,
  isIsoCalendarDate,
  matchesSandboxSetupToken,
  timeTravelAt,
  type PinchTimeTravelStep,
} from "@/lib/pinch/sandbox-setup";
import {
  getRunwaySandboxTestPayer,
  isRunwaySandboxPayerKey,
} from "@/lib/pinch/sandbox-fixtures";

export const dynamic = "force-dynamic";

/**
 * Sends a narrowly scoped Time-Travel header only for a Payment created by the
 * internal G3 tool. It is never a generic Pinch proxy and can never target live.
 */
export async function POST(request: Request) {
  const setup = getPinchSandboxSetupConfig();
  if (!setup.enabled) return unavailable();
  if (!(await isAuthorisedSetupRequest(request, setup.operator_token, setup.operator_email))) {
    return forbidden();
  }

  const payload = await readJson(request);
  const paymentId = stringValue(payload.payment_id);
  const payerKey = payload.payer_key;
  const providedSetupToken = stringValue(payload.setup_token);
  const step = payload.step;

  if (
    !paymentId ||
    !isRunwaySandboxPayerKey(payerKey) ||
    !isPinchTimeTravelStep(step)
  ) {
    return message("A recognised sandbox Payment, Payer, and time-travel step are required.", 400);
  }
  if (!matchesSandboxSetupToken(providedSetupToken, setup.operator_token)) {
    return forbidden();
  }

  try {
    const client = new PinchSandboxClient(getPinchRuntimeConfig());
    const payer = getRunwaySandboxTestPayer(payerKey);
    const providerPayerId = await resolvePayerId(client, payer.email_address);
    const existingPayment = await client.getPayment(paymentId);
    if (!isExpectedSandboxPayment(existingPayment, providerPayerId)) {
      return message("This Payment is not an authorised Runway sandbox history probe.", 403);
    }

    const transactionDate = stringValue(existingPayment.transactionDate);
    if (!transactionDate || !isIsoCalendarDate(transactionDate)) {
      return message("Pinch did not return a usable scheduled Payment date.", 422);
    }

    const testTime = timeTravelAt(transactionDate, step);
    const advancedPayment = await client.getPayment(paymentId, {
      time_travel_at: testTime,
    });

    return NextResponse.json(
      {
        test_time: testTime,
        payment: safePaymentSummary(advancedPayment),
      },
      { headers: noStoreHeaders() },
    );
  } catch {
    return message("Pinch sandbox time travel failed. No Payment state was assumed.", 502);
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

function safePaymentSummary(payment: Record<string, unknown>) {
  const attempts = Array.isArray(payment.attempts)
    ? payment.attempts.filter(isRecord).map((attempt) => ({
        id: stringOrNull(attempt.id),
        status: stringOrNull(attempt.status),
        transaction_date: stringOrNull(attempt.transactionDate),
        estimated_transfer_date: stringOrNull(attempt.estimatedTransferDate),
        actual_transfer_date: stringOrNull(attempt.actualTransferDate),
        dishonour_code: stringOrNull(attempt.dishonourCode),
      }))
    : [];

  return {
    id: stringOrNull(payment.id),
    status: stringOrNull(payment.status),
    transaction_date: stringOrNull(payment.transactionDate),
    attempts,
  };
}

function isPinchTimeTravelStep(value: unknown): value is PinchTimeTravelStep {
  return value === "next_morning" || value === "settle";
}

function payerEmail(payer: Record<string, unknown>): string | undefined {
  const candidate = payer.emailAddress ?? payer.email;
  return typeof candidate === "string" ? candidate.toLowerCase() : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
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
