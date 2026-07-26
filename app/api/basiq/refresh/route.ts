import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runwayProfiles } from "@/db/schema";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { BasiqClient } from "@/lib/basiq/client";
import { requireBasiqConfig } from "@/lib/basiq/config";
import { RUNWAY_PROFILE_ID, getProfile } from "@/lib/runway-store";

export async function POST() {
  if (!(await getChatGPTUser())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const profile = await getProfile();
  if (!profile?.basiqUserId || profile.consentStatus !== "valid") {
    return NextResponse.json(
      { error: "Valid Basiq consent is required." },
      { status: 409 },
    );
  }
  try {
    const jobs = await new BasiqClient(requireBasiqConfig()).refreshConnections(
      profile.basiqUserId,
    );
    const db = await getDb();
    await db
      .update(runwayProfiles)
      .set({
        bankState: "syncing",
        syncError: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(runwayProfiles.id, RUNWAY_PROFILE_ID));
    return NextResponse.json(
      { state: "syncing", jobIds: jobs },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Refresh failed." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
