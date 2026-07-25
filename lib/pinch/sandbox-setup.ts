import { getPinchReadiness, getPinchRuntimeConfig } from "./config.ts";
import {
  RUNWAY_SANDBOX_PAYMENT_DESCRIPTION_PREFIX,
  type RunwaySandboxPayerKey,
} from "./sandbox-fixtures.ts";

type Environment = Record<string, string | undefined>;

export interface PinchSandboxSetupConfig {
  enabled: boolean;
  reason: string;
  publishable_key?: string;
  operator_token?: string;
  operator_email?: string;
}

export type PinchTimeTravelStep = "next_morning" | "settle";

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * This surface is deliberately off unless all of these local-only controls are
 * present. The publishable key is passed to CaptureJS on the internal page;
 * application credentials and the setup token never are.
 */
export function getPinchSandboxSetupConfig(
  environment: Environment = process.env,
): PinchSandboxSetupConfig {
  const runtime = getPinchRuntimeConfig(environment);
  const readiness = getPinchReadiness(runtime);
  const publishableKey = clean(environment.PINCH_PUBLISHABLE_KEY);
  const operatorToken = clean(environment.RUNWAY_SANDBOX_SETUP_TOKEN);
  const operatorEmail = clean(environment.RUNWAY_SANDBOX_OPERATOR_EMAIL)?.toLowerCase();

  if (environment.RUNWAY_ENABLE_SANDBOX_SETUP_UI !== "1") {
    return { enabled: false, reason: "Sandbox setup UI is disabled." };
  }
  if (readiness.state !== "ready") {
    return { enabled: false, reason: readiness.display_label };
  }
  if (!publishableKey?.startsWith("pk_test_")) {
    return {
      enabled: false,
      reason: "A Pinch test publishable key is required for browser tokenisation.",
    };
  }
  if (!operatorToken) {
    return { enabled: false, reason: "Sandbox setup operator token is not configured." };
  }

  return {
    enabled: true,
    reason: "Sandbox setup is enabled for a guarded local test workflow.",
    publishable_key: publishableKey,
    operator_token: operatorToken,
    operator_email: operatorEmail,
  };
}

/** Does a timing-resistant comparison without a Node-only Buffer dependency. */
export function matchesSandboxSetupToken(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!provided || !expected) return false;

  const length = Math.max(provided.length, expected.length);
  let difference = provided.length ^ expected.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (provided.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function nextBusinessDate(from: Date = new Date()): string {
  const candidate = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );

  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.toISOString().slice(0, 10);
}

export function timeTravelAt(
  transactionDate: string,
  step: PinchTimeTravelStep,
): string {
  if (!isIsoCalendarDate(transactionDate)) {
    throw new Error("A valid scheduled Payment date is required for time travel.");
  }

  const date = new Date(`${transactionDate}T10:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);

  if (step === "settle") {
    let businessDaysAdded = 0;
    while (businessDaysAdded < 3) {
      date.setUTCDate(date.getUTCDate() + 1);
      if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) businessDaysAdded += 1;
    }
  }

  return date.toISOString();
}

export function sandboxPaymentDescription(key: RunwaySandboxPayerKey): string {
  return `${RUNWAY_SANDBOX_PAYMENT_DESCRIPTION_PREFIX} ${key} direct-debit history probe`;
}

export function isExpectedSandboxPayment(
  payment: Record<string, unknown>,
  payerId: string,
): boolean {
  const embeddedPayer = isRecord(payment.payer) ? payment.payer : undefined;
  const paymentPayerId = stringValue(payment.payerId) ?? stringValue(embeddedPayer?.id);
  const description = stringValue(payment.description);

  return (
    paymentPayerId === payerId &&
    typeof description === "string" &&
    description.startsWith(RUNWAY_SANDBOX_PAYMENT_DESCRIPTION_PREFIX)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
