import { getChatGPTUser } from "@/app/chatgpt-auth";

export async function isAgentOperatorRequest(request: Request): Promise<boolean> {
  if (await getChatGPTUser()) return true;
  if (process.env.RUNWAY_ENABLE_DEMO_AGENT === "0") return false;

  const url = new URL(request.url);
  const localHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (!localHost) return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}
