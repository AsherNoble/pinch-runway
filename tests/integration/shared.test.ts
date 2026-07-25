import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { collectionActions } from "@/db/schema";
import { confirmShared } from "@/app/api/collection-actions/[id]/shared/confirm";

function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

describe("confirmShared (explicit share confirmation)", () => {
  it("records shared_at for a link created today and marks the row shared", async () => {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.insert(collectionActions).values({
      invoiceId: "INV-share",
      actionDate: sydneyToday(),
      state: "link_created",
      pinchLinkId: "plink_1",
      createdAt: now,
      reservedAt: now,
      linkCreatedAt: now,
    });

    const response = await confirmShared("INV-share");
    expect(response.status).toBe(200);
    const bodyJson = (await response.json()) as { state: string; shared_at: string };
    expect(bodyJson.state).toBe("shared");
    expect(typeof bodyJson.shared_at).toBe("string");

    const row = (
      await db.select().from(collectionActions).where(eq(collectionActions.invoiceId, "INV-share")).limit(1)
    )[0];
    expect(row?.state).toBe("shared");
    expect(row?.sharedAt).toBe(bodyJson.shared_at);
  });

  it("refuses to confirm sharing when no link has been created for the invoice today", async () => {
    const response = await confirmShared("INV-none");
    expect(response.status).toBe(409);
  });
});
