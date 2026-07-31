import type { RunwayDataSnapshot } from "../contracts";
import type { RunwaySnapshot } from "../runway-contracts";
import type {
  CreatedPinchPaymentLink,
  CreatePinchPaymentLinkInput,
} from "../pinch/client";
import type { IntegrationProvenance, ProviderEnvelope } from "./provenance";

export interface BasiqAgentSnapshot {
  connection_state: RunwaySnapshot["bank_source"]["state"];
  operating_cash_cents: number;
  liabilities_cents: number;
  selected_accounts: RunwaySnapshot["accounts"];
  expense_profile: RunwaySnapshot["expense_profile"];
}

export interface PinchAgentSnapshot {
  connection_state: RunwayDataSnapshot["data_source"]["connection_state"];
  payers: RunwayDataSnapshot["payers"];
  invoices: RunwayDataSnapshot["invoices"];
  payment_history: RunwayDataSnapshot["payment_history"];
}

async function withOptionalFallback<T>(input: {
  provider: "basiq" | "pinch";
  load_live: () => Promise<T>;
  load_fallback?: () => Promise<T> | T;
  now?: Date;
}): Promise<ProviderEnvelope<T>> {
  try {
    return {
      provider: input.provider,
      provenance: "live",
      retrieved_at: (input.now ?? new Date()).toISOString(),
      data: await input.load_live(),
    };
  } catch {
    if (!input.load_fallback) throw new Error(`${input.provider} live data is unavailable.`);
    return {
      provider: input.provider,
      provenance: "fallback",
      retrieved_at: (input.now ?? new Date()).toISOString(),
      data: await input.load_fallback(),
      warning: `${input.provider} live data was unavailable; fallback data is not provider-confirmed.`,
    };
  }
}

export async function loadBasiqAgentSnapshot(input: {
  load_live: () => Promise<RunwaySnapshot>;
  load_fallback?: () => Promise<RunwaySnapshot> | RunwaySnapshot;
  now?: Date;
}): Promise<ProviderEnvelope<BasiqAgentSnapshot>> {
  const adapt = (snapshot: RunwaySnapshot): BasiqAgentSnapshot => ({
    connection_state: snapshot.bank_source.state,
    operating_cash_cents: snapshot.operating_cash_cents,
    liabilities_cents: snapshot.liabilities_cents,
    selected_accounts: snapshot.accounts.filter((account) => account.selected),
    expense_profile: snapshot.expense_profile,
  });
  return withOptionalFallback({
    provider: "basiq",
    load_live: async () => {
      const snapshot = await input.load_live();
      if (
        snapshot.bank_source.state !== "connected" &&
        snapshot.bank_source.state !== "stale"
      ) {
        throw new Error("Basiq live data is not connected.");
      }
      return adapt(snapshot);
    },
    load_fallback: input.load_fallback
      ? async () => adapt(await input.load_fallback!())
      : undefined,
    now: input.now,
  });
}

export async function loadPinchAgentSnapshot(input: {
  load_live: () => Promise<RunwayDataSnapshot>;
  load_fallback?: () => Promise<RunwayDataSnapshot> | RunwayDataSnapshot;
  now?: Date;
}): Promise<ProviderEnvelope<PinchAgentSnapshot>> {
  const adapt = (snapshot: RunwayDataSnapshot): PinchAgentSnapshot => ({
    connection_state: snapshot.data_source.connection_state,
    payers: snapshot.payers,
    invoices: snapshot.invoices,
    payment_history: snapshot.payment_history,
  });
  return withOptionalFallback({
    provider: "pinch",
    load_live: async () => {
      const snapshot = await input.load_live();
      if (
        !snapshot.data_source.is_live ||
        snapshot.data_source.connection_state !== "connected"
      ) {
        throw new Error("Pinch live data is not connected.");
      }
      return adapt(snapshot);
    },
    load_fallback: input.load_fallback
      ? async () => adapt(await input.load_fallback!())
      : undefined,
    now: input.now,
  });
}

export interface PinchPaymentLinkClient {
  createPaymentLink(input: CreatePinchPaymentLinkInput): Promise<CreatedPinchPaymentLink>;
  getPaymentLink(id: string): Promise<CreatedPinchPaymentLink>;
}

export interface StoredPaymentLink {
  idempotency_key: string;
  provider_link_id: string;
  created_at: string;
}

/**
 * `runExclusive` must serialize one key across all workers. The existing D1
 * reservation flow can implement this seam; an in-memory mutex is not enough
 * in production.
 */
export interface PaymentLinkReuseStore {
  runExclusive<T>(idempotencyKey: string, operation: () => Promise<T>): Promise<T>;
  find(idempotencyKey: string): Promise<StoredPaymentLink | null>;
  save(record: StoredPaymentLink): Promise<void>;
}

/**
 * Metadata may arrive as free text, which cannot be spread into an object.  The
 * idempotency key has to survive either shape, so a string payload is folded
 * into a record under `note` rather than exploded into character-indexed keys.
 */
function withIdempotencyKey(
  metadata: CreatePinchPaymentLinkInput["metadata"],
  idempotencyKey: string,
): Record<string, string | number | boolean | null> {
  if (typeof metadata === "string") {
    return { note: metadata, runway_idempotency_key: idempotencyKey };
  }
  return { ...metadata, runway_idempotency_key: idempotencyKey };
}

export async function createOrReusePinchPaymentLink(
  input: CreatePinchPaymentLinkInput & { idempotency_key: string; now?: Date },
  dependencies: {
    client: PinchPaymentLinkClient;
    store: PaymentLinkReuseStore;
  },
): Promise<ProviderEnvelope<{ payment_link: CreatedPinchPaymentLink; reused: boolean }>> {
  const key = input.idempotency_key.trim();
  if (!key || key.length > 128) throw new Error("A valid payment-link idempotency key is required.");
  return dependencies.store.runExclusive(key, async () => {
    const existing = await dependencies.store.find(key);
    if (existing) {
      const paymentLink = await dependencies.client.getPaymentLink(existing.provider_link_id);
      return {
        provider: "pinch",
        provenance: "live",
        retrieved_at: (input.now ?? new Date()).toISOString(),
        data: { payment_link: paymentLink, reused: true },
      };
    }
    const paymentLink = await dependencies.client.createPaymentLink({
      amount: input.amount,
      payer_id: input.payer_id,
      description: input.description,
      return_url: input.return_url,
      allowed_payment_methods: input.allowed_payment_methods,
      metadata: withIdempotencyKey(input.metadata, key),
    });
    const timestamp = (input.now ?? new Date()).toISOString();
    await dependencies.store.save({
      idempotency_key: key,
      provider_link_id: paymentLink.id,
      created_at: timestamp,
    });
    return {
      provider: "pinch",
      provenance: "live",
      retrieved_at: timestamp,
      data: { payment_link: paymentLink, reused: false },
    };
  });
}

export function assertProvenance(
  value: IntegrationProvenance,
): asserts value is IntegrationProvenance {
  if (value !== "live" && value !== "simulated" && value !== "fallback") {
    throw new Error("Unknown integration provenance.");
  }
}
