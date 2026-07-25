import { NextResponse } from "next/server";
import { and, desc, eq, gte, like, lte, or } from "drizzle-orm";
import { getDb, getReceiptsBucket } from "@/db";
import { expenses } from "@/db/schema";
import { monthBounds, normalizeExtractedExpense } from "@/lib/expenses";
import { getExpenseOwnerEmail } from "./owner";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

function toRouteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table") || message.includes("expenses")) {
    return "The expenses table is unavailable. Apply drizzle/0001_expenses.sql to D1.";
  }
  return message;
}

export async function GET(request: Request) {
  const ownerEmail = await getExpenseOwnerEmail();
  const url = new URL(request.url);
  const month = url.searchParams.get("month")?.trim() ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";

  try {
    const db = await getDb();
    const filters = [eq(expenses.ownerEmail, ownerEmail)];

    const bounds = month ? monthBounds(month) : null;
    if (month && !bounds) {
      return NextResponse.json({ error: "month must be YYYY-MM." }, { status: 400, headers });
    }
    if (bounds) {
      filters.push(gte(expenses.date, bounds.start));
      filters.push(lte(expenses.date, bounds.end));
    }

    if (q) {
      const pattern = `%${q.replace(/[%_]/g, "")}%`;
      filters.push(
        or(like(expenses.description, pattern), like(expenses.company, pattern))!,
      );
    }

    const rows = await db
      .select()
      .from(expenses)
      .where(and(...filters))
      .orderBy(desc(expenses.date), desc(expenses.id))
      .limit(200);

    return NextResponse.json({ expenses: rows }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: toRouteErrorMessage(error) },
      { status: 500, headers },
    );
  }
}

export async function POST(request: Request) {
  const ownerEmail = await getExpenseOwnerEmail();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400, headers });
  }

  const file = form.get("receipt");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "receipt file is required." }, { status: 400, headers });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "receipt must be an image." }, { status: 400, headers });
  }

  const amountRaw = form.get("amountCents") ?? form.get("amount");
  const gstRaw = form.get("gstCents") ?? form.get("gst");
  const includesRaw = form.get("amountIncludesGst");

  const normalized = normalizeExtractedExpense({
    date: form.get("date"),
    description: form.get("description"),
    company: form.get("company"),
    amountCents:
      typeof amountRaw === "string" && amountRaw.trim() !== ""
        ? Number(amountRaw)
        : undefined,
    amount: typeof amountRaw === "string" ? amountRaw : undefined,
    gstCents:
      typeof gstRaw === "string" && gstRaw.trim() !== "" ? Number(gstRaw) : undefined,
    gst: typeof gstRaw === "string" ? gstRaw : undefined,
    amountIncludesGst:
      includesRaw === "true" || includesRaw === "1" || includesRaw === "on"
        ? true
        : includesRaw === "false" || includesRaw === "0"
          ? false
          : true,
  });

  if (normalized.amountCents <= 0) {
    return NextResponse.json({ error: "amount must be greater than zero." }, { status: 400, headers });
  }

  const key = `${ownerEmail}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;

  try {
    const bucket = await getReceiptsBucket();
    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "image/jpeg" },
    });

    const db = await getDb();
    const [row] = await db
      .insert(expenses)
      .values({
        ownerEmail,
        date: normalized.date,
        description: normalized.description,
        company: normalized.company,
        amountCents: normalized.amountCents,
        gstCents: normalized.gstCents,
        amountIncludesGst: normalized.amountIncludesGst,
        receiptR2Key: key,
        createdAt: new Date().toISOString(),
      })
      .returning();

    return NextResponse.json({ expense: row }, { status: 201, headers });
  } catch (error) {
    return NextResponse.json(
      { error: toRouteErrorMessage(error) },
      { status: 500, headers },
    );
  }
}
