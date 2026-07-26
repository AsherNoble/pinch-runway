import assert from "node:assert/strict";
import test from "node:test";
import type { RunwayDataSnapshot } from "../lib/contracts.ts";
import {
  createOrReusePinchPaymentLink,
  loadPinchAgentSnapshot,
} from "../lib/agent-integrations/financial.ts";
import {
  getSeededCalendarEvents,
  getSeededGmailThreads,
  SEEDED_BUSINESS_PROFILE,
  sendSimulatedGmailMessage,
} from "../lib/agent-integrations/google-seeded.ts";
import type {
  PaymentLinkReuseStore,
  StoredPaymentLink,
} from "../lib/agent-integrations/financial.ts";
import type {
  SimulatedGmailOutboxMessage,
  SimulatedGmailOutboxStore,
} from "../lib/agent-integrations/google-seeded.ts";
import type {
  CreatedPinchPaymentLink,
  CreatePinchPaymentLinkInput,
} from "../lib/pinch/client.ts";

class MemoryOutbox implements SimulatedGmailOutboxStore {
  readonly messages = new Map<string, SimulatedGmailOutboxMessage>();
  async putIfAbsent(candidate: SimulatedGmailOutboxMessage) {
    const existing = this.messages.get(candidate.idempotency_key);
    if (existing) return { message: existing, inserted: false };
    this.messages.set(candidate.idempotency_key, candidate);
    return { message: candidate, inserted: true };
  }
}

class MemoryPaymentLinks implements PaymentLinkReuseStore {
  readonly records = new Map<string, StoredPaymentLink>();
  async runExclusive<T>(_key: string, operation: () => Promise<T>) {
    return operation();
  }
  async find(key: string) {
    return this.records.get(key) ?? null;
  }
  async save(record: StoredPaymentLink) {
    this.records.set(record.idempotency_key, record);
  }
}

test("seeded Gmail and Calendar tell one coherent, explicitly simulated story", () => {
  const gmail = getSeededGmailThreads();
  const calendar = getSeededCalendarEvents();
  assert.equal(gmail.provenance, "simulated");
  assert.equal(calendar.provenance, "simulated");
  const messages = gmail.data.flatMap((thread) => thread.messages);
  const bill = messages.find((message) => message.id === "gmail-msg-unexpected-bill");
  assert.match(bill?.snippet ?? "", /\$18,700\.00.*3 August 2026/);
  assert.equal(bill?.trust, "untrusted_external_content");
  assert.ok(messages.some((message) =>
    message.snippet.includes(SEEDED_BUSINESS_PROFILE.overdue_invoice_id)));
  assert.ok(calendar.data.some((event) =>
    event.description.includes(SEEDED_BUSINESS_PROFILE.overdue_invoice_id)));
  assert.ok(gmail.warning?.includes("no message was read"));
});

test("simulated Gmail outbox is idempotent and never claims delivery", async () => {
  const store = new MemoryOutbox();
  const input = {
    idempotency_key: "reminder-INV-1047-2026-07-26",
    thread_id: "gmail-thread-northstar",
    to: SEEDED_BUSINESS_PROFILE.client_email,
    subject: "Re: Northstar winter campaign — INV-1047",
    body_text: "Hi Jordan, here is the secure payment link for INV-1047.",
    now: new Date("2026-07-26T10:00:00.000Z"),
  };
  const first = await sendSimulatedGmailMessage(input, store);
  const second = await sendSimulatedGmailMessage(input, store);
  assert.equal(first.data.reused, false);
  assert.equal(second.data.reused, true);
  assert.equal(store.messages.size, 1);
  assert.equal(first.provenance, "simulated");
  assert.match(first.warning ?? "", /no email was delivered/);
});

test("Pinch payment-link wrapper reuses provider link by idempotency key", async () => {
  const store = new MemoryPaymentLinks();
  let creates = 0;
  let createdInput: CreatePinchPaymentLinkInput | undefined;
  const link: CreatedPinchPaymentLink = {
    id: "plink-live-001",
    url: "https://pay.getpinch.com.au/pay/plink-live-001",
    amount: 940_000,
    payer_id: "payer-northstar",
    raw_status: "active",
  };
  const client = {
    async createPaymentLink(input: CreatePinchPaymentLinkInput) {
      creates += 1;
      createdInput = input;
      return link;
    },
    async getPaymentLink(id: string) {
      assert.equal(id, link.id);
      return link;
    },
  };
  const input = {
    idempotency_key: "INV-1047:2026-07-26",
    amount: 940_000,
    payer_id: "payer-northstar",
    description: "Invoice INV-1047",
    return_url: "https://runway.example/",
    allowed_payment_methods: ["credit-card", "bank-account"] as const,
    now: new Date("2026-07-26T10:00:00.000Z"),
  };
  const first = await createOrReusePinchPaymentLink(input, { client, store });
  const second = await createOrReusePinchPaymentLink(input, { client, store });
  assert.equal(creates, 1);
  assert.equal(first.data.reused, false);
  assert.equal(second.data.reused, true);
  assert.equal(first.provenance, "live");
  assert.deepEqual(createdInput?.metadata, {
    runway_idempotency_key: "INV-1047:2026-07-26",
  });
});

test("financial adapters label fallback data and never call it live", async () => {
  const fallback: RunwayDataSnapshot = {
    data_source: {
      source: "demo_fixture",
      connection_state: "demo",
      is_live: false,
      display_label: "Demo data — not connected to Pinch",
      last_synced_at: null,
    },
    payers: [],
    invoices: [],
    payment_history: [],
    declared_expenses: [],
  };
  const result = await loadPinchAgentSnapshot({
    load_live: async () => {
      throw new Error("secret upstream detail");
    },
    load_fallback: () => fallback,
    now: new Date("2026-07-26T10:00:00.000Z"),
  });
  assert.equal(result.provenance, "fallback");
  assert.equal(result.data.connection_state, "demo");
  assert.match(result.warning ?? "", /not provider-confirmed/);
  assert.doesNotMatch(result.warning ?? "", /secret upstream detail/);
});
