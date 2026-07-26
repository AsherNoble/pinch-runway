import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { expenseExclusions } from "@/db/schema";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { syncBasiqData } from "@/lib/basiq/sync";
import { RUNWAY_PROFILE_ID } from "@/lib/runway-store";

function patternFrom(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const pattern = (value as { pattern?: unknown }).pattern;
  if (typeof pattern !== "string") return null;
  const normalised = pattern.trim().toLowerCase().replace(/\s+/g, " ");
  return normalised.length >= 2 && normalised.length <= 80 ? normalised : null;
}

export async function POST(request: Request) {
  if (!(await getChatGPTUser())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const pattern = patternFrom(body);
  if (!pattern) {
    return NextResponse.json(
      { error: "Pattern must be between 2 and 80 characters." },
      { status: 400 },
    );
  }
  try {
    const db = await getDb();
    await db
      .insert(expenseExclusions)
      .values({
        profileId: RUNWAY_PROFILE_ID,
        pattern,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
    return NextResponse.json(
      { pattern, sync: await syncBasiqData() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Exclusion failed." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!(await getChatGPTUser())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const pattern = new URL(request.url).searchParams.get("pattern")?.trim().toLowerCase();
  if (!pattern) {
    return NextResponse.json({ error: "Pattern is required." }, { status: 400 });
  }
  try {
    const db = await getDb();
    await db
      .delete(expenseExclusions)
      .where(and(
        eq(expenseExclusions.profileId, RUNWAY_PROFILE_ID),
        eq(expenseExclusions.pattern, pattern),
      ));
    return NextResponse.json(
      { removed: pattern, sync: await syncBasiqData() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Exclusion removal failed." },
      { status: 502 },
    );
  }
}
