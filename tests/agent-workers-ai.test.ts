import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoopLimitError,
  ModelResponseError,
  runAgentModelTurn,
} from "../lib/agent/model.ts";
import {
  createWorkersAiModel,
  WORKERS_AI_MODEL,
  WorkersAiInferenceError,
  type WorkersAiBinding,
} from "../lib/agent/workers-ai.server.ts";
import type { AgentToolDefinition } from "../lib/agent/contracts.ts";

const tools: AgentToolDefinition[] = [
  {
    name: "get_financial_snapshot",
    description: "Read the current deterministic financial snapshot.",
    input_schema: {
      type: "object",
      properties: {
        include_forecast: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
];

function completion(input: {
  content?: string | null;
  toolCalls?: readonly {
    id: string;
    name: string;
    arguments: string;
  }[];
  finishReason?: "stop" | "tool_calls";
}): unknown {
  const toolCalls = input.toolCalls ?? [];
  return {
    id: "completion-test",
    object: "chat.completion",
    created: 1,
    model: WORKERS_AI_MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: input.content ?? null,
          ...(toolCalls.length
            ? {
                tool_calls: toolCalls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments: call.arguments,
                  },
                })),
              }
            : {}),
        },
        finish_reason:
          input.finishReason ?? (toolCalls.length ? "tool_calls" : "stop"),
        logprobs: null,
      },
    ],
  };
}

function fakeAi(
  handler: (
    model: typeof WORKERS_AI_MODEL,
    input: Parameters<WorkersAiBinding["run"]>[1],
  ) => unknown | Promise<unknown>,
): WorkersAiBinding {
  return {
    async run(model, input) {
      return handler(model, input);
    },
  };
}

test("Workers AI returns direct answers with a bounded transcript", async () => {
  const requests: Parameters<WorkersAiBinding["run"]>[1][] = [];
  const ai = fakeAi((model, input) => {
    assert.equal(model, WORKERS_AI_MODEL);
    requests.push(input);
    return completion({ content: "Cash is $4,200." });
  });

  const result = await runAgentModelTurn(
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
      model: createWorkersAiModel(ai),
      tools,
      executeTool: async () => ({ content: {}, provenance: "live" }),
      maxTranscriptMessages: 2,
    },
  );

  assert.equal(result.text, "Cash is $4,200.");
  assert.equal(result.iterations, 1);
  assert.match(String(requests[0]?.messages[0]?.content), /financial/);
  assert.deepEqual(
    requests[0]?.messages.slice(1).map((message) => message.content),
    ["recent-1", "recent-2", "How much cash is there?"],
  );
  assert.equal(requests[0]?.parallel_tool_calls, false);
  assert.equal(requests[0]?.max_completion_tokens, 1_024);
  assert.deepEqual(requests[0]?.tools[0], {
    type: "function",
    function: {
      name: "get_financial_snapshot",
      description: "Read the current deterministic financial snapshot.",
      parameters: tools[0]?.input_schema,
    },
  });
});

test("Workers AI executes multi-turn tools sequentially and returns provenance", async () => {
  const requests: Parameters<WorkersAiBinding["run"]>[1][] = [];
  let call = 0;
  const ai = fakeAi((_model, input) => {
    requests.push(input);
    call += 1;
    if (call === 1) {
      return completion({
        toolCalls: [
          {
            id: "tool-1",
            name: "get_financial_snapshot",
            arguments: '{"include_forecast":true}',
          },
        ],
      });
    }
    return completion({
      content: "You have a cash squeeze next week.",
    });
  });
  const seen: unknown[] = [];

  const result = await runAgentModelTurn(
    { message: "Check runway", transcript: [] },
    {
      model: createWorkersAiModel(ai),
      tools,
      executeTool: async (request) => {
        seen.push(request);
        return {
          content: { cash_cents: 420_000 },
          provenance: "live",
          provider_id: "snapshot-1",
        };
      },
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
  const toolMessage = requests[1]?.messages.at(-1);
  assert.equal(toolMessage?.role, "tool");
  assert.deepEqual(JSON.parse(String(toolMessage?.content)), {
    data: { cash_cents: 420_000 },
    provenance: "live",
    provider_id: "snapshot-1",
  });
});

test("Workers AI rejects malformed responses and tool arguments", async (t) => {
  await t.test("invalid completion shape", async () => {
    await assert.rejects(
      runAgentModelTurn(
        { message: "hello", transcript: [] },
        {
          model: createWorkersAiModel(fakeAi(() => ({ choices: [] }))),
          tools,
          executeTool: async () => ({ content: {}, provenance: "live" }),
        },
      ),
      ModelResponseError,
    );
  });

  await t.test("malformed JSON arguments", async () => {
    await assert.rejects(
      runAgentModelTurn(
        { message: "hello", transcript: [] },
        {
          model: createWorkersAiModel(
            fakeAi(() =>
              completion({
                toolCalls: [
                  {
                    id: "tool-bad-json",
                    name: "get_financial_snapshot",
                    arguments: "{",
                  },
                ],
              }),
            ),
          ),
          tools,
          executeTool: async () => ({ content: {}, provenance: "live" }),
        },
      ),
      /malformed JSON arguments/,
    );
  });

  await t.test("schema-invalid arguments", async () => {
    await assert.rejects(
      runAgentModelTurn(
        { message: "hello", transcript: [] },
        {
          model: createWorkersAiModel(
            fakeAi(() =>
              completion({
                toolCalls: [
                  {
                    id: "tool-bad-schema",
                    name: "get_financial_snapshot",
                    arguments: '{"include_forecast":"yes"}',
                  },
                ],
              }),
            ),
          ),
          tools,
          executeTool: async () => ({ content: {}, provenance: "live" }),
        },
      ),
      /must be a boolean/,
    );
  });

  await t.test("unknown tool", async () => {
    await assert.rejects(
      runAgentModelTurn(
        { message: "hello", transcript: [] },
        {
          model: createWorkersAiModel(
            fakeAi(() =>
              completion({
                toolCalls: [
                  {
                    id: "tool-unknown",
                    name: "move_money",
                    arguments: "{}",
                  },
                ],
              }),
            ),
          ),
          tools,
          executeTool: async () => ({ content: {}, provenance: "live" }),
        },
      ),
      /unknown tool "move_money"/,
    );
  });
});

test("Workers AI wraps binding inference failures", async () => {
  await assert.rejects(
    runAgentModelTurn(
      { message: "hello", transcript: [] },
      {
        model: createWorkersAiModel(
          fakeAi(() => {
            throw new Error("quota exhausted");
          }),
        ),
        tools,
        executeTool: async () => ({ content: {}, provenance: "live" }),
      },
    ),
    WorkersAiInferenceError,
  );
});

test("Workers AI stops a model that keeps requesting tools", async () => {
  let calls = 0;
  const ai = fakeAi(() => {
    calls += 1;
    return completion({
      toolCalls: [
        {
          id: `tool-${calls}`,
          name: "get_financial_snapshot",
          arguments: "{}",
        },
      ],
    });
  });

  await assert.rejects(
    runAgentModelTurn(
      { message: "loop", transcript: [] },
      {
        model: createWorkersAiModel(ai),
        tools,
        executeTool: async () => ({ content: {}, provenance: "live" }),
        maxIterations: 2,
      },
    ),
    AgentLoopLimitError,
  );
  assert.equal(calls, 2);
});
