import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { taxProfiles } from "@/db/schema";
import type { TaxSetAsideStatus } from "@/lib/contracts";
import { getTaxOwnerEmail } from "../owner";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

function toRouteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table") || message.includes("tax_profiles")) {
    return "The tax_profiles table is unavailable. Apply drizzle/0002_tax_profile.sql to D1.";
  }
  return message;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return !!origin && !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function GET() {
  const ownerEmail = await getTaxOwnerEmail();

  try {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(taxProfiles)
      .where(eq(taxProfiles.ownerEmail, ownerEmail))
      .limit(1);

    if (!row) {
      const body: TaxSetAsideStatus = { configured: false };
      return NextResponse.json(body, { headers });
    }

    return NextResponse.json(
      {
        configured: true,
        gst_registered: row.gstRegistered,
        income_tax_rate_bp: row.incomeTaxRateBp,
      },
      { headers },
    );
  } catch (error) {
    return NextResponse.json({ error: toRouteErrorMessage(error) }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request) || !(await getChatGPTUser())) {
    return NextResponse.json(
      { error: "Operator sign-in is required." },
      { status: 401, headers },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400, headers });
  }

  const { gst_registered, income_tax_rate_bp } = (body ?? {}) as Record<string, unknown>;

  if (typeof gst_registered !== "boolean") {
    return NextResponse.json(
      { error: "gst_registered must be a boolean." },
      { status: 400, headers },
    );
  }
  if (
    typeof income_tax_rate_bp !== "number" ||
    !Number.isInteger(income_tax_rate_bp) ||
    income_tax_rate_bp < 0 ||
    income_tax_rate_bp > 10000
  ) {
    return NextResponse.json(
      { error: "income_tax_rate_bp must be an integer between 0 and 10000." },
      { status: 400, headers },
    );
  }

  const ownerEmail = await getTaxOwnerEmail();
  const updatedAt = new Date().toISOString();

  try {
    const db = await getDb();
    await db
      .insert(taxProfiles)
      .values({ ownerEmail, gstRegistered: gst_registered, incomeTaxRateBp: income_tax_rate_bp, updatedAt })
      .onConflictDoUpdate({
        target: taxProfiles.ownerEmail,
        set: { gstRegistered: gst_registered, incomeTaxRateBp: income_tax_rate_bp, updatedAt },
      });

    return NextResponse.json({ configured: true, gst_registered, income_tax_rate_bp }, { headers });
  } catch (error) {
    return NextResponse.json({ error: toRouteErrorMessage(error) }, { status: 500, headers });
  }
}
