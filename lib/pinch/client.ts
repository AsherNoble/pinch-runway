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

export interface CreatePinchPayerInput {
  first_name: string;
  last_name: string;
  email_address: string;
  mobile_number?: string;
}

export interface CreatedPinchPayer {
  id: string;
  first_name?: string;
  last_name?: string;
  email_address?: string;
}

export interface CreatePinchPaymentSourceInput {
  payer_id: string;
  /** Opaque, short-lived CaptureJS token. Never bank-account details. */
  token: string;
}

export interface CreatedPinchPaymentSource {
  id: string;
  raw_status?: string;
}

export interface CreatePinchScheduledPaymentInput {
  payer_id: string;
  source_id?: string;
  /** Integer cents. */
  amount: number;
  description: string;
  /** ISO calendar date: YYYY-MM-DD. */
  transaction_date: string;
  /** One-time provider idempotency value. */
  nonce: string;
}

export interface CreatedPinchScheduledPayment {
  id: string;
  payer_id?: string;
  transaction_date?: string;
  raw_status?: string;
}

export interface PinchTimeTravelOptions {
  /** UTC ISO timestamp, accepted only by this test-only client. */
  time_travel_at?: string;
}

export interface CreatePinchPaymentLinkInput {
  /** Integer cents. */
  amount: number;
  payer_id: string;
  description: string;
  return_url: string;
  allowed_payment_methods: readonly ("credit-card" | "bank-account")[];
  /**
   * Pinch accepts free text for Payment Link metadata.  Runway callers may use
   * a small structured record, which is serialised to JSON before it crosses
   * the provider boundary.
   */
  metadata?: string | Record<string, string | number | boolean | null>;
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

