import { NextResponse } from "next/server";
import { isAgentOperatorRequest } from "@/lib/agent-auth";
import { resetDemoAgent } from "@/lib/agent-store";

export async function POST(request: Request) {
  if (!(await isAgentOperatorRequest(request))) {
    return NextResponse.json({ error: "Operator authentication required." }, { status: 401 });
  }
  await resetDemoAgent();
  return NextResponse.json(
    { message: "Agent demo state reset. Live Pinch actions remain preserved for safe reuse." },
    { headers: { "cache-control": "no-store" } },
  );
}
