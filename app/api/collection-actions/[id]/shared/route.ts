import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { confirmShared } from "./confirm";

export const dynamic = "force-dynamic";

function sameOrigin(request: Request) { const origin = request.headers.get("origin"); const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host"); try { return !!origin && !!host && new URL(origin).host === host; } catch { return false; } }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request) || !(await getChatGPTUser())) return NextResponse.json({ error: "Operator sign-in is required." }, { status: 401, headers: { "cache-control": "no-store" } });
  const { id } = await params;
  return confirmShared(id);
}
