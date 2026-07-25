import { NextResponse } from "next/server";
import { PinchSandboxClient } from "@/lib/pinch/client";
import { getPinchReadiness, getPinchRuntimeConfig } from "@/lib/pinch/config";

export const dynamic = "force-dynamic";

/**
 * A real, read-only sandbox probe. It is intentionally a health endpoint,
 * not a fixture fallback: non-live errors remain visibly non-live errors.
 */
export async function GET() {
  const config = getPinchRuntimeConfig();
  const readiness = getPinchReadiness(config);

  if (readiness.state !== "ready") {
    return NextResponse.json(
      {
        data_source: readiness.data_source,
        connection_state: readiness.state,
        is_live: false,
        message: readiness.display_label,
      },
      { status: 503 },
    );
  }

  try {
    const client = new PinchSandboxClient(config);
    const payers = await client.listPayers({ page: 1, page_size: 1 });
    return NextResponse.json(
      {
        data_source: "pinch_sandbox",
        connection_state: "connected",
        is_live: true,
        message: "Pinch sandbox responded to a live Payers request.",
        first_page_record_count: payers.length,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      {
        data_source: "pinch_sandbox",
        connection_state: "error",
        is_live: false,
        message: "Pinch sandbox probe failed. No demo data has been substituted.",
      },
      { status: 502 },
    );
  }
}
