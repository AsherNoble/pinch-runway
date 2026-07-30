import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CANONICAL_ORIGIN,
  isLocalHost,
  resolveMetadataBase,
} from "../lib/canonical-host.ts";

test("treats bare loopback hosts, with or without a port, as local", () => {
  assert.equal(isLocalHost("localhost"), true);
  assert.equal(isLocalHost("localhost:3000"), true);
  assert.equal(isLocalHost("127.0.0.1:3000"), true);
  assert.equal(isLocalHost("[::1]"), true);
  assert.equal(isLocalHost("[::1]:3000"), true);
  assert.equal(isLocalHost("  LOCALHOST:3000  "), true);
});

test("rejects hosts that merely start with a loopback label", () => {
  assert.equal(isLocalHost("localhost.evil.example"), false);
  assert.equal(isLocalHost("127.0.0.1.evil.example"), false);
  // Not a parseable URL host, so accepting it would throw downstream.
  assert.equal(isLocalHost("[::1].evil.example"), false);
  assert.equal(isLocalHost("localhost:99999999"), false);
});

test("rejects a missing or empty host", () => {
  assert.equal(isLocalHost(null), false);
  assert.equal(isLocalHost(undefined), false);
  assert.equal(isLocalHost(""), false);
  assert.equal(isLocalHost("   "), false);
});

test("resolves metadata against the canonical origin for any non-loopback host", () => {
  for (const host of [
    "pinch-runway.asherthenoble.chatgpt.site",
    "attacker.example.com",
    "localhost.evil.example",
    "[::1].evil.example",
    "",
    null,
    undefined,
  ]) {
    assert.equal(resolveMetadataBase(host).origin, CANONICAL_ORIGIN);
  }
});

test("resolves metadata against the loopback origin during local development", () => {
  assert.equal(resolveMetadataBase("localhost:3000").origin, "http://localhost:3000");
  assert.equal(resolveMetadataBase("[::1]:3000").origin, "http://[::1]:3000");
});

test("never lets a forged host rewrite an absolute asset URL", () => {
  const base = resolveMetadataBase("attacker.example.com");
  assert.equal(
    new URL("/og-runway.png", base).href,
    `${CANONICAL_ORIGIN}/og-runway.png`,
  );
});
