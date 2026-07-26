import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getDb() {
  // Dynamic import keeps fixture SSR runnable under Node; deployed routes load
  // the Cloudflare binding only when a database-backed action is invoked.
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure the DB D1 binding in wrangler.jsonc before using database-backed actions."
    );
  }

  return drizzle(env.DB, { schema });
}
