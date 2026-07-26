import { NextResponse } from "next/server";
import { isAgentOperatorRequest } from "@/lib/agent-auth";
import { setAgentHeartbeatEnabled } from "@/lib/agent-store";

export async function POST(request: Request) {
  if (!(await isAgentOperatorRequest(request))) {
    return NextResponse.json(
      { error: "Operator authentication required." },
      { status: 401 },
    );
  }
  const body = await request.json().catch(() => null);
  const enabled =
    body && typeof body === "object"
      ? (body as { enabled?: unknown }).enabled
      : null;
  if (typeof enabled !== "boolean") {
    return NextResponse.json(
      { error: "A boolean enabled value is required." },
      { status: 400 },
    );
  }

  await setAgentHeartbeatEnabled(enabled);
  return NextResponse.json(
    { enabled },
    { headers: { "cache-control": "no-store" } },
  );
}
