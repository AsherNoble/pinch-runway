import type { AgentToolDefinition } from "./contracts.ts";
import type {
  AgentModel,
  ModelCompletion,
  ModelCompletionRequest,
  ModelMessage,
  ModelToolCall,
} from "./model.ts";
import { ModelResponseError } from "./model.ts";

export const WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash" as const;

export type WorkersAiMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: readonly {
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }[];
    }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
    };

export interface WorkersAiRunInput {
  messages: readonly WorkersAiMessage[];
  tools: readonly {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: AgentToolDefinition["input_schema"];
    };
  }[];
  max_completion_tokens: number;
  parallel_tool_calls: false;
  temperature: 0;
}

export interface WorkersAiBinding {
  run(
    model: typeof WORKERS_AI_MODEL,
    input: WorkersAiRunInput,
  ): Promise<unknown>;
}

export class WorkersAiBindingError extends Error {
  constructor(
    message = "Cloudflare Workers AI binding and configured gateway are unavailable",
  ) {
    super(message);
    this.name = "WorkersAiBindingError";
  }
}

export class WorkersAiGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkersAiGatewayError";
  }
}

export class WorkersAiInferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkersAiInferenceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_GATEWAY_RESPONSE_BYTES = 256 * 1_024;
const GATEWAY_TIMEOUT_MS = 30_000;

async function readBoundedGatewayResponse(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_GATEWAY_RESPONSE_BYTES
  ) {
    throw new WorkersAiGatewayError("Workers AI gateway response was too large");
  }
  if (!response.body) {
    throw new WorkersAiGatewayError("Workers AI gateway returned no response");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_GATEWAY_RESPONSE_BYTES) {
      await reader.cancel();
      throw new WorkersAiGatewayError(
        "Workers AI gateway response was too large",
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new WorkersAiGatewayError(
      "Workers AI gateway returned invalid JSON",
    );
  }
}

export function createWorkersAiGatewayBinding(input: {
  url: string;
  token: string;
  fetcher?: typeof fetch;
}): WorkersAiBinding {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new WorkersAiBindingError("Workers AI gateway URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw new WorkersAiBindingError(
      "Workers AI gateway URL must be a plain HTTPS endpoint",
    );
  }
  const token = input.token.trim();
  if (token.length < 32) {
    throw new WorkersAiBindingError("Workers AI gateway token is invalid");
  }
  const fetcher = input.fetcher ?? fetch;

  return {
    async run(model, runInput) {
      const response = await fetcher(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ model, input: runInput }),
        signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new WorkersAiGatewayError(
          `Workers AI gateway request failed with status ${response.status}`,
        );
      }
      return readBoundedGatewayResponse(response);
    },
  };
}

function parseToolCall(value: unknown): ModelToolCall {
  if (
    !isRecord(value) ||
    value.type !== "function" ||
    typeof value.id !== "string" ||
    !isRecord(value.function) ||
    typeof value.function.name !== "string" ||
    typeof value.function.arguments !== "string"
  ) {
    throw new ModelResponseError(
      "Workers AI returned a malformed function call",
    );
  }
  return {
    id: value.id,
    name: value.function.name,
    arguments: value.function.arguments,
  };
}

function parseCompletion(value: unknown): ModelCompletion {
  if (
    !isRecord(value) ||
    !Array.isArray(value.choices) ||
    value.choices.length !== 1
  ) {
    throw new ModelResponseError(
      "Workers AI returned an invalid chat completion",
    );
  }

  const choice = value.choices[0];
  if (
    !isRecord(choice) ||
    !isRecord(choice.message) ||
    choice.message.role !== "assistant"
  ) {
    throw new ModelResponseError(
      "Workers AI returned an invalid assistant message",
    );
  }
  if (
    choice.message.content !== null &&
    typeof choice.message.content !== "string"
  ) {
    throw new ModelResponseError(
      "Workers AI returned invalid assistant content",
    );
  }
  if (
    choice.finish_reason !== "stop" &&
    choice.finish_reason !== "tool_calls"
  ) {
    throw new ModelResponseError(
      `Workers AI returned unsupported finish reason "${String(choice.finish_reason)}"`,
    );
  }

  const rawToolCalls = choice.message.tool_calls;
  if (rawToolCalls !== undefined && !Array.isArray(rawToolCalls)) {
    throw new ModelResponseError("Workers AI returned invalid tool calls");
  }
  const toolCalls = (rawToolCalls ?? []).map(parseToolCall);
  if (
    (choice.finish_reason === "tool_calls" && toolCalls.length === 0) ||
    (choice.finish_reason === "stop" && toolCalls.length > 0)
  ) {
    throw new ModelResponseError(
      "Workers AI finish reason did not match its tool calls",
    );
  }

  return {
    text: choice.message.content ?? "",
    toolCalls,
  };
}

function openAiMessage(message: ModelMessage): WorkersAiMessage {
  if (message.role === "assistant") {
    return {
      role: message.role,
      content: message.content,
      ...(message.tool_calls
        ? {
            tool_calls: message.tool_calls.map((call) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: call.arguments,
              },
            })),
          }
        : {}),
    };
  }
  if (message.role === "tool") {
    return {
      role: message.role,
      content: message.content,
      tool_call_id: message.tool_call_id,
    };
  }
  return message;
}

function openAiTools(tools: readonly AgentToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

export function createWorkersAiModel(ai: WorkersAiBinding): AgentModel {
  return {
    async complete(
      request: ModelCompletionRequest,
    ): Promise<ModelCompletion> {
      let response: unknown;
      try {
        response = await ai.run(WORKERS_AI_MODEL, {
          messages: request.messages.map(openAiMessage),
          tools: openAiTools(request.tools),
          max_completion_tokens: request.maxTokens,
          parallel_tool_calls: request.parallelToolCalls,
          temperature: 0,
        });
      } catch (error) {
        throw new WorkersAiInferenceError(
          error instanceof Error
            ? `Workers AI inference failed: ${error.message}`
            : "Workers AI inference failed",
        );
      }
      return parseCompletion(response);
    },
  };
}

export async function getWorkersAiBinding(): Promise<WorkersAiBinding> {
  const { env } = await import("cloudflare:workers");
  if (env.AI && typeof env.AI.run === "function") {
    return env.AI;
  }

  const gatewayUrl = process.env.WORKERS_AI_GATEWAY_URL?.trim();
  const gatewayToken = process.env.WORKERS_AI_GATEWAY_TOKEN?.trim();
  if (gatewayUrl && gatewayToken) {
    return createWorkersAiGatewayBinding({
      url: gatewayUrl,
      token: gatewayToken,
    });
  }
  throw new WorkersAiBindingError();
}
