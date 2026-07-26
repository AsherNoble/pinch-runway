import { NextResponse } from "next/server";
import { isAgentOperatorRequest } from "@/lib/agent-auth";
import { runProactiveDemoAgent } from "@/lib/agent-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isAgentOperatorRequest(request))) {
    return NextResponse.json({ error: "Operator authentication required." }, { status: 401 });
  }
  try {
    const result = await runProactiveDemoAgent();
    return NextResponse.json(
      {
        ...result,
        message: result.message,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The demo agent workflow failed.",
      },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
