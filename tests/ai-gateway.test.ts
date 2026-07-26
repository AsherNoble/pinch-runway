import assert from "node:assert/strict";
import test from "node:test";

import {
  handleGatewayRequest,
} from "../workers/ai-gateway/index.ts";
import {
  createWorkersAiGatewayBinding,
  WORKERS_AI_MODEL,
  WorkersAiBindingError,
  WorkersAiGatewayError,
  type WorkersAiRunInput,
} from "../lib/agent/workers-ai.server.ts";

const token = "test-gateway-token-with-at-least-32-characters";
const runInput: WorkersAiRunInput = {
  messages: [{ role: "user", content: "What changed?" }],
  tools: [],
  max_completion_tokens: 900,
  parallel_tool_calls: false,
  temperature: 0,
};

function gatewayRequest(input: {
  authorization?: string;
  payload?: unknown;
  method?: string;
  path?: string;
} = {}): Request {
  const body = JSON.stringify(
    input.payload ?? { model: WORKERS_AI_MODEL, input: runInput },
  );
  return new Request(
    `https://gateway.example${input.path ?? "/v1/chat/completions"}`,
    {
      method: input.method ?? "POST",
      headers: {
        "content-type": "application/json",
        ...(input.authorization
          ? { authorization: input.authorization }
          : {}),
      },
      body: input.method === "GET" ? undefined : body,
    },
  );
}

test("gateway authenticates and forwards only the fixed Workers AI model", async () => {
  const seen: unknown[] = [];
  const response = await handleGatewayRequest(
    gatewayRequest({ authorization: `Bearer ${token}` }),
    {
      token,
      run: async (model, input) => {
        seen.push({ model, input });
        return {
          choices: [
            {
              message: { role: "assistant", content: "Grounded answer." },
              finish_reason: "stop",
            },
          ],
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(seen, [{ model: WORKERS_AI_MODEL, input: runInput }]);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(typeof response.headers.get("x-request-id"), "string");
});

test("gateway rejects missing authentication without invoking inference", async () => {
  let calls = 0;
  const response = await handleGatewayRequest(gatewayRequest(), {
    token,
    run: async () => {
      calls += 1;
      return {};
    },
  });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("gateway rejects model drift and unsafe inference settings", async (t) => {
  const run = async () => ({});
  await t.test("unknown model", async () => {
    const response = await handleGatewayRequest(
      gatewayRequest({
        authorization: `Bearer ${token}`,
        payload: { model: "@cf/other/model", input: runInput },
      }),
      { token, run },
    );
    assert.equal(response.status, 400);
  });
  await t.test("parallel tools", async () => {
    const response = await handleGatewayRequest(
      gatewayRequest({
        authorization: `Bearer ${token}`,
        payload: {
          model: WORKERS_AI_MODEL,
          input: { ...runInput, parallel_tool_calls: true },
        },
      }),
      { token, run },
    );
    assert.equal(response.status, 400);
  });
  await t.test("excess tokens", async () => {
    const response = await handleGatewayRequest(
      gatewayRequest({
        authorization: `Bearer ${token}`,
        payload: {
          model: WORKERS_AI_MODEL,
          input: { ...runInput, max_completion_tokens: 1_201 },
        },
      }),
      { token, run },
    );
    assert.equal(response.status, 400);
  });
});

test("gateway health endpoint does not require a secret or inference", async () => {
  let calls = 0;
  const response = await handleGatewayRequest(
    gatewayRequest({ method: "GET", path: "/health" }),
    {
      token,
      run: async () => {
        calls += 1;
        return {};
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), {
    ready: true,
    model: WORKERS_AI_MODEL,
  });
});

test("Sites adapter sends authenticated requests and returns completion JSON", async () => {
  const requests: Request[] = [];
  const binding = createWorkersAiGatewayBinding({
    url: "https://gateway.example/v1/chat/completions",
    token,
    fetcher: async (request, init) => {
      requests.push(new Request(request, init));
      return Response.json({ choices: [{ message: {} }] });
    },
  });
  const result = await binding.run(WORKERS_AI_MODEL, runInput);
  assert.deepEqual(result, { choices: [{ message: {} }] });
  assert.equal(requests[0]?.headers.get("authorization"), `Bearer ${token}`);
  assert.deepEqual(await requests[0]?.json(), {
    model: WORKERS_AI_MODEL,
    input: runInput,
  });
});

test("Sites adapter rejects invalid configuration and gateway failures", async () => {
  assert.throws(
    () =>
      createWorkersAiGatewayBinding({
        url: "http://gateway.example",
        token,
      }),
    WorkersAiBindingError,
  );
  const binding = createWorkersAiGatewayBinding({
    url: "https://gateway.example/v1/chat/completions",
    token,
    fetcher: async () => new Response("unavailable", { status: 503 }),
  });
  await assert.rejects(
    binding.run(WORKERS_AI_MODEL, runInput),
    WorkersAiGatewayError,
  );
});
