import assert from "node:assert/strict";
import test from "node:test";
import {
  BasiqClient,
  BasiqError,
  classifyAccount,
  decimalToCents,
  jobComplete,
  normaliseTransaction,
} from "../lib/basiq/client.ts";
import type { BasiqConfig } from "../lib/basiq/config.ts";

const config: BasiqConfig = {
  api_key: "api-key-verbatim",
  base_url: "https://au-api.basiq.io",
  api_version: "3.0",
  consent_url: "https://consent.basiq.io/home",
  request_timeout_ms: 1_000,
};

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("Basiq authenticates with the verbatim key, caches SERVER_ACCESS, and paginates", async () => {
  let tokenCalls = 0;
  const visited: string[] = [];
  const client = new BasiqClient(config, async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    visited.push(url.toString());
    if (url.pathname === "/token") {
      tokenCalls += 1;
      assert.equal(new Headers(init?.headers).get("authorization"), "Basic api-key-verbatim");
      assert.equal(new Headers(init?.headers).get("basiq-version"), "3.0");
      return json({ access_token: "server-token", expires_in: 3600 });
    }
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer server-token");
    if (url.searchParams.get("page") === "2") {
      return json({
        data: [{
          id: "txn-2",
          account: "https://au-api.basiq.io/users/u/accounts/a1",
          description: "Hosting",
          amount: "-20.00",
          direction: "debit",
          status: "posted",
          postDate: "2026-07-20",
          class: "software",
        }],
        links: {},
      });
    }
    return json({
      data: [{
        id: "txn-1",
        account: "https://au-api.basiq.io/users/u/accounts/a1",
        description: "Rent",
        amount: "-100.00",
        direction: "debit",
        status: "posted",
        postDate: "2026-07-19",
        class: "rent",
      }],
      links: {
        next: "https://au-api.basiq.io/users/u/transactions?limit=500&page=2",
      },
    });
  });

  const transactions = await client.listTransactions("u");
  assert.equal(tokenCalls, 1);
  assert.deepEqual(transactions.map((item) => item.id), ["txn-1", "txn-2"]);
  assert.equal(visited.filter((url) => url.includes("/transactions")).length, 2);
});

test("Basiq cents and account classes preserve cash/liability semantics", () => {
  assert.equal(decimalToCents("12.345"), 1235);
  assert.equal(decimalToCents("-367576.75"), -36_757_675);
  assert.deepEqual(classifyAccount({ type: "transaction" }), {
    account_class: "transaction",
    cash_role: "operating_cash",
  });
  assert.deepEqual(classifyAccount({ type: "credit-card" }), {
    account_class: "credit-card",
    cash_role: "liability",
  });
});

test("Basiq transaction normalisation separates pending status and debit direction", () => {
  assert.deepEqual(
    normaliseTransaction({
      id: "pending-1",
      account: "https://au-api.basiq.io/users/u/accounts/a1",
      description: "Pending fuel",
      amount: "-45.12",
      direction: "debit",
      status: "pending",
      postDate: "2026-07-26T00:00:00Z",
      class: { type: "transport" },
    }),
    {
      id: "pending-1",
      account_id: "a1",
      description: "Pending fuel",
      amount_cents: 4512,
      direction: "debit",
      status: "pending",
      post_date: "2026-07-26",
      transaction_class: "transport",
    },
  );
});

test("Basiq jobs complete only when every asynchronous step succeeds", () => {
  assert.equal(jobComplete({
    id: "job-1",
    steps: [
      { title: "accounts", status: "success", result: null },
      { title: "transactions", status: "success", result: null },
    ],
  }), true);
  assert.equal(jobComplete({
    id: "job-2",
    steps: [{ title: "transactions", status: "in-progress", result: null }],
  }), false);
});

test("Basiq errors are structured and never include the upstream body or credentials", async () => {
  const client = new BasiqClient(config, async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.pathname === "/token") {
      return json({ access_token: "server-token", expires_in: 3600 });
    }
    return json(
      { detail: "api-key-verbatim and raw account 123456789" },
      500,
      { "x-request-id": "req-safe" },
    );
  });
  await assert.rejects(
    client.listAccounts("u"),
    (error: unknown) => {
      assert.ok(error instanceof BasiqError);
      assert.equal(error.status, 500);
      assert.equal(error.retryable, true);
      assert.equal(error.request_id, "req-safe");
      assert.doesNotMatch(error.message, /api-key|123456789/);
      return true;
    },
  );
});
