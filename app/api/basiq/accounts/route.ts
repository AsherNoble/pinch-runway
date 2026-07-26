import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { syncBasiqData } from "@/lib/basiq/sync";
import { selectBankAccounts } from "@/lib/runway-store";

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
  const ids =
    body && typeof body === "object" && Array.isArray((body as { account_ids?: unknown }).account_ids)
      ? (body as { account_ids: unknown[] }).account_ids
      : null;
  if (!ids || ids.some((id) => typeof id !== "string")) {
    return NextResponse.json(
      { error: "account_ids must be an array of account ids." },
      { status: 400 },
    );
  }
  try {
    await selectBankAccounts(ids as string[]);
    return NextResponse.json(
      { state: "connected", sync: await syncBasiqData() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Account selection failed." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
