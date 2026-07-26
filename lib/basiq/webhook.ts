function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function base64Bytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function verifyBasiqWebhook(input: {
  raw_body: string;
  webhook_id: string | null;
  webhook_timestamp: string | null;
  webhook_signature: string | null;
  secret: string | undefined;
  now?: Date;
}): Promise<boolean> {
  const { webhook_id: id, webhook_timestamp: timestamp } = input;
  if (!id || !timestamp || !input.webhook_signature || !input.secret) return false;
  const epochSeconds = Number(timestamp);
  if (!Number.isInteger(epochSeconds)) return false;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - epochSeconds) > 300) return false;

  const encodedSecret = input.secret.startsWith("whsec_")
    ? input.secret.slice("whsec_".length)
    : input.secret;
  const secretBytes = base64Bytes(encodedSecret);
  if (!secretBytes) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(secretBytes).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = `${id}.${timestamp}.${input.raw_body}`;
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed)),
  );
  const candidates = input.webhook_signature
    .split(" ")
    .map((candidate) => candidate.replace(/^v\d+,/, ""))
    .map(base64Bytes)
    .filter((candidate): candidate is Uint8Array => candidate !== null);
  return candidates.some((candidate) => constantTimeEqual(expected, candidate));
}
