import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { collectionActions } from "@/db/schema";

describe("integration harness", () => {
  it("exposes the DB binding via cloudflare:workers, which is what getDb() reads", async () => {
    const { env: workerEnv } = await import("cloudflare:workers");
    expect((workerEnv as { DB?: unknown }).DB).toBeDefined();
  });

  it("runs a real query through getDb() against the migrated D1", async () => {
    const db = await getDb();
    const rows = await db.select().from(collectionActions);
    expect(rows).toEqual([]);
  });

  it("has a usable DB binding on the cloudflare:test env too", () => {
    expect(env.DB).toBeDefined();
  });

  it("populates process.env for the Pinch config and webhook secret", () => {
    expect(process.env.PINCH_WEBHOOK_SECRET).toBe("whsec_test_secret");
    expect(process.env.RUNWAY_DATA_SOURCE).toBe("sandbox");
  });
});
