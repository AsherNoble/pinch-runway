import { applyD1Migrations, env } from "cloudflare:test";

// The routes read Pinch config and the webhook secret from process.env
// (lib/pinch/config.ts, the webhook route). Set server-only test values here so
// the client constructs and outbound Pinch calls can be intercepted with
// fetchMock. These are never real credentials.
process.env.RUNWAY_DATA_SOURCE = "sandbox";
process.env.PINCH_APPLICATION_ID = "app_test";
process.env.PINCH_SECRET_KEY = "sk_test";
process.env.PINCH_API_VERSION = "2020.1";
process.env.PINCH_API_BASE_URL = "https://api.getpinch.com.au/test/";
process.env.PINCH_WEBHOOK_SECRET = "whsec_test_secret";

// Apply the real schema once; isolatedStorage rolls back each test's writes.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
