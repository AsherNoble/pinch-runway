import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Build the D1 migration set directly from the Drizzle SQL so the integration
// suite runs against the real schema. We read the SQL rather than
// readD1Migrations() because the Drizzle journal (drizzle/meta/_journal.json)
// is intentionally minimal in this repo.
const migrations = [
  "0000_collection_actions",
  "0001_resend_email_delivery",
  "0002_basiq_runway",
].map((name) => {
  const migrationSql = readFileSync(
    fileURLToPath(new URL(`./drizzle/${name}.sql`, import.meta.url)),
    "utf8",
  );

  return {
    name,
    queries: migrationSql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0),
  };
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      singleWorker: true,
      isolatedStorage: true,
      miniflare: {
        compatibilityDate: "2026-07-25",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: { DB: "pinch-runway-test" },
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)).replace(/\/$/, ""),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
  },
});
