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

test("server-renders the bank-aware runway dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Runway \| Bank-aware cash flow for sole traders<\/title>/i);
  assert.match(html, /bank-aware cash flow/i);
  assert.match(html, /Cash available now/);
  assert.match(html, /Earned, not received/);
  assert.match(html, /Expected position/);
  assert.match(html, /Available cash vs expected position/);
  assert.match(html, /Demo receivables/);
  assert.match(html, /Bank data unavailable/);
  assert.doesNotMatch(html, /Create Pinch payment link/);
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
  assert.match(page, /RunwayDashboard/);
  assert.match(page, /ensureRunwayProfile/);
  assert.match(layout, /Bank-aware cash flow/);
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
