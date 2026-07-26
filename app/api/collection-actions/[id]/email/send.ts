import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { collectionActions } from "@/db/schema";
import { PinchSandboxClient } from "@/lib/pinch/client";
import { getPinchRuntimeConfig } from "@/lib/pinch/config";
import { emailPaymentLink } from "@/lib/resend";

const headers = { "cache-control": "no-store" };

function sydneyDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Email today's confirmed Pinch payment link, minus the operator auth and
 * same-origin guards. Extracted so integration tests can use real D1 while
 * replacing only the external Pinch and Resend services.
 */
export async function sendPaymentLinkEmail(invoiceId: string): Promise<Response> {
  const db = await getDb();
  const row = (
    await db
      .select()
      .from(collectionActions)
      .where(
        and(
          eq(collectionActions.invoiceId, invoiceId),
          eq(collectionActions.actionDate, sydneyDay()),
        ),
      )
      .limit(1)
  )[0];

  if (!row?.pinchLinkId) {
    return NextResponse.json(
      { error: "No created payment link exists for this invoice today." },
      { status: 409, headers },
    );
  }

  if (row.emailedAt) {
    return NextResponse.json(
      {
        state: "shared",
        emailed_at: row.emailedAt,
        resend_email_id: row.resendEmailId,
        reused: true,
      },
      { headers },
    );
  }

  try {
    const client = new PinchSandboxClient(getPinchRuntimeConfig());
    const payerId = await findPayerId(client, invoiceId);
    const payer = await client.getPayer(payerId);
    const email = optionalString(payer.emailAddress) ?? optionalString(payer.email);

    if (!email) {
      return NextResponse.json(
        { error: "The Pinch Payer has no email address." },
        { status: 409, headers },
      );
    }

    const link = await client.getPaymentLink(row.pinchLinkId);
    const resendEmailId = await emailPaymentLink({
      to: email,
      payerName:
        [optionalString(payer.firstName), optionalString(payer.lastName)]
          .filter(Boolean)
          .join(" ") || email,
      paymentLink: link.url,
    });
    const emailedAt = new Date().toISOString();

    await db
      .update(collectionActions)
      .set({
        state: "shared",
        sharedAt: emailedAt,
        emailedAt,
        resendEmailId,
      })
      .where(eq(collectionActions.id, row.id));

    return NextResponse.json(
      {
        state: "shared",
        emailed_at: emailedAt,
        resend_email_id: resendEmailId,
        reused: false,
      },
      { headers },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Email delivery failed.",
      },
      { status: 502, headers },
    );
  }
}

async function findPayerId(
  client: PinchSandboxClient,
  invoiceId: string,
): Promise<string> {
  const payers = await client.listPayers({ page: 1, page_size: 100 });

  for (const candidate of payers) {
    const payerId = optionalString(candidate.id);
    if (!payerId) continue;

    const payments = await client.listPaymentsForPayer(payerId, {
      page: 1,
      page_size: 100,
    });
    if (
      payments.some((payment) => optionalString(payment.id) === invoiceId)
    ) {
      return payerId;
    }
  }

  throw new Error(
    "The Pinch invoice is no longer available for email delivery.",
  );
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
