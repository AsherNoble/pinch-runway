import { NextResponse } from "next/server";
import { isAgentOperatorRequest } from "@/lib/agent-auth";
import {
  setAgentPermission,
  type StoredActionClass,
  type StoredPermissionMode,
} from "@/lib/agent-store";

const ACTIONS = new Set<StoredActionClass>([
  "collection_email",
  "payment_link",
  "calendar_edit",
  "receipt_request",
]);
const MODES = new Set<StoredPermissionMode>(["blocked", "ask", "auto"]);

export async function POST(request: Request) {
  if (!(await isAgentOperatorRequest(request))) {
    return NextResponse.json({ error: "Operator authentication required." }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const actionClass =
    body && typeof body === "object"
      ? (body as { actionClass?: unknown }).actionClass
      : null;
  const mode =
    body && typeof body === "object" ? (body as { mode?: unknown }).mode : null;
  if (
    typeof actionClass !== "string" ||
    !ACTIONS.has(actionClass as StoredActionClass) ||
    typeof mode !== "string" ||
    !MODES.has(mode as StoredPermissionMode)
  ) {
    return NextResponse.json(
      { error: "A valid actionClass and mode are required." },
      { status: 400 },
    );
  }
  await setAgentPermission(
    actionClass as StoredActionClass,
    mode as StoredPermissionMode,
  );
  return NextResponse.json(
    { actionClass, mode },
    { headers: { "cache-control": "no-store" } },
  );
}
