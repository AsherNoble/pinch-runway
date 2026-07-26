import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { taxProfiles } from "@/db/schema";
import type { TaxSetAsideStatus } from "@/lib/contracts";
import { getPinchReadiness, getPinchRuntimeConfig } from "@/lib/pinch/config";
import { loadPinchSnapshot } from "@/lib/pinch/snapshot";
import { getDemoRunwayView } from "@/lib/runway-view";
import { calculateTaxSetAside, currentBasQuarter } from "@/lib/tax";
import { getTaxOwnerEmail } from "../owner";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

function sydneyToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toRouteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table") || message.includes("tax_profiles")) {
    return "The tax_profiles table is unavailable. Apply drizzle/0002_tax_profile.sql to D1.";
  }
  return message;
}

export async function GET() {
  const ownerEmail = await getTaxOwnerEmail();
  const today = sydneyToday();
  const period = currentBasQuarter(today);

  try {
    const db = await getDb();
    const [profileRow] = await db
      .select()
      .from(taxProfiles)
      .where(eq(taxProfiles.ownerEmail, ownerEmail))
      .limit(1);

    if (!profileRow) {
      const body: TaxSetAsideStatus = { configured: false };
      return NextResponse.json(body, { headers });
    }

    const readiness = getPinchReadiness();
    const sandboxRequested = getPinchRuntimeConfig().data_source === "sandbox";
    let snapshot = getDemoRunwayView().snapshot;

    if (sandboxRequested && readiness.state === "ready") {
      try {
        snapshot = await loadPinchSnapshot(today);
      } catch (error) {
        // Unlike the dashboard, this route never mixes a failed live read
        // with fixture numbers under a relabeled source — a dollar estimate
        // must not be silently backed by demo data.
        return NextResponse.json(
          { error: "Live Pinch data could not be loaded: " + toRouteErrorMessage(error) },
          { status: 502, headers },
        );
      }
    } else if (sandboxRequested) {
      return NextResponse.json(
        { error: "Pinch sandbox is not ready: " + readiness.display_label },
        { status: 503, headers },
      );
    }

    // Invoices carry a due_date, not a separate settled/paid-on date, so it
    // is used as the period key here; this is an approximation until the
    // contract records when an invoice actually settled.
    const incomeReceived = snapshot.invoices
      .filter(
        (invoice) =>
          invoice.status === "paid" &&
          invoice.due_date >= period.start &&
          invoice.due_date <= period.end,
      )
      .reduce((total, invoice) => total + invoice.amount, 0);

    // GST credits from receipt expenses are not wired up yet — the expenses
    // table lives on a separate, unmerged branch. Tracked as a known gap.
    const expenseGstCredits = 0;

    const result = calculateTaxSetAside({
      period,
      income_received: incomeReceived,
      expense_gst_credits: expenseGstCredits,
      tax_profile: {
        gst_registered: profileRow.gstRegistered,
        income_tax_rate_bp: profileRow.incomeTaxRateBp,
      },
    });

    const body: TaxSetAsideStatus = {
      configured: true,
      data_source: snapshot.data_source,
      ...result,
    };
    return NextResponse.json(body, { headers });
  } catch (error) {
    return NextResponse.json({ error: toRouteErrorMessage(error) }, { status: 500, headers });
  }
}
