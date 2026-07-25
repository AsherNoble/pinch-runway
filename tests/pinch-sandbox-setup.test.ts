import assert from "node:assert/strict";
import test from "node:test";
import {
  getPinchSandboxSetupConfig,
  isExpectedSandboxPayment,
  matchesSandboxSetupToken,
  nextBusinessDate,
  timeTravelAt,
} from "../lib/pinch/sandbox-setup.ts";

const configuredSandboxEnvironment = {
  RUNWAY_DATA_SOURCE: "sandbox",
  PINCH_APPLICATION_ID: "app_test",
  PINCH_SECRET_KEY: "secret_test",
  PINCH_API_BASE_URL: "https://api.getpinch.com.au/test/",
  PINCH_PUBLISHABLE_KEY: "pk_test_example",
  RUNWAY_ENABLE_SANDBOX_SETUP_UI: "1",
  RUNWAY_SANDBOX_SETUP_TOKEN: "operator-token",
};

test("sandbox setup stays off unless explicitly enabled with a test publishable key", () => {
  const disabled = getPinchSandboxSetupConfig({
    ...configuredSandboxEnvironment,
    RUNWAY_ENABLE_SANDBOX_SETUP_UI: "0",
  });
  const wrongKey = getPinchSandboxSetupConfig({
    ...configuredSandboxEnvironment,
    PINCH_PUBLISHABLE_KEY: "pk_live_not_allowed",
  });
  const enabled = getPinchSandboxSetupConfig(configuredSandboxEnvironment);

  assert.equal(disabled.enabled, false);
  assert.equal(wrongKey.enabled, false);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.publishable_key, "pk_test_example");
  assert.equal(enabled.operator_token, "operator-token");
});

test("sandbox setup dates only derive business-day time-travel windows", () => {
  assert.equal(nextBusinessDate(new Date("2026-07-25T12:00:00.000Z")), "2026-07-27");
  assert.equal(timeTravelAt("2026-07-27", "next_morning"), "2026-07-28T10:00:00.000Z");
  assert.equal(timeTravelAt("2026-07-27", "settle"), "2026-07-31T10:00:00.000Z");
});

test("sandbox setup restricts mutations to the labelled Payer and operator token", () => {
  assert.equal(matchesSandboxSetupToken("operator-token", "operator-token"), true);
  assert.equal(matchesSandboxSetupToken("operator-token", "wrong-token"), false);
  assert.equal(matchesSandboxSetupToken(undefined, "operator-token"), false);
  assert.equal(
    isExpectedSandboxPayment(
      {
        payerId: "pyr_001",
        description: "[RUNWAY-G3-SANDBOX] reliable direct-debit history probe",
      },
      "pyr_001",
    ),
    true,
  );
  assert.equal(
    isExpectedSandboxPayment(
      { payerId: "pyr_002", description: "Any unrelated Payment" },
      "pyr_001",
    ),
    false,
  );
});
