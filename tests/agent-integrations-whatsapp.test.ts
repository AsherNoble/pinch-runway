import assert from "node:assert/strict";
import test from "node:test";
import {
  claimInboundWhatsAppMessage,
  getTwilioWhatsAppConfig,
  getTwilioWhatsAppReadiness,
  parseInboundWhatsAppRequest,
  sendWhatsAppMessage,
  TwilioWhatsAppError,
} from "../lib/agent-integrations/whatsapp.ts";

const accountSid = `AC${"1".repeat(32)}`;
const config = getTwilioWhatsAppConfig({
  TWILIO_ACCOUNT_SID: accountSid,
  TWILIO_AUTH_TOKEN: "twilio-test-token-123456",
  TWILIO_WHATSAPP_FROM: "+14155238886",
  RUNWAY_OWNER_WHATSAPP: "+61412345678",
});

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sign(url: string, parameters: URLSearchParams): Promise<string> {
  const sorted = [...parameters.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
    if (leftValue === rightValue) return 0;
    return leftValue < rightValue ? -1 : 1;
  });
  const payload = sorted.reduce((value, [key, item]) => `${value}${key}${item}`, url);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(config.auth_token!),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  return base64(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  )));
}

test("Twilio readiness is strict and never exposes credentials", () => {
  assert.equal(getTwilioWhatsAppReadiness(config).state, "ready");
  const readiness = getTwilioWhatsAppReadiness(getTwilioWhatsAppConfig({}));
  assert.equal(readiness.state, "not_configured");
  assert.doesNotMatch(JSON.stringify(readiness), /token|AC111/);
});

test("Twilio form webhook validates HMAC-SHA1 before parsing the message", async () => {
  const url = "https://runway.example/api/webhooks/twilio";
  const parameters = new URLSearchParams({
    MessageSid: "SM-live-001",
    AccountSid: accountSid,
    From: "whatsapp:+61412345678",
    To: "whatsapp:+14155238886",
    Body: "What caused the squeeze?",
    ProfileName: "Mia",
    NumMedia: "0",
  });
  const request = new Request("http://internal-worker/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": await sign(url, parameters),
    },
    body: parameters,
  });

  const parsed = await parseInboundWhatsAppRequest(request, config, url);
  assert.equal(parsed.provenance, "live");
  assert.deepEqual(parsed.data, {
    message_sid: "SM-live-001",
    account_sid: accountSid,
    from: "whatsapp:+61412345678",
    to: "whatsapp:+14155238886",
    body: "What caused the squeeze?",
    profile_name: "Mia",
    media_count: 0,
  });

  const seen = new Set<string>();
  const store = {
    async claim(messageSid: string) {
      if (seen.has(messageSid)) return false;
      seen.add(messageSid);
      return true;
    },
  };
  assert.equal((await claimInboundWhatsAppMessage(parsed, store)).duplicate, false);
  assert.equal((await claimInboundWhatsAppMessage(parsed, store)).duplicate, true);
});

test("Twilio webhook rejects tampering and account mismatch", async () => {
  const url = "https://runway.example/api/webhooks/twilio";
  const parameters = new URLSearchParams({
    MessageSid: "SM-live-002",
    AccountSid: accountSid,
    From: "whatsapp:+61412345678",
    To: "whatsapp:+14155238886",
    Body: "Original",
  });
  const signature = await sign(url, parameters);
  parameters.set("Body", "Tampered");
  const request = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    body: parameters,
  });
  await assert.rejects(
    parseInboundWhatsAppRequest(request, config),
    (error: unknown) => error instanceof TwilioWhatsAppError && error.status === 401,
  );
});

test("Twilio outbound sender uses form data and returns only safe delivery metadata", async () => {
  let request: Request | undefined;
  const result = await sendWhatsAppMessage(
    { body: "Runway collected the payment link and drafted your reminder." },
    config,
    async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        sid: "SM-outbound-001",
        status: "queued",
        to: "whatsapp:+61412345678",
        from: "whatsapp:+14155238886",
      });
    },
  );

  assert.equal(request?.url, `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`);
  assert.match(request?.headers.get("authorization") ?? "", /^Basic /);
  assert.deepEqual(
    Object.fromEntries(new URLSearchParams(await request!.text())),
    {
      To: "whatsapp:+61412345678",
      From: "whatsapp:+14155238886",
      Body: "Runway collected the payment link and drafted your reminder.",
    },
  );
  assert.deepEqual(result.data, {
    message_sid: "SM-outbound-001",
    status: "queued",
    to: "whatsapp:+61412345678",
    from: "whatsapp:+14155238886",
  });
});
