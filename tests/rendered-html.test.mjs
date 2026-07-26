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

test("server-renders the always-on financial operations command center", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>Runway \| Your always-on financial operations agent<\/title>/i,
  );
  assert.match(html, /always-on money ops/i);
  assert.match(html, /Thirteen-week outlook/);
  assert.match(html, /Agent activity/);
  assert.match(html, /Connected context/);
  assert.match(html, /You decide how much Runway can do/);
  assert.match(html, /Mock-context monitoring/);
  assert.match(html, /Enable hourly heartbeat|Pause hourly heartbeat/);
  assert.match(html, /Pinch payment link/);
  assert.match(html, /Inject large bill/);
  assert.match(html, /does not move money/i);
  assert.match(html, /Bank data unavailable/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Building your site/i);
});

test("removes the disposable starter skeleton", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview|codex-preview/);
  assert.match(page, /loadRunwaySnapshot/);
  assert.match(page, /AgentCommandCenter/);
  assert.match(page, /loadAgentCommandState/);
  assert.match(page, /ensureRunwayProfile/);
  assert.match(layout, /always-on financial operations agent/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(readFile(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url), "utf8"));
});

test("bank data cannot silently become fixtures or persist raw transactions", async () => {
  const [contracts, client, schema, sync] = await Promise.all([
    readFile(new URL("../lib/runway-contracts.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/basiq/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/basiq/sync.ts", import.meta.url), "utf8"),
  ]);

  assert.match(contracts, /DataReadinessState/);
  assert.match(contracts, /Ephemeral normalised transaction input/);
  assert.match(client, /masked_number/);
  assert.doesNotMatch(schema, /accountNo|account_number|bank_transactions/);
  assert.doesNotMatch(sync, /insert\(.*transaction/i);
});
