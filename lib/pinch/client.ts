import type { PinchRuntimeConfig } from "./config";

const PINCH_AUTH_URL = "https://auth.getpinch.com.au/connect/token";
const TOKEN_REFRESH_SKEW_MS = 60_000;

type FetchImplementation = typeof fetch;
type JsonRecord = Record<string, unknown>;

interface CachedAccessToken {
  value: string;
  expires_at: number;
}

let cachedAccessToken: CachedAccessToken | undefined;

export class PinchApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "PinchApiError";
    this.status = status;
  }
}

export interface PinchPageOptions {
  page?: number;
  page_size?: number;
}

export interface CreatePinchPaymentLinkInput {
  /** Integer cents. */
  amount: number;
  payer_id: string;
  description: string;
  return_url: string;
  allowed_payment_methods: readonly ("credit-card" | "bank-account")[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface CreatedPinchPaymentLink {
  id: string;
  url: string;
  /** Integer cents, accepting either documented Pinch response field. */
  amount: number;
  payer_id?: string;
  raw_status?: string;
}

/**
 * Narrow, server-only primitive client for the documented Pinch sandbox API.
 *
 * It deliberately returns raw provider records for reads. The Lane A snapshot
 * adapter is responsible for normalising those records into the shared Runway
 * contract, so the forecast and UI never need to know Pinch payload shapes.
 */
export class PinchSandboxClient {
  private readonly apiBaseUrl: URL;
  private readonly config: PinchRuntimeConfig;
  private readonly fetchImplementation: FetchImplementation;

  constructor(
    config: PinchRuntimeConfig,
    fetchImplementation: FetchImplementation = fetch,
  ) {
    if (config.data_source !== "sandbox") {
      throw new PinchApiError(
        "Pinch client is unavailable while RUNWAY_DATA_SOURCE is not sandbox.",
      );
    }
    if (!config.application_id || !config.secret_key) {
      throw new PinchApiError("Pinch sandbox credentials are not configured.");
    }

    try {
      this.apiBaseUrl = new URL(config.api_base_url);
      if (!this.apiBaseUrl.pathname.endsWith("/")) {
        this.apiBaseUrl.pathname = `${this.apiBaseUrl.pathname}/`;
      }
    } catch {
      throw new PinchApiError("Pinch sandbox URL is invalid.");
    }

    this.config = config;
    this.fetchImplementation = fetchImplementation;
  }

  async listPayers(options: PinchPageOptions = {}): Promise<readonly JsonRecord[]> {
    const payload = await this.requestJson<unknown>("payers", {
      query: {
        page: options.page ?? 1,
        pageSize: options.page_size ?? 50,
      },
    });
    return extractCollection(payload, ["payers", "data", "items", "results"]);
  }

  async listScheduledPayments(
    options: PinchPageOptions = {},
  ): Promise<readonly JsonRecord[]> {
    const payload = await this.requestJson<unknown>("payments/scheduled", {
      query: {
        page: options.page ?? 1,
        pageSize: options.page_size ?? 50,
      },
    });
    return extractCollection(payload, ["payments", "data", "items", "results"]);
  }

  async listPaymentsForPayer(
    payerId: string,
    options: PinchPageOptions = {},
  ): Promise<readonly JsonRecord[]> {
    if (!payerId) throw new PinchApiError("A Pinch payer ID is required.");

    const payload = await this.requestJson<unknown>(
      `payments/payer/${encodeURIComponent(payerId)}`,
      {
        query: {
          page: options.page ?? 1,
          pageSize: options.page_size ?? 50,
        },
      },
    );
    return extractCollection(payload, ["payments", "data", "items", "results"]);
  }

  async getPayment(paymentId: string): Promise<JsonRecord> {
    if (!paymentId) throw new PinchApiError("A Pinch payment ID is required.");
    const payload = await this.requestJson<unknown>(
      `payments/${encodeURIComponent(paymentId)}`,
    );
    return asRecord(payload, "Pinch returned an invalid payment response.");
  }

  async createPaymentLink(
    input: CreatePinchPaymentLinkInput,
  ): Promise<CreatedPinchPaymentLink> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new PinchApiError("Payment Link amount must be a positive integer number of cents.");
    }
    if (!input.payer_id || !input.description || !input.return_url) {
      throw new PinchApiError(
        "Payment Link requires a payer ID, description, and return URL.",
      );
    }
    if (!input.allowed_payment_methods.length) {
      throw new PinchApiError("Payment Link requires at least one allowed payment method.");
    }

    const payload = await this.requestJson<unknown>("payment-links", {
      method: "POST",
      body: {
        amount: input.amount,
        payerId: input.payer_id,
        description: input.description,
        allowedPaymentMethods: input.allowed_payment_methods,
        returnUrl: input.return_url,
        currency: "AUD",
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
    const record = asRecord(payload, "Pinch returned an invalid Payment Link response.");
    const id = optionalString(record.id);
    const url = optionalString(record.url);
    const amount = optionalInteger(record.amountInCents) ?? optionalInteger(record.amount);

    if (!id || !url || amount === undefined) {
      throw new PinchApiError(
        "Pinch confirmed a response but it did not contain a Payment Link ID, URL, and amount.",
      );
    }

    const embeddedPayer = isRecord(record.payer) ? record.payer : undefined;
    return {
      id,
      url,
      amount,
      payer_id: optionalString(record.payerId) ?? optionalString(embeddedPayer?.id),
      raw_status: optionalString(record.status),
    };
  }

  private async requestJson<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      query?: Record<string, string | number | undefined>;
      body?: JsonRecord;
      retry_after_unauthorised?: boolean;
    } = {},
  ): Promise<T> {
    const accessToken = await this.getAccessToken();
    const url = new URL(path, this.apiBaseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await this.fetchImplementation(url, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "pinch-version": this.config.api_version,
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

    if (response.status === 401 && options.retry_after_unauthorised !== false) {
      cachedAccessToken = undefined;
      return this.requestJson<T>(path, {
        ...options,
        retry_after_unauthorised: false,
      });
    }

    if (!response.ok) {
      throw new PinchApiError(
        `Pinch API request failed with status ${response.status}.`,
        response.status,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new PinchApiError("Pinch API response was not valid JSON.", response.status);
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (cachedAccessToken && cachedAccessToken.expires_at - TOKEN_REFRESH_SKEW_MS > now) {
      return cachedAccessToken.value;
    }

    const basicCredentials = encodeBasicCredentials(
      `${this.config.application_id}:${this.config.secret_key}`,
    );
    const response = await this.fetchImplementation(PINCH_AUTH_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Basic ${basicCredentials}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=api1",
    });

    if (!response.ok) {
      throw new PinchApiError(
        `Pinch authentication failed with status ${response.status}.`,
        response.status,
      );
    }

    const payload = asRecord(
      await response.json(),
      "Pinch authentication response was invalid.",
    );
    const accessToken = optionalString(payload.access_token);
    const expiresIn = optionalInteger(payload.expires_in) ?? 3600;
    if (!accessToken) {
      throw new PinchApiError("Pinch authentication response did not include an access token.");
    }

    cachedAccessToken = {
      value: accessToken,
      expires_at: now + expiresIn * 1000,
    };
    return accessToken;
  }
}

/** Test-only reset for isolated mocked-fetch tests. */
export function resetPinchAccessTokenCacheForTests() {
  cachedAccessToken = undefined;
}

function encodeBasicCredentials(value: string): string {
  if (typeof btoa !== "function") {
    throw new PinchApiError("This server runtime cannot encode Pinch Basic credentials.");
  }
  return btoa(value);
}

function extractCollection(payload: unknown, preferredKeys: readonly string[]): readonly JsonRecord[] {
  if (Array.isArray(payload)) return payload.map((item) => asRecord(item, "Pinch list item was invalid."));

  const record = asRecord(payload, "Pinch list response was invalid.");
  for (const key of preferredKeys) {
    if (Array.isArray(record[key])) {
      return record[key].map((item) => asRecord(item, "Pinch list item was invalid."));
    }
  }
  throw new PinchApiError("Pinch list response did not contain a recognised collection.");
}

function asRecord(value: unknown, message: string): JsonRecord {
  if (!isRecord(value)) throw new PinchApiError(message);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
