import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Pinch Runway fixture dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Pinch Runway \| Earned money, clearer next moves<\/title>/i);
  assert.match(html, /Pinch Runway/);
  assert.match(html, /Runway pings/);
  assert.match(html, /Demo data — not connected to Pinch/);
  assert.match(html, /Create Pinch payment link/);
  assert.match(html, /Fixture preview/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Building your site/i);
});

test("removes the disposable starter skeleton", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview|codex-preview/);
  assert.match(page, /DEMO_SCENARIOS/);
  assert.match(page, /getPinchReadiness/);
  assert.match(layout, /Pinch Runway/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(readFile(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url), "utf8"));
});

test("the fixture source cannot be mistaken for a live Pinch response", async () => {
  const [contracts, fixtures, config] = await Promise.all([
    readFile(new URL("../lib/contracts.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/demo-fixtures.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pinch/config.ts", import.meta.url), "utf8"),
  ]);

  assert.match(contracts, /is_live:\s*false/);
  assert.match(fixtures, /Demo data — not connected to Pinch/);
  assert.match(config, /never turn a[\s\S]*failed Pinch request into a demo-looking success/i);
});
