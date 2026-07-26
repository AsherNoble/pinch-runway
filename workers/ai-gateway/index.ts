import {
  WORKERS_AI_MODEL,
  type WorkersAiMessage,
  type WorkersAiRunInput,
} from "../../lib/agent/workers-ai.server.ts";

const MAX_REQUEST_BYTES = 128 * 1_024;
const MAX_MESSAGES = 40;
const MAX_TOOLS = 16;
const MAX_COMPLETION_TOKENS = 1_200;

class GatewayRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GatewayRequestError";
    this.status = status;
  }
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validToolCall(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.type === "function" &&
    isRecord(value.function) &&
    typeof value.function.name === "string" &&
    typeof value.function.arguments === "string"
  );
}

function validMessage(value: unknown): value is WorkersAiMessage {
  if (!isRecord(value)) return false;
  if (value.role === "system" || value.role === "user") {
    return typeof value.content === "string";
  }
  if (value.role === "tool") {
    return (
      typeof value.content === "string" &&
      typeof value.tool_call_id === "string"
    );
  }
  if (value.role !== "assistant") return false;
  return (
    (value.content === null || typeof value.content === "string") &&
    (value.tool_calls === undefined ||
      (Array.isArray(value.tool_calls) &&
        value.tool_calls.every(validToolCall)))
  );
}

function validTool(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "function" &&
    isRecord(value.function) &&
    typeof value.function.name === "string" &&
    typeof value.function.description === "string" &&
    isRecord(value.function.parameters)
  );
}

async function secretsMatch(
  provided: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function requireAuthentication(
  request: Request,
  expectedToken: string,
): Promise<void> {
  if (expectedToken.length < 32) {
    throw new GatewayRequestError("Gateway is not configured", 503);
  }
  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  const token = authorization.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : "";
  if (!(await secretsMatch(token, expectedToken))) {
    throw new GatewayRequestError("Unauthorized", 401);
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new GatewayRequestError("JSON request body required", 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_REQUEST_BYTES
  ) {
    throw new GatewayRequestError("Request body is too large", 413);
  }
  if (!request.body) {
    throw new GatewayRequestError("Request body is required", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new GatewayRequestError("Request body is too large", 413);
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
    throw new GatewayRequestError("Request body is invalid JSON", 400);
  }
}

function validRunInput(value: unknown): value is WorkersAiRunInput {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set([
    "messages",
    "tools",
    "max_completion_tokens",
    "parallel_tool_calls",
    "temperature",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  if (
    !Array.isArray(value.messages) ||
    value.messages.length === 0 ||
    value.messages.length > MAX_MESSAGES ||
    !value.messages.every(validMessage)
  ) {
    return false;
  }
  if (
    !Array.isArray(value.tools) ||
    value.tools.length > MAX_TOOLS ||
    !value.tools.every(validTool)
  ) {
    return false;
  }
  if (
    !Number.isSafeInteger(value.max_completion_tokens) ||
    Number(value.max_completion_tokens) <= 0 ||
    Number(value.max_completion_tokens) > MAX_COMPLETION_TOKENS
  ) {
    return false;
  }
  return value.parallel_tool_calls === false && value.temperature === 0;
}

async function parseGatewayPayload(request: Request): Promise<{
  model: typeof WORKERS_AI_MODEL;
  input: WorkersAiRunInput;
}> {
  const payload = await readBoundedJson(request);
  if (
    !isRecord(payload) ||
    payload.model !== WORKERS_AI_MODEL ||
    !validRunInput(payload.input)
  ) {
    throw new GatewayRequestError("Unsupported inference request", 400);
  }
  return { model: WORKERS_AI_MODEL, input: payload.input };
}

export async function handleGatewayRequest(
  request: Request,
  input: {
    token: string;
    run: (
      model: typeof WORKERS_AI_MODEL,
      request: WorkersAiRunInput,
    ) => Promise<unknown>;
  },
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ ready: true, model: WORKERS_AI_MODEL });
  }
  if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    await requireAuthentication(request, input.token);
    const payload = await parseGatewayPayload(request);
    const result = await input.run(payload.model, payload.input);
    console.log(
      JSON.stringify({
        event: "workers_ai_gateway.complete",
        requestId,
        outcome: "ok",
        durationMs: Date.now() - startedAt,
      }),
    );
    return Response.json(result, {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    const status =
      error instanceof GatewayRequestError ? error.status : 502;
    console.error(
      JSON.stringify({
        event: "workers_ai_gateway.complete",
        requestId,
        outcome: "error",
        status,
        errorCode: error instanceof Error ? error.name : "unknown",
        durationMs: Date.now() - startedAt,
      }),
    );
    return jsonResponse(
      {
        error:
          status === 401
            ? "Unauthorized"
            : status < 500
              ? "Invalid request"
              : "Inference unavailable",
        request_id: requestId,
      },
      status,
    );
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    return handleGatewayRequest(request, {
      token: env.WORKERS_AI_GATEWAY_TOKEN,
      run: (model, input) =>
        env.AI.run(model, {
          ...input,
          messages: input.messages.map((message) =>
            message.role === "assistant"
              ? {
                  ...message,
                  tool_calls: message.tool_calls?.map((call) => ({
                    ...call,
                    function: { ...call.function },
                  })),
                }
              : { ...message },
          ),
          tools: input.tools.map((tool) => ({
            ...tool,
            function: {
              ...tool.function,
              parameters: {
                ...tool.function.parameters,
                properties: {
                  ...tool.function.parameters.properties,
                },
                required: tool.function.parameters.required
                  ? [...tool.function.parameters.required]
                  : undefined,
              },
            },
          })),
        }),
    });
  },
} satisfies ExportedHandler<AiGatewayEnv>;
