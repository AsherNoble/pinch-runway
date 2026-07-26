import type { ProviderEnvelope } from "./provenance";

type Environment = Record<string, string | undefined>;
type Fetcher = typeof fetch;

export interface TwilioWhatsAppConfig {
  account_sid?: string;
  auth_token?: string;
  from: string;
  owner: string;
  api_base_url: string;
}

export interface TwilioWhatsAppReadiness {
  state: "ready" | "not_configured" | "invalid_configuration";
  display_label: string;
}

export interface InboundWhatsAppMessage {
  message_sid: string;
  account_sid: string;
  from: string;
  to: string;
  body: string;
  profile_name: string | null;
  media_count: number;
}

export interface OutboundWhatsAppMessage {
  message_sid: string;
  status: string;
  to: string;
  from: string;
}

export interface TwilioMessageDedupStore {
  /**
   * Atomically returns true only for the first claim of this MessageSid.
   * Implementations must enforce uniqueness across workers.
   */
  claim(messageSid: string): Promise<boolean>;
}

export interface ClaimedInboundWhatsAppMessage {
  message: ProviderEnvelope<InboundWhatsAppMessage>;
  duplicate: boolean;
}

export class TwilioWhatsAppError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "TwilioWhatsAppError";
    this.status = status;
  }
}

const DEFAULT_FROM = "whatsapp:+14155238886";

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function canonicalWhatsAppAddress(value: string | undefined): string {
  const address = clean(value) ?? "";
  return address.startsWith("whatsapp:") ? address : address ? `whatsapp:${address}` : "";
}

function validAddress(value: string): boolean {
  return /^whatsapp:\+[1-9]\d{7,14}$/.test(value);
}

export function getTwilioWhatsAppConfig(
  environment: Environment = process.env,
): TwilioWhatsAppConfig {
  return {
    account_sid: clean(environment.TWILIO_ACCOUNT_SID),
    auth_token: clean(environment.TWILIO_AUTH_TOKEN),
    from: canonicalWhatsAppAddress(environment.TWILIO_WHATSAPP_FROM) || DEFAULT_FROM,
    owner: canonicalWhatsAppAddress(environment.RUNWAY_OWNER_WHATSAPP),
    api_base_url: "https://api.twilio.com/2010-04-01/",
  };
}

export function getTwilioWhatsAppReadiness(
  config: TwilioWhatsAppConfig = getTwilioWhatsAppConfig(),
): TwilioWhatsAppReadiness {
  if (!config.account_sid || !config.auth_token || !config.owner) {
    return {
      state: "not_configured",
      display_label: "Twilio WhatsApp credentials and owner number are required",
    };
  }
  if (
    !/^AC[a-fA-F0-9]{32}$/.test(config.account_sid) ||
    config.auth_token.length < 16 ||
    !validAddress(config.from) ||
    !validAddress(config.owner) ||
    config.api_base_url !== "https://api.twilio.com/2010-04-01/"
  ) {
    return {
      state: "invalid_configuration",
      display_label: "Twilio WhatsApp configuration is invalid",
    };
  }
  return { state: "ready", display_label: "Twilio WhatsApp is configured" };
}

function requireReady(config: TwilioWhatsAppConfig): asserts config is TwilioWhatsAppConfig & {
  account_sid: string;
  auth_token: string;
} {
  const readiness = getTwilioWhatsAppReadiness(config);
  if (readiness.state !== "ready") {
    throw new TwilioWhatsAppError(readiness.display_label);
  }
}

function base64Bytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function twilioSignaturePayload(url: string, parameters: URLSearchParams): string {
  const entries = [...parameters.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
    if (leftValue === rightValue) return 0;
    return leftValue < rightValue ? -1 : 1;
  });
  return entries.reduce((payload, [key, value]) => `${payload}${key}${value}`, url);
}

export async function verifyTwilioSignature(input: {
  url: string;
  parameters: URLSearchParams;
  signature: string | null;
  auth_token: string | undefined;
}): Promise<boolean> {
  if (!input.signature || !input.auth_token) return false;
  const candidate = base64Bytes(input.signature);
  if (!candidate) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.auth_token),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(twilioSignaturePayload(input.url, input.parameters)),
    ),
  );
  return constantTimeEqual(expected, candidate);
}

/**
 * Validates before returning any user-controlled fields. `public_url` is the
 * exact externally visible webhook URL configured in Twilio; pass it when a
 * reverse proxy changes the Request URL.
 */
