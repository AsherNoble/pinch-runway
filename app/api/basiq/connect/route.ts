import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runwayProfiles } from "@/db/schema";
import {
  chatGPTSignInPath,
  getChatGPTUser,
} from "@/app/chatgpt-auth";
import { BasiqClient } from "@/lib/basiq/client";
import { requireBasiqConfig } from "@/lib/basiq/config";
import {
  RUNWAY_PROFILE_ID,
  ensureRunwayProfile,
} from "@/lib/runway-store";

export const dynamic = "force-dynamic";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return NextResponse.redirect(
      new URL(chatGPTSignInPath("/api/basiq/connect"), request.url),
    );
  }
  try {
    let profile = await ensureRunwayProfile(user.email);
    const client = new BasiqClient(requireBasiqConfig());
    if (!profile.basiqUserId) {
      const basiqUserId = await client.createUser(user.email);
      const db = await getDb();
      await db
        .update(runwayProfiles)
        .set({
          basiqUserId,
          bankState: "consent_required",
          consentStatus: "required",
          syncError: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(runwayProfiles.id, RUNWAY_PROFILE_ID));
      profile = { ...profile, basiqUserId };
    }
    const connectedUserId = profile.basiqUserId;
    if (!connectedUserId) throw new Error("Basiq user creation did not complete.");
    const state = crypto.randomUUID();
    const db = await getDb();
    await db
      .update(runwayProfiles)
      .set({
        connectStateHash: await sha256(state),
        bankState: "syncing",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(runwayProfiles.id, RUNWAY_PROFILE_ID));
    const consentUrl = await client.createConsentUrl({
      user_id: connectedUserId,
      state,
      action: "connect",
    });
    return NextResponse.redirect(consentUrl, 303);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Basiq connection could not be started.",
      },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
