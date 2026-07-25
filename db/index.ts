import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getDb() {
  // Dynamic import keeps fixture SSR runnable under Node; deployed routes load
  // the Cloudflare binding only when a database-backed action is invoked.
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export async function getReceiptsBucket() {
  const { env } = await import("cloudflare:workers");
  if (!env.RECEIPTS) {
    throw new Error(
      "Cloudflare R2 binding `RECEIPTS` is unavailable. Set the `r2` field in .openai/hosting.json to `RECEIPTS` or let your control plane inject the real binding values before using receipt storage."
    );
  }

  return env.RECEIPTS as R2Bucket;
}
