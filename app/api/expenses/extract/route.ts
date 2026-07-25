import { NextResponse } from "next/server";
import { normalizeExtractedExpense } from "@/lib/expenses";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

const EXTRACT_PROMPT = `Extract expense details from this Australian tax receipt image.
Return ONLY a JSON object with keys:
- date (YYYY-MM-DD)
- description (short item/summary)
- company (merchant/supplier name)
- amountCents (integer total in cents)
- gstCents (integer GST in cents; 0 if none)
- amountIncludesGst (boolean; true if total includes GST)

If GST is not printed but total looks GST-inclusive, set amountIncludesGst true and gstCents to round(total/11).
If a field is missing, use best guess; never invent fake company names beyond what is on the receipt.`;

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 503, headers },
    );
  }

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

  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const dataUrl = `data:${file.type};base64,${btoa(binary)}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: EXTRACT_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        { error: "OpenAI extract failed.", detail: detail.slice(0, 300) },
        { status: 502, headers },
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "Empty extract response." }, { status: 502, headers });
    }

    const raw = JSON.parse(content) as Record<string, unknown>;
    return NextResponse.json({ expense: normalizeExtractedExpense(raw) }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Extract failed." },
      { status: 500, headers },
    );
  }
}
