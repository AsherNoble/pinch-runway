import type {
  BankAccountClass,
  BankAccountSummary,
  BankCashRole,
  BankTransaction,
} from "../runway-contracts";
import type { BasiqConfig } from "./config";

type Fetcher = typeof fetch;

interface TokenResponse {
  access_token: string;
  expires_in?: number;
}

interface BasiqList<T> {
  data?: T[];
  links?: { next?: string | null };
}

export interface BasiqJob {
  id: string;
  steps: readonly {
    title: string;
    status: string;
    result: unknown;
  }[];
}

export class BasiqError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly request_id: string | null;

  constructor(input: {
    message: string;
    status: number;
    code: string;
    request_id?: string | null;
  }) {
    super(input.message);
    this.name = "BasiqError";
    this.status = input.status;
    this.code = input.code;
    this.retryable = input.status === 429 || input.status >= 500;
    this.request_id = input.request_id ?? null;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function decimalToCents(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    throw new Error("Basiq returned an invalid money value.");
  }
  const negative = value.trim().startsWith("-");
  const [whole, fraction = ""] = value.trim().replace(/^-/, "").split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  const rounded =
    fraction.length > 2 && Number(fraction[2]) >= 5 ? cents + 1 : cents;
  const signed = negative ? -rounded : rounded;
  if (!Number.isSafeInteger(signed)) throw new Error("Basiq money value is too large.");
  return signed;
}

export function classifyAccount(value: unknown): {
  account_class: BankAccountClass;
  cash_role: BankCashRole;
} {
  const classType = text(record(value).type)?.toLowerCase() ?? "other";
  if (["transaction", "savings"].includes(classType)) {
    return {
      account_class: classType as "transaction" | "savings",
      cash_role: "operating_cash",
    };
  }
  if (["credit-card", "loan", "mortgage"].includes(classType)) {
    return {
      account_class: classType as "credit-card" | "loan" | "mortgage",
      cash_role: "liability",
    };
  }
  return { account_class: "other", cash_role: "excluded" };
}

export function normaliseAccount(value: unknown): BankAccountSummary {
  const account = record(value);
  const id = text(account.id);
  if (!id) throw new Error("Basiq account is missing an id.");
  const classification = classifyAccount(account.class);
  const accountNumber = text(account.accountNo);
  return {
    id,
    name: text(account.name) ?? "Unnamed account",
    masked_number: accountNumber ? `•••• ${accountNumber.slice(-4)}` : null,
    institution:
      text(account.institution) ?? text(record(account.links).institution),
    ...classification,
    currency: (text(account.currency) ?? "AUD").toUpperCase(),
    balance_cents: decimalToCents(account.balance ?? "0"),
    available_funds_cents:
      account.availableFunds === null || account.availableFunds === undefined
        ? null
        : decimalToCents(account.availableFunds),
    selected: false,
    last_updated_at: text(account.lastUpdated),
  };
}

export function normaliseTransaction(value: unknown): BankTransaction {
  const transaction = record(value);
  const id = text(transaction.id);
  const description =
    text(transaction.description) ?? text(transaction.enrichDescription);
  const direction = text(transaction.direction)?.toLowerCase();
  const status = text(transaction.status)?.toLowerCase();
  const postDate =
    (text(transaction.postDate) ?? text(transaction.transactionDate))?.slice(0, 10);
  const accountValue =
    text(transaction.account) ??
    text(record(transaction.links).account) ??
    text(record(transaction.account).id);
  const accountId = accountValue?.split("/").filter(Boolean).at(-1);
  if (!id || !description || !accountId || !postDate) {
    throw new Error("Basiq transaction is missing a required field.");
  }
  if (direction !== "debit" && direction !== "credit") {
    throw new Error("Basiq transaction has an unknown direction.");
  }
  if (status !== "posted" && status !== "pending") {
    throw new Error("Basiq transaction has an unknown status.");
  }
  return {
    id,
    account_id: accountId,
    description,
    amount_cents: Math.abs(decimalToCents(transaction.amount ?? "0")),
    direction,
    status,
    post_date: postDate,
    transaction_class:
      text(transaction.class) ?? text(record(transaction.class).type),
  };
}

export function jobComplete(job: BasiqJob): boolean {
  return job.steps.length > 0 && job.steps.every((step) => step.status === "success");
}

export function jobFailed(job: BasiqJob): boolean {
  return job.steps.some((step) => ["failed", "error"].includes(step.status));
}

export class BasiqClient {
  private readonly config: BasiqConfig;
  private readonly fetcher: Fetcher;
  private serverToken: { value: string; expires_at: number } | null = null;

  constructor(config: BasiqConfig, fetcher: Fetcher = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }

