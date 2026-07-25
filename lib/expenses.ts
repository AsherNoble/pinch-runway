/**
 * Receipt expense helpers. Money stays integer Australian cents.
 */

export type ExtractedExpense = {
  date: string;
  description: string;
  company: string;
  amountCents: number;
  gstCents: number;
  amountIncludesGst: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Convert dollars (number or "12.34") to cents; null if unusable. */
export function dollarsToCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 100);
  }
  return null;
}

/**
 * Derive GST cents when the model only gave a total.
 * AU GST is 1/11 of a GST-inclusive amount.
 */
export function deriveGstCents(
  amountCents: number,
  gstCents: number | null,
  amountIncludesGst: boolean,
): number {
  if (gstCents !== null && gstCents >= 0) return Math.round(gstCents);
  if (!amountIncludesGst || amountCents <= 0) return 0;
  return Math.round(amountCents / 11);
}

export function normalizeExtractedExpense(raw: {
  date?: unknown;
  description?: unknown;
  company?: unknown;
  amountCents?: unknown;
  amount_cents?: unknown;
  amount?: unknown;
  gstCents?: unknown;
  gst_cents?: unknown;
  gst?: unknown;
  amountIncludesGst?: unknown;
  amount_includes_gst?: unknown;
}): ExtractedExpense {
  const date =
    typeof raw.date === "string" && ISO_DATE.test(raw.date.trim())
      ? raw.date.trim()
      : new Date().toISOString().slice(0, 10);

  const description =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim()
      : "Receipt";

  const company =
    typeof raw.company === "string" && raw.company.trim()
      ? raw.company.trim()
      : "Unknown";

  const amountCents =
    (typeof raw.amountCents === "number" ? Math.round(raw.amountCents) : null) ??
    (typeof raw.amount_cents === "number" ? Math.round(raw.amount_cents) : null) ??
    dollarsToCents(raw.amount) ??
    0;

  const gstRaw =
    (typeof raw.gstCents === "number" ? Math.round(raw.gstCents) : null) ??
    (typeof raw.gst_cents === "number" ? Math.round(raw.gst_cents) : null) ??
    dollarsToCents(raw.gst);

  const amountIncludesGst =
    typeof raw.amountIncludesGst === "boolean"
      ? raw.amountIncludesGst
      : typeof raw.amount_includes_gst === "boolean"
        ? raw.amount_includes_gst
        : true;

  return {
    date,
    description,
    company,
    amountCents: Math.max(0, amountCents),
    gstCents: deriveGstCents(Math.max(0, amountCents), gstRaw, amountIncludesGst),
    amountIncludesGst,
  };
}

export function monthBounds(month: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, mon] = month.split("-").map(Number);
  if (mon < 1 || mon > 12) return null;
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}
