import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { collectionActions } from "@/db/schema";
import { sendPaymentLinkEmail } from "@/app/api/collection-actions/[id]/email/send";
import { resetPinchAccessTokenCacheForTests } from "@/lib/pinch/client";
import { emailPaymentLink } from "@/lib/resend";

vi.mock("@/lib/resend", () => ({
  emailPaymentLink: vi.fn(),
}));

const mockedEmailPaymentLink = vi.mocked(emailPaymentLink);

function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let payerEmail: string | undefined;
let paymentLinkReads: number;

function installFakePinch(): void {
  vi.stubGlobal(
    "fetch",
    async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = input instanceof URL ? input : new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.pathname;

      if (url.host === "auth.getpinch.com.au") {
        return json({ access_token: "tok_email_test", expires_in: 3600 });
      }
      if (method === "GET" && path === "/test/payers") {
        return json({ data: [{ id: "PAYER1" }] });
      }
      if (
        method === "GET" &&
        path === "/test/payments/payer/PAYER1"
      ) {
        return json({ data: [{ id: "INV-EMAIL" }] });
      }
      if (method === "GET" && path === "/test/payers/PAYER1") {
        return json({
          id: "PAYER1",
          firstName: "Provider",
          lastName: "Payer",
          ...(payerEmail ? { emailAddress: payerEmail } : {}),
        });
      }
      if (
        method === "GET" &&
        path === "/test/payment-links/plink_email"
      ) {
        paymentLinkReads += 1;
        return json({
          id: "plink_email",
          url: "https://pay.test/plink_email",
          amountInCents: 12500,
        });
      }

      throw new Error(
        `Unexpected fetch in email test: ${method} ${url.toString()}`,
      );
    },
  );
}

async function seedLink(actionDate = sydneyToday()): Promise<void> {
  const now = new Date().toISOString();
  await (await getDb()).insert(collectionActions).values({
    invoiceId: "INV-EMAIL",
    actionDate,
    state: "link_created",
    pinchLinkId: "plink_email",
    createdAt: now,
    reservedAt: now,
    linkCreatedAt: now,
  });
}

async function readEmailRow() {
  return (
    await (await getDb())
      .select()
      .from(collectionActions)
      .where(eq(collectionActions.invoiceId, "INV-EMAIL"))
      .limit(1)
  )[0];
}

beforeEach(async () => {
  await (await getDb()).delete(collectionActions);
  resetPinchAccessTokenCacheForTests();
  payerEmail = "provider@example.test";
  paymentLinkReads = 0;
  mockedEmailPaymentLink.mockReset();
  mockedEmailPaymentLink.mockResolvedValue("re_email_123");
  installFakePinch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendPaymentLinkEmail", () => {
  it("requires a confirmed payment link recorded for the current Sydney day", async () => {
    await seedLink("2000-01-01");

    const response = await sendPaymentLinkEmail("INV-EMAIL");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "No created payment link exists for this invoice today.",
    });
    expect(mockedEmailPaymentLink).not.toHaveBeenCalled();
    expect(paymentLinkReads).toBe(0);
  });

  it("uses the provider-sourced payer email and records the Resend delivery in D1", async () => {
    await seedLink();

    const response = await sendPaymentLinkEmail("INV-EMAIL");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      state: string;
      emailed_at: string;
      resend_email_id: string;
      reused: boolean;
    };
    expect(body).toMatchObject({
      state: "shared",
      resend_email_id: "re_email_123",
      reused: false,
    });
    expect(mockedEmailPaymentLink).toHaveBeenCalledOnce();
    expect(mockedEmailPaymentLink).toHaveBeenCalledWith({
      to: "provider@example.test",
      payerName: "Provider Payer",
      paymentLink: "https://pay.test/plink_email",
    });
    expect(paymentLinkReads).toBe(1);

    const row = await readEmailRow();
    expect(row?.state).toBe("shared");
    expect(row?.resendEmailId).toBe("re_email_123");
    expect(row?.emailedAt).toBe(body.emailed_at);
    expect(row?.sharedAt).toBe(body.emailed_at);
  });

  it("returns a visible conflict when Pinch has no payer email and does not send", async () => {
    payerEmail = undefined;
    await seedLink();

    const response = await sendPaymentLinkEmail("INV-EMAIL");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "The Pinch Payer has no email address.",
    });
    expect(mockedEmailPaymentLink).not.toHaveBeenCalled();

    const row = await readEmailRow();
    expect(row?.state).toBe("link_created");
    expect(row?.resendEmailId).toBeNull();
    expect(row?.emailedAt).toBeNull();
    expect(row?.sharedAt).toBeNull();
  });

  it("reports a Resend failure without marking the action as emailed", async () => {
    mockedEmailPaymentLink.mockRejectedValue(
      new Error("Resend rejected the message."),
    );
    await seedLink();

    const response = await sendPaymentLinkEmail("INV-EMAIL");

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Resend rejected the message.",
    });
    expect(mockedEmailPaymentLink).toHaveBeenCalledOnce();

    const row = await readEmailRow();
    expect(row?.state).toBe("link_created");
    expect(row?.resendEmailId).toBeNull();
    expect(row?.emailedAt).toBeNull();
    expect(row?.sharedAt).toBeNull();
  });

  it("reuses the recorded delivery result without calling Pinch or Resend again", async () => {
    await seedLink();
    const first = await sendPaymentLinkEmail("INV-EMAIL");
    const firstBody = (await first.json()) as {
      emailed_at: string;
      resend_email_id: string;
    };
    vi.stubGlobal("fetch", () => {
      throw new Error("Pinch must not be called for a recorded delivery.");
    });

    const repeated = await sendPaymentLinkEmail("INV-EMAIL");

    expect(repeated.status).toBe(200);
    await expect(repeated.json()).resolves.toEqual({
      state: "shared",
      emailed_at: firstBody.emailed_at,
      resend_email_id: firstBody.resend_email_id,
      reused: true,
    });
    expect(mockedEmailPaymentLink).toHaveBeenCalledOnce();
    expect(paymentLinkReads).toBe(1);
  });
});
