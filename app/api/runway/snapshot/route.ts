import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { loadRunwaySnapshot } from "@/lib/runway-store";

export async function GET() {
  if (!(await getChatGPTUser())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  return NextResponse.json(await loadRunwaySnapshot(), {
    headers: { "cache-control": "no-store" },
  });
}