  private async token(scope: "SERVER_ACCESS" | "CLIENT_ACCESS", userId?: string) {
    if (
      scope === "SERVER_ACCESS" &&
      this.serverToken &&
      this.serverToken.expires_at > Date.now() + 120_000
    ) {
      return this.serverToken.value;
    }
    const body = new URLSearchParams({ scope });
    if (userId) body.set("userId", userId);
    const response = await this.raw("/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${this.config.api_key}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const payload = (await response.json()) as TokenResponse;
    if (!text(payload.access_token)) {
      throw new BasiqError({
        message: "Basiq authentication did not return a token.",
        status: 502,
        code: "invalid_token_response",
      });
    }
    if (scope === "SERVER_ACCESS") {
      this.serverToken = {
        value: payload.access_token,
        expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000,
      };
    }
    return payload.access_token;
  }

  async createUser(email: string): Promise<string> {
    const payload = await this.request<Record<string, unknown>>("/users", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    const id = text(payload.id);
    if (!id) throw new Error("Basiq did not return a user id.");
    return id;
  }

  async createConsentUrl(input: {
    user_id: string;
    state: string;
    action?: "connect" | "manage";
  }): Promise<string> {
    const clientToken = await this.token("CLIENT_ACCESS", input.user_id);
    const url = new URL(this.config.consent_url);
    url.searchParams.set("token", clientToken);
    url.searchParams.set("action", input.action ?? "connect");
    url.searchParams.set("state", input.state);
    return url.toString();
  }

  async getJob(id: string): Promise<BasiqJob> {
    const payload = await this.request<Record<string, unknown>>(
      `/jobs/${encodeURIComponent(id)}`,
    );
    const steps = Array.isArray(payload.steps) ? payload.steps.map((item) => {
      const step = record(item);
      return {
        title: text(step.title) ?? "unknown",
        status: text(step.status) ?? "unknown",
        result: step.result,
      };
    }) : [];
    return { id: text(payload.id) ?? id, steps };
  }

  async listAccounts(userId: string): Promise<BankAccountSummary[]> {
    const values = await this.paginate(
      `/users/${encodeURIComponent(userId)}/accounts`,
    );
    return values.map(normaliseAccount);
  }

  async listTransactions(
    userId: string,
    range?: { from: string; to: string },
  ): Promise<BankTransaction[]> {
    const query = new URLSearchParams({ limit: "500" });
    if (range) {
      query.set(
        "filter",
        `transaction.postDate.bt('${range.from}','${range.to}')`,
      );
    }
    const values = await this.paginate(
      `/users/${encodeURIComponent(userId)}/transactions?${query.toString()}`,
    );
    return values.map(normaliseTransaction);
  }

  async refreshConnections(userId: string): Promise<string[]> {
    const payload = await this.request<Record<string, unknown>>(
      `/users/${encodeURIComponent(userId)}/connections/refresh`,
      { method: "POST" },
    );
    const list = Array.isArray(payload.data) ? payload.data : [];
    return list
      .map((item) => text(record(item).id) ?? text(record(item).self)?.split("/").at(-1))
      .filter((id): id is string => Boolean(id));
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request(`/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
  }

  private async paginate(path: string): Promise<unknown[]> {
    const output: unknown[] = [];
    let next: string | null = path;
    const seen = new Set<string>();
    while (next) {
      if (seen.has(next)) throw new Error("Basiq pagination loop detected.");
      seen.add(next);
      const page = await this.request<BasiqList<unknown>>(next);
      output.push(...(Array.isArray(page.data) ? page.data : []));
      next = text(page.links?.next);
    }
    return output;
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const bearer = await this.token("SERVER_ACCESS");
    const response = await this.raw(path, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${bearer}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async raw(
    path: string,
    init: RequestInit,
    includeVersion = true,
  ): Promise<Response> {
    const url = new URL(path, `${this.config.base_url}/`);
    if (url.origin !== new URL(this.config.base_url).origin) {
      throw new Error("Basiq pagination returned an unexpected origin.");
    }
    const signal = AbortSignal.timeout(this.config.request_timeout_ms);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        signal,
        headers: {
          ...(includeVersion ? { "basiq-version": this.config.api_version } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      throw new BasiqError({
        message:
          error instanceof DOMException && error.name === "TimeoutError"
            ? "Basiq request timed out."
            : "Basiq request could not be completed.",
        status: 503,
        code: "transport_error",
      });
    }
    if (!response.ok) {
      throw new BasiqError({
        message: `Basiq request failed (${response.status}).`,
        status: response.status,
        code: response.status === 401 ? "authentication_failed" : "upstream_error",
        request_id:
          response.headers.get("x-request-id") ??
          response.headers.get("basiq-request-id"),
      });
    }
    return response;
  }
}
