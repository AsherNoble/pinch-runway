import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isTrustedProxyRequest } from "../lib/trusted-proxy.ts";

const CHATGPT_HOST = "pinch-runway.acme.chatgpt.site";
const WORKERS_DEV_HOST = "pinch-runway.acme.workers.dev";
const PREVIEW_HOST = "1a2b3c-pinch-runway.acme.workers.dev";

test("default: honours the proxied host", () => {
  assert.equal(isTrustedProxyRequest(CHATGPT_HOST, {}), true);
  assert.equal(isTrustedProxyRequest(`${CHATGPT_HOST}:443`, {}), true);
});

test("default: rejects the raw workers.dev origin and version preview URLs", () => {
  assert.equal(isTrustedProxyRequest(WORKERS_DEV_HOST, {}), false);
  assert.equal(isTrustedProxyRequest(PREVIEW_HOST, {}), false);
  assert.equal(isTrustedProxyRequest("workers.dev", {}), false);
  assert.equal(isTrustedProxyRequest("PINCH-RUNWAY.ACME.WORKERS.DEV", {}), false);
});

test("default: rejects a missing or empty host", () => {
  assert.equal(isTrustedProxyRequest(null, {}), false);
  assert.equal(isTrustedProxyRequest(undefined, {}), false);
  assert.equal(isTrustedProxyRequest("", {}), false);
  assert.equal(isTrustedProxyRequest("   ", {}), false);
});

test("allowlist: honours only configured hosts and is fail-closed otherwise", () => {
  const env = { RUNWAY_TRUSTED_PROXY_HOSTS: ` ${CHATGPT_HOST} , app.example.com ` };
  assert.equal(isTrustedProxyRequest(CHATGPT_HOST, env), true);
  assert.equal(isTrustedProxyRequest("app.example.com:8443", env), true);
  assert.equal(isTrustedProxyRequest("attacker.example.com", env), false);
  // An explicit allowlist that omits workers.dev keeps it rejected too.
  assert.equal(isTrustedProxyRequest(WORKERS_DEV_HOST, env), false);
});

test("allowlist: a workers.dev entry is respected verbatim (opt-in only)", () => {
  const env = { RUNWAY_TRUSTED_PROXY_HOSTS: WORKERS_DEV_HOST };
  assert.equal(isTrustedProxyRequest(WORKERS_DEV_HOST, env), true);
  assert.equal(isTrustedProxyRequest(CHATGPT_HOST, env), false);
});
