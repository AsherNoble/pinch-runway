import type {
  AgentToolDefinition,
  AgentToolRequest,
  AgentToolResult,
  AgentTranscriptMessage,
} from "./contracts.ts";
import { RUNWAY_AGENT_SYSTEM_PROMPT } from "./charter.ts";

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ModelMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: readonly ModelToolCall[];
    }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
    };

export interface ModelCompletionRequest {
  messages: readonly ModelMessage[];
  tools: readonly AgentToolDefinition[];
  maxTokens: number;
  parallelToolCalls: false;
}

export interface ModelCompletion {
  text: string;
  toolCalls: readonly ModelToolCall[];
}

export interface AgentModel {
  complete(request: ModelCompletionRequest): Promise<ModelCompletion>;
}

export interface AgentModelOptions {
  model: AgentModel;
  tools: readonly AgentToolDefinition[];
  executeTool: (request: AgentToolRequest) => Promise<AgentToolResult>;
  systemPrompt?: string;
  maxIterations?: number;
  maxTranscriptMessages?: number;
  maxTokens?: number;
  maxResponseCharacters?: number;
}

export interface AgentModelTurn {
  message: string;
  transcript: readonly AgentTranscriptMessage[];
}

export interface AgentModelResult {
  text: string;
  tool_requests: readonly AgentToolRequest[];
  iterations: number;
}

export class AgentLoopLimitError extends Error {
  constructor(limit: number) {
    super(`Model tool loop exceeded the ${limit}-iteration limit`);
    this.name = "AgentLoopLimitError";
  }
}

export class ModelResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelResponseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateToolInput(
  definition: AgentToolDefinition,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new ModelResponseError(
      `Model tool "${definition.name}" arguments must decode to an object`,
    );
  }

  const schema = definition.input_schema;
  const properties = schema.properties ?? {};
  for (const required of schema.required ?? []) {
    if (!(required in value)) {
      throw new ModelResponseError(
        `Model tool "${definition.name}" is missing required argument "${required}"`,
      );
    }
  }

  if (schema.additionalProperties === false) {
    const unknown = Object.keys(value).find((key) => !(key in properties));
    if (unknown) {
      throw new ModelResponseError(
        `Model tool "${definition.name}" included unknown argument "${unknown}"`,
      );
    }
  }

  for (const [key, propertyValue] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (!isRecord(propertySchema) || typeof propertySchema.type !== "string") {
      continue;
    }
    if (
      propertySchema.type === "string" &&
      typeof propertyValue !== "string"
    ) {
      throw new ModelResponseError(
        `Model tool "${definition.name}" argument "${key}" must be a string`,
      );
    }
    if (
      propertySchema.type === "number" &&
      typeof propertyValue !== "number"
    ) {
      throw new ModelResponseError(
        `Model tool "${definition.name}" argument "${key}" must be a number`,
      );
    }
    if (
      propertySchema.type === "boolean" &&
      typeof propertyValue !== "boolean"
    ) {
      throw new ModelResponseError(
        `Model tool "${definition.name}" argument "${key}" must be a boolean`,
      );
    }
  }

  return value;
}

function parseToolRequest(
  call: ModelToolCall,
  tools: readonly AgentToolDefinition[],
): AgentToolRequest {
  const definition = tools.find((candidate) => candidate.name === call.name);
  if (!definition) {
    throw new ModelResponseError(`Model requested unknown tool "${call.name}"`);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(call.arguments);
  } catch {
    throw new ModelResponseError(
      `Model tool "${call.name}" returned malformed JSON arguments`,
    );
  }

  return {
    id: call.id,
    name: definition.name,
    input: validateToolInput(definition, decoded),
  };
}

function toolResultContent(result: AgentToolResult): string {
  return JSON.stringify({
    data: result.content,
    provenance: result.provenance,
    provider_id: result.provider_id,
    ...(result.is_error ? { is_error: true } : {}),
  });
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

export async function runAgentModelTurn(
  turn: AgentModelTurn,
  options: AgentModelOptions,
): Promise<AgentModelResult> {
  if (!turn.message.trim()) throw new Error("Agent message is required");

  const maxIterations = positiveInteger(
    options.maxIterations ?? 6,
    "maxIterations",
  );
  const transcriptLimit = positiveInteger(
    options.maxTranscriptMessages ?? 8,
    "maxTranscriptMessages",
  );
  const maxTokens = positiveInteger(options.maxTokens ?? 1_024, "maxTokens");
  const maxResponseCharacters = positiveInteger(
    options.maxResponseCharacters ?? 3_000,
    "maxResponseCharacters",
  );
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: options.systemPrompt ?? RUNWAY_AGENT_SYSTEM_PROMPT,
    },
    ...turn.transcript.slice(-transcriptLimit).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: "user", content: turn.message },
  ];
  const requests: AgentToolRequest[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const completion = await options.model.complete({
      messages,
      tools: options.tools,
      maxTokens,
      parallelToolCalls: false,
    });

    if (completion.text.length > maxResponseCharacters) {
      throw new ModelResponseError(
        `Model response exceeded the ${maxResponseCharacters}-character limit`,
      );
    }

    if (completion.toolCalls.length === 0) {
      if (!completion.text.trim()) {
        throw new ModelResponseError("Model returned an empty response");
      }
      return {
        text: completion.text.trim(),
        tool_requests: requests,
        iterations: iteration,
      };
    }

    messages.push({
      role: "assistant",
      content: completion.text || null,
      tool_calls: completion.toolCalls,
    });
    for (const call of completion.toolCalls) {
      const request = parseToolRequest(call, options.tools);
      requests.push(request);
      const result = await options.executeTool(request);
      messages.push({
        role: "tool",
        tool_call_id: request.id,
        content: toolResultContent(result),
      });
    }
  }

  throw new AgentLoopLimitError(maxIterations);
}
