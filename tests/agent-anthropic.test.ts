import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoopLimitError,
  runAnthropicAgentTurn,
} from "../lib/agent/anthropic.server.ts";
import type { AgentToolDefinition } from "../lib/agent/contracts.ts";

const tools: AgentToolDefinition[] = [
  {
    name: "get_financial_snapshot",
    description: "Read the current deterministic financial snapshot.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("sends bounded transcript and returns a final grounded response", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const fetchStub: typeof fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    return jsonResponse({
      content: [{ type: "text", text: "Cash is $4,200." }],
      stop_reason: "end_turn",
    });
  };

  const result = await runAnthropicAgentTurn(
    {
      message: "How much cash is there?",
      transcript: [
        { role: "user", content: "old-1" },
        { role: "assistant", content: "old-2" },
        { role: "user", content: "recent-1" },
        { role: "assistant", content: "recent-2" },
      ],
    },
    {
      apiKey: "test-key",
      model: "claude-test",
      tools,
      executeTool: async () => ({ content: {}, provenance: "live" }),
      fetch: fetchStub,
      maxTranscriptMessages: 2,
    },
  );

  assert.equal(result.text, "Cash is $4,200.");
  assert.equal(result.iterations, 1);
  assert.deepEqual(
    (requestBodies[0]?.messages as { content: string }[]).map(
      (message) => message.content,
    ),
    ["recent-1", "recent-2", "How much cash is there?"],
  );
});

test("executes requested tools and returns provenance to Anthropic", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  let responseNumber = 0;
  const fetchStub: typeof fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    responseNumber += 1;
    if (responseNumber === 1) {
      return jsonResponse({
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "get_financial_snapshot",
            input: { include_forecast: true },
          },
        ],
        stop_reason: "tool_use",
      });
    }
    return jsonResponse({
      content: [{ type: "text", text: "You have a cash squeeze next week." }],
      stop_reason: "end_turn",
    });
  };

  const seen: unknown[] = [];
  const result = await runAnthropicAgentTurn(
    { message: "Check runway", transcript: [] },
    {
      apiKey: "test-key",
      model: "claude-test",
      tools,
      executeTool: async (request) => {
        seen.push(request);
        return {
          content: { cash_cents: 420_000 },
          provenance: "live",
          provider_id: "snapshot-1",
        };
      },
      fetch: fetchStub,
    },
  );

  assert.deepEqual(seen, [
    {
      id: "tool-1",
      name: "get_financial_snapshot",
      input: { include_forecast: true },
    },
  ]);
  assert.equal(result.iterations, 2);
  assert.equal(result.tool_requests.length, 1);
  const secondMessages = requestBodies[1]?.messages as {
    role: string;
    content: unknown;
  }[];
  const resultContent = (
    secondMessages.at(-1)?.content as { content: string }[]
  )[0]?.content;
  assert.deepEqual(JSON.parse(resultContent), {
    data: { cash_cents: 420_000 },
    provenance: "live",
    provider_id: "snapshot-1",
  });
});

test("stops a model that keeps requesting tools", async () => {
  let calls = 0;
  const fetchStub: typeof fetch = async () => {
    calls += 1;
    return jsonResponse({
      content: [
        {
          type: "tool_use",
          id: `tool-${calls}`,
          name: "get_financial_snapshot",
          input: {},
        },
      ],
      stop_reason: "tool_use",
    });
  };

  await assert.rejects(
    runAnthropicAgentTurn(
      { message: "loop", transcript: [] },
      {
        apiKey: "test-key",
        model: "claude-test",
        tools,
        executeTool: async () => ({ content: {}, provenance: "live" }),
        fetch: fetchStub,
        maxIterations: 2,
      },
    ),
    AgentLoopLimitError,
  );
  assert.equal(calls, 2);
});
