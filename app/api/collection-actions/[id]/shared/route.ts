import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { confirmShared } from "./confirm";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getChatGPTUser())) return NextResponse.json({ error: "Operator sign-in is required." }, { status: 401 });
  const { id } = await params;
  return confirmShared(id);
}
