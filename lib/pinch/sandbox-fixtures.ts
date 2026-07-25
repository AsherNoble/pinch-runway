/**
 * Fixed, clearly labelled records used only to establish real Pinch test data.
 * These names and emails are never presented as customer data in the product.
 */
export const RUNWAY_SANDBOX_TEST_PAYERS = [
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

export type RunwaySandboxPayerKey = (typeof RUNWAY_SANDBOX_TEST_PAYERS)[number]["key"];

export const RUNWAY_SANDBOX_PAYMENT_DESCRIPTION_PREFIX = "[RUNWAY-G3-SANDBOX]";

export function getRunwaySandboxTestPayer(
  key: RunwaySandboxPayerKey,
): (typeof RUNWAY_SANDBOX_TEST_PAYERS)[number] {
  const payer = RUNWAY_SANDBOX_TEST_PAYERS.find((candidate) => candidate.key === key);
  if (!payer) throw new Error(`Unknown Runway sandbox Payer key: ${key}.`);
  return payer;
}

export function isRunwaySandboxPayerKey(value: unknown): value is RunwaySandboxPayerKey {
  return (
    typeof value === "string" &&
    RUNWAY_SANDBOX_TEST_PAYERS.some((candidate) => candidate.key === value)
  );
}
