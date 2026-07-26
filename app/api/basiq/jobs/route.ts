import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runwayProfiles } from "@/db/schema";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { BasiqClient, jobComplete, jobFailed } from "@/lib/basiq/client";
import { requireBasiqConfig } from "@/lib/basiq/config";
import { syncBasiqData } from "@/lib/basiq/sync";
import { RUNWAY_PROFILE_ID } from "@/lib/runway-store";

export async function GET(request: Request) {
  if (!(await getChatGPTUser())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const ids = (new URL(request.url).searchParams.get("jobIds") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9_-]+$/.test(value));
  if (!ids.length) {
    return NextResponse.json({ error: "At least one job id is required." }, { status: 400 });
  }
  try {
    const client = new BasiqClient(requireBasiqConfig());
    const jobs = await Promise.all(ids.map((id) => client.getJob(id)));
    if (jobs.some(jobFailed)) {
      const db = await getDb();
      await db
        .update(runwayProfiles)
        .set({
          bankState: "error",
          syncError: "Basiq could not finish importing the connected accounts.",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(runwayProfiles.id, RUNWAY_PROFILE_ID));
      return NextResponse.json(
        { state: "error", jobs },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
    if (jobs.every(jobComplete)) {
      return NextResponse.json(
        { state: "connected", sync: await syncBasiqData(), jobs },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      { state: "syncing", jobs },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Job status failed." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
