import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runwayProfiles } from "@/db/schema";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { BasiqClient } from "@/lib/basiq/client";
import { requireBasiqConfig } from "@/lib/basiq/config";
import {
  RUNWAY_PROFILE_ID,
  getProfile,
  purgeDerivedBankData,
} from "@/lib/runway-store";

export async function DELETE() {
  if (!(await getChatGPTUser())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const profile = await getProfile();
  try {
    if (profile?.basiqUserId) {
      await new BasiqClient(requireBasiqConfig()).deleteUser(profile.basiqUserId);
    }
    await purgeDerivedBankData({
      bank_state: "consent_required",
      consent_status: "required",
      message: "Bank connection removed. Connect again to resume bank-aware guidance.",
    });
    const db = await getDb();
    await db
      .update(runwayProfiles)
      .set({ basiqUserId: null, updatedAt: new Date().toISOString() })
      .where(eq(runwayProfiles.id, RUNWAY_PROFILE_ID));
    return NextResponse.json(
      { disconnected: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Disconnect failed." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
