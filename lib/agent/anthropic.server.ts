import type {
  AgentToolDefinition,
  AgentToolRequest,
  AgentToolResult,
  AgentTranscriptMessage,
} from "./contracts.ts";
import { RUNWAY_AGENT_SYSTEM_PROMPT } from "./charter.ts";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
}

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | readonly unknown[];
};

export interface AnthropicAgentOptions {
  apiKey: string;
  model: string;
  tools: readonly AgentToolDefinition[];
  executeTool: (request: AgentToolRequest) => Promise<AgentToolResult>;
  fetch?: typeof globalThis.fetch;
  systemPrompt?: string;
  maxIterations?: number;
  maxTranscriptMessages?: number;
  maxTokens?: number;
}

export interface AnthropicAgentTurn {
  message: string;
  transcript: readonly AgentTranscriptMessage[];
}

export interface AnthropicAgentResult {
  text: string;
  tool_requests: readonly AgentToolRequest[];
  iterations: number;
}

export class AgentLoopLimitError extends Error {
  constructor(limit: number) {
    super(`Anthropic tool loop exceeded the ${limit}-iteration limit`);
    this.name = "AgentLoopLimitError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResponse(value: unknown): AnthropicResponse {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new Error("Anthropic returned an invalid Messages response");
  }

  const content: AnthropicContentBlock[] = value.content.map((block) => {
    if (!isRecord(block)) {
      throw new Error("Anthropic returned an invalid content block");
    }
    if (block.type === "text" && typeof block.text === "string") {
      return { type: "text", text: block.text };
    }
    if (
      block.type === "tool_use" &&
      typeof block.id === "string" &&
      typeof block.name === "string"
    ) {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      };
    }
    throw new Error("Anthropic returned an unsupported content block");
  });

  return {
    content,
    stop_reason:
      typeof value.stop_reason === "string" ? value.stop_reason : null,
  };
}

function toolRequest(
  block: AnthropicToolUseBlock,
  tools: readonly AgentToolDefinition[],
): AgentToolRequest {
  const definition = tools.find((candidate) => candidate.name === block.name);
  if (!definition) {
    throw new Error(`Anthropic requested unknown tool "${block.name}"`);
  }
  if (!isRecord(block.input)) {
    throw new Error(`Anthropic tool "${block.name}" input must be an object`);
  }
  return {
    id: block.id,
    name: definition.name,
    input: block.input,
  };
}

function toolResultBlock(
  request: AgentToolRequest,
  result: AgentToolResult,
): Record<string, unknown> {
  return {
    type: "tool_result",
    tool_use_id: request.id,
    content: JSON.stringify({
      data: result.content,
      provenance: result.provenance,
      provider_id: result.provider_id,
    }),
    ...(result.is_error ? { is_error: true } : {}),
  };
}

export async function runAnthropicAgentTurn(
  turn: AnthropicAgentTurn,
  options: AnthropicAgentOptions,
): Promise<AnthropicAgentResult> {
  if (!options.apiKey.trim()) throw new Error("Anthropic API key is required");
  if (!options.model.trim()) throw new Error("Anthropic model is required");
  if (!turn.message.trim()) throw new Error("Agent message is required");

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const maxIterations = options.maxIterations ?? 6;
  const transcriptLimit = options.maxTranscriptMessages ?? 8;
  if (!Number.isSafeInteger(maxIterations) || maxIterations <= 0) {
    throw new Error("maxIterations must be a positive integer");
  }

  const messages: AnthropicMessage[] = [
    ...turn.transcript.slice(-transcriptLimit).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: "user" as const, content: turn.message },
  ];
  const requests: AgentToolRequest[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": options.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens ?? 1_024,
        system: options.systemPrompt ?? RUNWAY_AGENT_SYSTEM_PROMPT,
        messages,
        tools: options.tools,
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        `Anthropic Messages request failed (${response.status}): ${detail}`,
      );
    }

    const parsed = parseResponse(await response.json());
    const toolBlocks = parsed.content.filter(
      (block): block is AnthropicToolUseBlock => block.type === "tool_use",
    );
    const text = parsed.content
      .filter((block): block is AnthropicTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (toolBlocks.length === 0) {
      return { text, tool_requests: requests, iterations: iteration };
    }

    messages.push({ role: "assistant", content: parsed.content });
    const resultBlocks: Record<string, unknown>[] = [];
    for (const block of toolBlocks) {
      const request = toolRequest(block, options.tools);
      requests.push(request);
      const result = await options.executeTool(request);
      resultBlocks.push(toolResultBlock(request, result));
    }
    messages.push({ role: "user", content: resultBlocks });
  }

  throw new AgentLoopLimitError(maxIterations);
}
