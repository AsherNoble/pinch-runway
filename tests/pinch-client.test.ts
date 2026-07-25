import assert from "node:assert/strict";
import test from "node:test";
import {
  PinchSandboxClient,
  resetPinchAccessTokenCacheForTests,
} from "../lib/pinch/client.ts";
import { getPinchReadiness, getPinchRuntimeConfig } from "../lib/pinch/config.ts";

const config = getPinchRuntimeConfig({
  RUNWAY_DATA_SOURCE: "sandbox",
  PINCH_APPLICATION_ID: "app_test",
  PINCH_SECRET_KEY: "secret_test",
  PINCH_API_BASE_URL: "https://api.getpinch.com.au/test/",
});

test("sandbox readiness never treats missing credentials as connected", () => {
  const readiness = getPinchReadiness(
    getPinchRuntimeConfig({ RUNWAY_DATA_SOURCE: "sandbox" }),
  );

  assert.equal(readiness.state, "not_configured");
  assert.equal(readiness.data_source, "sandbox");
});

test("Pinch client authenticates server-side and lists Payers", async () => {
  resetPinchAccessTokenCacheForTests();
  const requests: Request[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);

    if (request.url === "https://auth.getpinch.com.au/connect/token") {
      assert.match(request.headers.get("authorization") ?? "", /^Basic /);
      assert.equal(request.headers.get("content-type"), "application/x-www-form-urlencoded");
      assert.equal(await request.text(), "grant_type=client_credentials&scope=api1");
      return Response.json({ access_token: "access_token", expires_in: 3600 });
    }

    assert.equal(request.url, "https://api.getpinch.com.au/test/payers?page=1&pageSize=1");
    assert.equal(request.headers.get("authorization"), "Bearer access_token");
    assert.equal(request.headers.get("pinch-version"), "2020.1");
    return Response.json({ payers: [{ id: "pyr_001", name: "Sandbox Payer" }] });
  };

  const client = new PinchSandboxClient(config, mockFetch);
  const payers = await client.listPayers({ page: 1, page_size: 1 });

  assert.deepEqual(payers, [{ id: "pyr_001", name: "Sandbox Payer" }]);
  assert.equal(requests.length, 2);
});

test("Pinch client creates a Payer only on the test API", async () => {
  resetPinchAccessTokenCacheForTests();
  const mockFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === "https://auth.getpinch.com.au/connect/token") {
      return Response.json({ access_token: "access_token", expires_in: 3600 });
    }

    assert.equal(request.url, "https://api.getpinch.com.au/test/payers");
    assert.equal(request.method, "POST");
    assert.deepEqual(await request.json(), {
      firstName: "Runway",
      lastName: "Sandbox Reliable",
      emailAddress: "runway-sandbox-reliable@example.com",
    });
    return Response.json({
      id: "pyr_001",
      firstName: "Runway",
      lastName: "Sandbox Reliable",
      email: "runway-sandbox-reliable@example.com",
    });
  };

  const client = new PinchSandboxClient(config, mockFetch);
  const payer = await client.createPayer({
    first_name: "Runway",
    last_name: "Sandbox Reliable",
    email_address: "runway-sandbox-reliable@example.com",
  });

  assert.deepEqual(payer, {
    id: "pyr_001",
    first_name: "Runway",
    last_name: "Sandbox Reliable",
    email_address: "runway-sandbox-reliable@example.com",
  });
});

test("Pinch client creates a Payment Link and tolerates amountInCents", async () => {
  resetPinchAccessTokenCacheForTests();
  const mockFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === "https://auth.getpinch.com.au/connect/token") {
      return Response.json({ access_token: "access_token", expires_in: 3600 });
    }

    assert.equal(request.url, "https://api.getpinch.com.au/test/payment-links");
    assert.equal(request.method, "POST");
    assert.deepEqual(await request.json(), {
      amount: 50_000,
      payerId: "pyr_001",
      description: "Invoice INV-123",
      allowedPaymentMethods: ["credit-card", "bank-account"],
      returnUrl: "https://demo.example/payment-return",
      currency: "AUD",
      metadata: { sourcePaymentId: "pay_001" },
    });
    return Response.json({
      id: "plk_001",
      amountInCents: 50_000,
      url: "https://pay.getpinch.com.au/pay/plk_001",
      payer: { id: "pyr_001" },
    });
  };

  const client = new PinchSandboxClient(config, mockFetch);
  const result = await client.createPaymentLink({
    amount: 50_000,
    payer_id: "pyr_001",
    description: "Invoice INV-123",
    return_url: "https://demo.example/payment-return",
    allowed_payment_methods: ["credit-card", "bank-account"],
    metadata: { sourcePaymentId: "pay_001" },
  });

  assert.deepEqual(result, {
    id: "plk_001",
    amount: 50_000,
    url: "https://pay.getpinch.com.au/pay/plk_001",
    payer_id: "pyr_001",
    raw_status: undefined,
  });
});