export async function parseInboundWhatsAppRequest(
  request: Request,
  config: TwilioWhatsAppConfig,
  public_url = request.url,
): Promise<ProviderEnvelope<InboundWhatsAppMessage>> {
  requireReady(config);
  if (request.method !== "POST") {
    throw new TwilioWhatsAppError("Twilio webhook must use POST.", 405);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    throw new TwilioWhatsAppError("Twilio webhook must be form encoded.", 415);
  }
  const parameters = new URLSearchParams(await request.text());
  const valid = await verifyTwilioSignature({
    url: public_url,
    parameters,
    signature: request.headers.get("x-twilio-signature"),
    auth_token: config.auth_token,
  });
  if (!valid) throw new TwilioWhatsAppError("Twilio webhook signature is invalid.", 401);

  const messageSid = parameters.get("MessageSid")?.trim() ?? "";
  const accountSid = parameters.get("AccountSid")?.trim() ?? "";
  const from = canonicalWhatsAppAddress(parameters.get("From") ?? undefined);
  const to = canonicalWhatsAppAddress(parameters.get("To") ?? undefined);
  const mediaCount = Number(parameters.get("NumMedia") ?? "0");
  if (
    !messageSid ||
    accountSid !== config.account_sid ||
    !validAddress(from) ||
    !validAddress(to) ||
    from !== config.owner ||
    to !== config.from ||
    !Number.isInteger(mediaCount) ||
    mediaCount < 0
  ) {
    throw new TwilioWhatsAppError("Twilio webhook is missing required fields.", 400);
  }

  return {
    provider: "twilio_whatsapp",
    provenance: "live",
    retrieved_at: new Date().toISOString(),
    data: {
      message_sid: messageSid,
      account_sid: accountSid,
      from,
      to,
      body: parameters.get("Body") ?? "",
      profile_name: parameters.get("ProfileName")?.trim() || null,
      media_count: mediaCount,
    },
  };
}

export async function claimInboundWhatsAppMessage(
  message: ProviderEnvelope<InboundWhatsAppMessage>,
  store: TwilioMessageDedupStore,
): Promise<ClaimedInboundWhatsAppMessage> {
  if (message.provider !== "twilio_whatsapp" || message.provenance !== "live") {
    throw new TwilioWhatsAppError("Only validated live Twilio messages can be claimed.");
  }
  const firstClaim = await store.claim(message.data.message_sid);
  return { message, duplicate: !firstClaim };
}

function basicCredentials(accountSid: string, authToken: string): string {
  const bytes = new TextEncoder().encode(`${accountSid}:${authToken}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function sendWhatsAppMessage(
  input: { to?: string; body: string },
  config: TwilioWhatsAppConfig,
  fetcher: Fetcher = fetch,
): Promise<ProviderEnvelope<OutboundWhatsAppMessage>> {
  requireReady(config);
  const to = canonicalWhatsAppAddress(input.to) || config.owner;
  if (!validAddress(to)) throw new TwilioWhatsAppError("WhatsApp recipient is invalid.");
  if (!input.body.trim() || input.body.length > 1_600) {
    throw new TwilioWhatsAppError("WhatsApp body must contain between 1 and 1600 characters.");
  }
  const url = new URL(
    `Accounts/${encodeURIComponent(config.account_sid)}/Messages.json`,
    config.api_base_url,
  );
  const body = new URLSearchParams({ To: to, From: config.from, Body: input.body });
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      authorization: `Basic ${basicCredentials(config.account_sid, config.auth_token)}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  if (!response.ok) {
    throw new TwilioWhatsAppError(
      `Twilio WhatsApp request failed with status ${response.status}.`,
      response.status,
    );
  }
  const payload = record(await response.json().catch(() => null));
  const messageSid = text(payload.sid);
  const status = text(payload.status);
  if (!messageSid || !status) {
    throw new TwilioWhatsAppError("Twilio returned an invalid message response.", 502);
  }
  return {
    provider: "twilio_whatsapp",
    provenance: "live",
    retrieved_at: new Date().toISOString(),
    data: {
      message_sid: messageSid,
      status,
      to: canonicalWhatsAppAddress(text(payload.to) ?? to),
      from: canonicalWhatsAppAddress(text(payload.from) ?? config.from),
    },
  };
}
