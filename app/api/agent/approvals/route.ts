import { NextResponse } from "next/server";
import { isAgentOperatorRequest } from "@/lib/agent-auth";
import {
  ApprovalNotPendingError,
  executeApprovedAction,
} from "@/lib/agent-runtime";
import { denyAgentApproval, pendingAgentApprovals } from "@/lib/agent-store";

export const dynamic = "force-dynamic";

/**
 * Owner decisions on actions parked by the "Ask me" permission mode.
 *
 * Approving runs the side effect now, out of band from the agent run that
 * proposed it — see executeApprovedAction in lib/agent-runtime.ts. Only the
 * authenticated operator can decide; the model has no path to this route, which
 * is what keeps "Ask me" meaningful under prompt injection.
 */
export async function GET(request: Request) {
  if (!(await isAgentOperatorRequest(request))) {
    return NextResponse.json(
      { error: "Operator authentication required." },
      { status: 401 },
    );
  }
  const approvals = await pendingAgentApprovals();
  return NextResponse.json(
    {
      approvals: approvals.map((approval) => ({
        id: approval.id,
        actionClass: approval.actionClass,
        toolName: approval.toolName,
        summary: approval.summary,
        createdAt: approval.createdAt,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!(await isAgentOperatorRequest(request))) {
    return NextResponse.json(
      { error: "Operator authentication required." },
      { status: 401 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    approvalId?: unknown;
    decision?: unknown;
  } | null;
  const approvalId = body?.approvalId;
  const decision = body?.decision;
  if (
    typeof approvalId !== "string" ||
    !approvalId.trim() ||
    (decision !== "approve" && decision !== "deny")
  ) {
    return NextResponse.json(
      { error: "A valid approvalId and decision are required." },
      { status: 400 },
    );
  }

  if (decision === "deny") {
    const denied = await denyAgentApproval(approvalId);
    if (!denied) {
      return NextResponse.json(
        { error: "That action is no longer pending." },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      { status: "denied", message: "Action denied. Runway did not run it." },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const outcome = await executeApprovedAction(approvalId);
    return NextResponse.json(
      {
        status: outcome.status,
        message:
          outcome.status === "executed"
            ? "Approved. Runway completed the action."
            : "Approved, but the action failed. The audit trail has the reason.",
      },
      {
        status: outcome.status === "executed" ? 200 : 502,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof ApprovalNotPendingError) {
      return NextResponse.json(
        { error: "That action is no longer pending." },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Runway could not run the approved action.",
      },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
