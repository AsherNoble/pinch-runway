/**
 * Server-side Pinch configuration only.
 *
 * This module intentionally exposes readiness information, never credentials.
 * It is safe for server-rendered UI and health routes, but must not be imported
 * by a client component that could cause environment values to be bundled.
 */
export type RunwayDataSourceMode = "seed" | "sandbox" | "invalid";

export interface PinchRuntimeConfig {
  data_source: RunwayDataSourceMode;
  application_id?: string;
  secret_key?: string;
  api_version: string;
  api_base_url: string;
}

export interface PinchReadiness {
  data_source: RunwayDataSourceMode;
  state: "demo" | "ready" | "not_configured" | "invalid_configuration";
  display_label: string;
}

const DEFAULT_API_VERSION = "2020.1";
const DEFAULT_SANDBOX_BASE_URL = "https://api.getpinch.com.au/test/";

type Environment = Record<string, string | undefined>;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getPinchRuntimeConfig(
  environment: Environment = process.env,
): PinchRuntimeConfig {
  const requestedSource = clean(environment.RUNWAY_DATA_SOURCE) ?? "seed";
  const data_source: RunwayDataSourceMode =
    requestedSource === "seed" || requestedSource === "sandbox"
      ? requestedSource
      : "invalid";

  return {
    data_source,
    application_id: clean(environment.PINCH_APPLICATION_ID),
    secret_key: clean(environment.PINCH_SECRET_KEY),
    api_version: clean(environment.PINCH_API_VERSION) ?? DEFAULT_API_VERSION,
    api_base_url:
      clean(environment.PINCH_API_BASE_URL) ?? DEFAULT_SANDBOX_BASE_URL,
  };
}

/**
 * Deliberately does not probe the API. A readiness marker must never turn a
 * failed Pinch request into a demo-looking success; Lane A's live smoke test
 * is the only proof of a connected sandbox.
 */
export function getPinchReadiness(
  config: PinchRuntimeConfig = getPinchRuntimeConfig(),
): PinchReadiness {
  if (config.data_source === "seed") {
    return {
      data_source: "seed",
      state: "demo",
      display_label: "Demo data — not connected to Pinch",
    };
  }

  if (config.data_source === "invalid") {
    return {
      data_source: "invalid",
      state: "invalid_configuration",
      display_label: "RUNWAY_DATA_SOURCE must be seed or sandbox",
    };
  }

  if (!config.application_id || !config.secret_key) {
    return {
      data_source: "sandbox",
      state: "not_configured",
      display_label: "Pinch sandbox credentials are not configured",
    };
  }

  try {
    const url = new URL(config.api_base_url);
    if (url.hostname !== "api.getpinch.com.au" || !url.pathname.startsWith("/test")) {
      return {
        data_source: "sandbox",
        state: "invalid_configuration",
        display_label: "Pinch sandbox URL must point to the Pinch test API",
      };
    }
  } catch {
    return {
      data_source: "sandbox",
      state: "invalid_configuration",
      display_label: "Pinch sandbox URL is invalid",
    };
  }

  return {
    data_source: "sandbox",
    state: "ready",
    display_label: "Pinch sandbox is configured — live verification still required",
  };
}
