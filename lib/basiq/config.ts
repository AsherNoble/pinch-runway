export interface BasiqConfig {
  api_key: string;
  base_url: string;
  api_version: string;
  consent_url: string;
  request_timeout_ms: number;
}

export type BasiqReadiness =
  | { ready: true; config: BasiqConfig }
  | { ready: false; message: string };

export function getBasiqReadiness(): BasiqReadiness {
  const apiKey = process.env.BASIQ_API_KEY?.trim();
  if (!apiKey) {
    return {
      ready: false,
      message: "Basiq sandbox is not configured. Add BASIQ_API_KEY server-side.",
    };
  }
  const baseUrl = process.env.BASIQ_API_BASE_URL?.trim() || "https://au-api.basiq.io";
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ready: false, message: "BASIQ_API_BASE_URL must be a valid URL." };
  }
  if (parsed.protocol !== "https:") {
    return { ready: false, message: "BASIQ_API_BASE_URL must use HTTPS." };
  }
  return {
    ready: true,
    config: {
      api_key: apiKey,
      base_url: parsed.toString().replace(/\/$/, ""),
      api_version: process.env.BASIQ_API_VERSION?.trim() || "3.0",
      consent_url: "https://consent.basiq.io/home",
      request_timeout_ms: 15_000,
    },
  };
}

export function requireBasiqConfig(): BasiqConfig {
  const readiness = getBasiqReadiness();
  if (!readiness.ready) throw new Error(readiness.message);
  return readiness.config;
}
