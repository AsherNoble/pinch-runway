import { NextResponse } from "next/server";
import { isAgentOperatorRequest } from "@/lib/agent-auth";
import { setRiskBufferSetting } from "@/lib/agent-store";

export async function POST(request: Request) {
  if (!(await isAgentOperatorRequest(request))) {
    return NextResponse.json(
      { error: "Operator authentication required." },
      { status: 401 },
    );
  }
  const body = await request.json().catch(() => null);
  const mode =
    body && typeof body === "object"
      ? (body as { mode?: unknown }).mode
      : null;

  if (mode === "auto") {
    await setRiskBufferSetting({ mode: "auto" });
    return NextResponse.json(
      { mode: "auto" },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (mode === "manual") {
    const manualCents = (body as { manualCents?: unknown }).manualCents;
    if (
      typeof manualCents !== "number" ||
      !Number.isSafeInteger(manualCents) ||
      manualCents <= 0
    ) {
      return NextResponse.json(
        { error: "manualCents must be a positive integer number of cents." },
        { status: 400 },
      );
    }
    await setRiskBufferSetting({ mode: "manual", manualCents });
    return NextResponse.json(
      { mode: "manual", manualCents },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    { error: "mode must be \"auto\" or \"manual\"." },
    { status: 400 },
  );
}
