import { NextResponse } from "next/server";
import {
  getTwilioWhatsAppConfig,
  parseInboundWhatsAppRequest,
  TwilioWhatsAppError,
} from "@/lib/agent-integrations";
import { runWhatsAppAgentTurn } from "@/lib/agent-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const inbound = await parseInboundWhatsAppRequest(
      request,
      getTwilioWhatsAppConfig(),
      process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim() || request.url,
    );
    const result = await runWhatsAppAgentTurn({
      body: inbound.data.body,
      providerMessageId: inbound.data.message_sid,
    });
    return NextResponse.json(
      { accepted: true, duplicate: result.duplicate, run_id: result.run_id },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof TwilioWhatsAppError && error.status
        ? error.status
        : 502;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "WhatsApp processing failed.",
      },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