    if (
      this.apiBaseUrl.hostname !== "api.getpinch.com.au" ||
      !this.apiBaseUrl.pathname.startsWith("/test/")
    ) {
      throw new PinchApiError("Pinch sandbox client can only call the Pinch test API.");
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

  async getPayer(payerId: string): Promise<JsonRecord> {
    if (!payerId) throw new PinchApiError("A Pinch payer ID is required.");
    const payload = await this.requestJson<unknown>(`payers/${encodeURIComponent(payerId)}`);
    return asRecord(payload, "Pinch returned an invalid Payer response.");
  }

  async createPayer(input: CreatePinchPayerInput): Promise<CreatedPinchPayer> {
    if (!input.first_name.trim() || !input.last_name.trim() || !input.email_address.trim()) {
      throw new PinchApiError("Payer requires a first name, last name, and email address.");
    }

    const payload = await this.requestJson<unknown>("payers", {
      method: "POST",
      body: {
        firstName: input.first_name,
        lastName: input.last_name,
        emailAddress: input.email_address,
        ...(input.mobile_number ? { mobileNumber: input.mobile_number } : {}),
      },
    });
    const record = asRecord(payload, "Pinch returned an invalid Payer response.");
    const id = optionalString(record.id);

    if (!id) {
      throw new PinchApiError(
        "Pinch confirmed a response but it did not contain a Payer ID.",
      );
    }

    return {
      id,
      first_name: optionalString(record.firstName),
      last_name: optionalString(record.lastName),
      email_address:
        optionalString(record.emailAddress) ?? optionalString(record.email),
    };
  }

  async createPaymentSource(
    input: CreatePinchPaymentSourceInput,
  ): Promise<CreatedPinchPaymentSource> {
    if (!input.payer_id.trim() || !input.token.trim()) {
      throw new PinchApiError("A Payer ID and CaptureJS token are required for a Payment Source.");
    }

    const payload = await this.requestJson<unknown>(
      `payers/${encodeURIComponent(input.payer_id)}/sources`,
      {
        method: "POST",
        body: {
          sourceType: "bank-account",
          token: input.token,
        },
      },
    );
    const record = asRecord(payload, "Pinch returned an invalid Payment Source response.");
    const embeddedSource = isRecord(record.source) ? record.source : undefined;
    const id = optionalString(record.id) ?? optionalString(embeddedSource?.id);

    if (!id) {
      throw new PinchApiError(
        "Pinch confirmed a response but it did not contain a Payment Source ID.",
      );
    }

    return {
      id,
      raw_status: optionalString(record.status) ?? optionalString(embeddedSource?.status),
    };
  }

  async createScheduledPayment(
    input: CreatePinchScheduledPaymentInput,
  ): Promise<CreatedPinchScheduledPayment> {
    if (!input.payer_id.trim() || !input.description.trim() || !input.nonce.trim()) {
      throw new PinchApiError("Scheduled Payment requires a Payer ID, description, and nonce.");
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new PinchApiError("Scheduled Payment amount must be a positive integer number of cents.");
    }
    if (!isIsoCalendarDate(input.transaction_date)) {
      throw new PinchApiError("Scheduled Payment transaction date must be YYYY-MM-DD.");
    }

    const payload = await this.requestJson<unknown>("payments", {
      method: "POST",
      body: {
        payerId: input.payer_id,
        ...(input.source_id ? { sourceId: input.source_id } : {}),
        amount: input.amount,
        description: input.description,
        transactionDate: input.transaction_date,
        nonce: input.nonce,
      },
    });
    const record = asRecord(payload, "Pinch returned an invalid Scheduled Payment response.");
    const id = optionalString(record.id);

    if (!id) {
      throw new PinchApiError(
        "Pinch confirmed a response but it did not contain a Scheduled Payment ID.",
      );
    }

    return {
      id,
      payer_id: optionalString(record.payerId),
      transaction_date: optionalString(record.transactionDate),
      raw_status: optionalString(record.status),
    };
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

  async getPayment(
    paymentId: string,
    options: PinchTimeTravelOptions = {},
  ): Promise<JsonRecord> {
    if (!paymentId) throw new PinchApiError("A Pinch payment ID is required.");
    const payload = await this.requestJson<unknown>(
      `payments/${encodeURIComponent(paymentId)}`,
      { time_travel_at: options.time_travel_at },
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
        ...(input.metadata
          ? { metadata: serialisePaymentLinkMetadata(input.metadata) }
          : {}),
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

  async getPaymentLink(paymentLinkId: string): Promise<CreatedPinchPaymentLink> {
    if (!paymentLinkId) throw new PinchApiError("A Pinch Payment Link ID is required.");
    const record = asRecord(await this.requestJson<unknown>(`payment-links/${encodeURIComponent(paymentLinkId)}`), "Pinch returned an invalid Payment Link response.");
    const id = optionalString(record.id);
    const url = optionalString(record.url);
    const amount = optionalInteger(record.amountInCents) ?? optionalInteger(record.amount);
    if (!id || !url || amount === undefined) throw new PinchApiError("Pinch did not return the existing Payment Link details.");
    return { id, url, amount, payer_id: optionalString(record.payerId), raw_status: optionalString(record.status) };
  }

  private async requestJson<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      query?: Record<string, string | number | undefined>;
      body?: JsonRecord;
      time_travel_at?: string;
      retry_after_unauthorised?: boolean;
    } = {},
  ): Promise<T> {
    const accessToken = await this.getAccessToken();
    const url = new URL(path, this.apiBaseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const timeTravelAt = normaliseTimeTravelTimestamp(options.time_travel_at);
    const response = await this.fetchImplementation(url, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "pinch-version": this.config.api_version,
        ...(timeTravelAt ? { "time-travel": timeTravelAt } : {}),
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

function serialisePaymentLinkMetadata(
  metadata: NonNullable<CreatePinchPaymentLinkInput["metadata"]>,
): string {
  if (typeof metadata === "string") return metadata;
  return JSON.stringify(metadata);
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

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normaliseTimeTravelTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.endsWith("Z") || Number.isNaN(Date.parse(value))) {
    throw new PinchApiError("Pinch Time Travel must be a valid UTC ISO timestamp.");
  }
  return new Date(value).toISOString();
}
