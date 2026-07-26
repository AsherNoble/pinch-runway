import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runwayProfiles } from "@/db/schema";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { RUNWAY_PROFILE_ID, getProfile } from "@/lib/runway-store";

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
  if (!(await getChatGPTUser())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const profile = await getProfile();
  if (
    !state ||
    !profile?.connectStateHash ||
    (await sha256(state)) !== profile.connectStateHash
  ) {
    return NextResponse.json(
      { error: "Invalid or expired Basiq connection state." },
      { status: 400 },
    );
  }
  const jobIds = [
    ...url.searchParams.getAll("jobId"),
    ...(url.searchParams.get("jobIds")?.split(",") ?? []),
  ].map((value) => value.trim()).filter(Boolean);
  if (!jobIds.length) {
    return NextResponse.redirect(new URL("/?basiq=cancelled", request.url));
  }
  const db = await getDb();
  await db
    .update(runwayProfiles)
    .set({
      bankState: "syncing",
      connectStateHash: null,
      syncError: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(runwayProfiles.id, RUNWAY_PROFILE_ID));
  const destination = new URL("/", request.url);
  destination.searchParams.set("basiq", "syncing");
  destination.searchParams.set("jobIds", [...new Set(jobIds)].join(","));
  return NextResponse.redirect(destination);
}
