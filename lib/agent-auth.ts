import { getChatGPTUser } from "@/app/chatgpt-auth";

/**
 * Deployed as a fully open public demo: no real Pinch/Twilio credentials are
 * configured on it, so no action here has a real-world side effect. Genuine
 * ChatGPT-proxy identity is still honored when present; otherwise every
 * request is treated as the operator unless RUNWAY_ENABLE_DEMO_AGENT=0.
 */
export async function isAgentOperatorRequest(
  _request: Request,
): Promise<boolean> {
  if (await getChatGPTUser()) return true;
  return process.env.RUNWAY_ENABLE_DEMO_AGENT !== "0";
}
