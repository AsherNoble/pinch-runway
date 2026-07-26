import type { ProviderEnvelope } from "./provenance";

export interface SeededGmailHeader {
  name: "From" | "To" | "Subject" | "Date";
  value: string;
}

export interface SeededGmailMessage {
  id: string;
  threadId: string;
  labelIds: readonly string[];
  internalDate: string;
  payload: {
    mimeType: "text/plain";
    headers: readonly SeededGmailHeader[];
    body: { data_text: string };
  };
  snippet: string;
  trust: "untrusted_external_content";
}

export interface SeededGmailThread {
  id: string;
  historyId: string;
  messages: readonly SeededGmailMessage[];
}

export interface SeededCalendarEvent {
  id: string;
  status: "confirmed";
  htmlLink: string;
  summary: string;
  description: string;
  location: string | null;
  start: { dateTime: string; timeZone: "Australia/Sydney" };
  end: { dateTime: string; timeZone: "Australia/Sydney" };
  attendees: readonly { email: string; responseStatus: "accepted" }[];
  trust: "untrusted_external_content";
}

export interface SimulatedGmailOutboxMessage {
  id: string;
  idempotency_key: string;
  thread_id: string;
  to: string;
  subject: string;
  body_text: string;
  created_at: string;
}

export interface SimulatedGmailOutboxStore {
  /**
   * Atomically retains the existing record for this idempotency key or inserts
   * the candidate. A database implementation should enforce a unique key.
   */
  putIfAbsent(candidate: SimulatedGmailOutboxMessage): Promise<{
    message: SimulatedGmailOutboxMessage;
    inserted: boolean;
  }>;
}

export const SEEDED_BUSINESS_PROFILE = {
  owner_name: "Mia Hart",
  business_name: "Mia Hart Photography",
  owner_email: "mia@mia-hart-photo.example",
  client_name: "Jordan Lee",
  client_business: "Northstar Pilates",
  client_email: "jordan@northstar-pilates.example",
  supplier_name: "Frame & Light Rentals",
  supplier_email: "accounts@frame-light.example",
  overdue_invoice_id: "INV-1047",
  overdue_invoice_amount_cents: 940_000,
  unexpected_bill_amount_cents: 1_870_000,
} as const;

const inboxMessages: readonly SeededGmailMessage[] = [
  {
    id: "gmail-msg-unexpected-bill",
    threadId: "gmail-thread-frame-light",
    labelIds: ["INBOX", "IMPORTANT"],
    internalDate: "1785076200000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Frame & Light Rentals <accounts@frame-light.example>" },
        { name: "To", value: SEEDED_BUSINESS_PROFILE.owner_email },
        { name: "Subject", value: "Invoice FL-8821 — equipment damage and replacement" },
        { name: "Date", value: "Sun, 26 Jul 2026 19:10:00 +1000" },
      ],
      body: {
        data_text:
          "Hi Mia,\n\nAttached is invoice FL-8821 for $18,700.00 AUD, due 3 August 2026. It covers the damaged cinema lens and the replacement hire required for last week's harbour campaign.\n\nPlease reply if you need the itemised assessment.\n\nFrame & Light Accounts",
      },
    },
    snippet: "Attached is invoice FL-8821 for $18,700.00 AUD, due 3 August 2026.",
    trust: "untrusted_external_content",
  },
  {
    id: "gmail-msg-client-brief",
    threadId: "gmail-thread-northstar",
    labelIds: ["SENT"],
    internalDate: "1783409400000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: `Mia Hart <${SEEDED_BUSINESS_PROFILE.owner_email}>` },
        { name: "To", value: `Jordan Lee <${SEEDED_BUSINESS_PROFILE.client_email}>` },
        { name: "Subject", value: "Northstar winter campaign — final delivery and INV-1047" },
        { name: "Date", value: "Tue, 7 Jul 2026 12:10:00 +1000" },
      ],
      body: {
        data_text:
          "Hi Jordan,\n\nThe final selects are in your shared gallery. Invoice INV-1047 for $9,400.00 AUD is due 22 July. Thanks again for a brilliant shoot.\n\nMia",
      },
    },
    snippet: "The final selects are in your shared gallery. Invoice INV-1047 is due 22 July.",
    trust: "untrusted_external_content",
  },
  {
    id: "gmail-msg-client-reply",
    threadId: "gmail-thread-northstar",
    labelIds: ["INBOX"],
    internalDate: "1783498500000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: `Jordan Lee <${SEEDED_BUSINESS_PROFILE.client_email}>` },
        { name: "To", value: `Mia Hart <${SEEDED_BUSINESS_PROFILE.owner_email}>` },
        { name: "Subject", value: "Re: Northstar winter campaign — final delivery and INV-1047" },
        { name: "Date", value: "Wed, 8 Jul 2026 12:55:00 +1000" },
      ],
      body: {
        data_text:
          "Thanks Mia — the campaign looks fantastic. I've sent INV-1047 to our accounts queue and copied the due date into our payment run.",
      },
    },
    snippet: "I've sent INV-1047 to our accounts queue and copied the due date into our payment run.",
    trust: "untrusted_external_content",
  },
];

const calendarEvents: readonly SeededCalendarEvent[] = [
  {
    id: "calendar-northstar-shoot",
    status: "confirmed",
    htmlLink: "https://calendar.google.com/calendar/event?eid=seeded-northstar-shoot",
    summary: "Northstar Pilates winter campaign shoot",
    description:
      "Completed client shoot. Final gallery and Pinch invoice INV-1047 delivered after the session.",
    location: "Northstar Pilates, Surry Hills NSW",
    start: { dateTime: "2026-07-06T08:00:00+10:00", timeZone: "Australia/Sydney" },
    end: { dateTime: "2026-07-06T13:00:00+10:00", timeZone: "Australia/Sydney" },
    attendees: [
      { email: SEEDED_BUSINESS_PROFILE.owner_email, responseStatus: "accepted" },
      { email: SEEDED_BUSINESS_PROFILE.client_email, responseStatus: "accepted" },
    ],
    trust: "untrusted_external_content",
  },
  {
    id: "calendar-frame-light-return",
    status: "confirmed",
    htmlLink: "https://calendar.google.com/calendar/event?eid=seeded-frame-light-return",
    summary: "Return cinema kit to Frame & Light",
    description: "Rental return after harbour campaign. Supplier inspection follows.",
    location: "Frame & Light Rentals, Alexandria NSW",
    start: { dateTime: "2026-07-20T09:00:00+10:00", timeZone: "Australia/Sydney" },
    end: { dateTime: "2026-07-20T09:30:00+10:00", timeZone: "Australia/Sydney" },
    attendees: [{ email: SEEDED_BUSINESS_PROFILE.owner_email, responseStatus: "accepted" }],
    trust: "untrusted_external_content",
  },
];

export function getSeededGmailThreads(): ProviderEnvelope<readonly SeededGmailThread[]> {
  const grouped = new Map<string, SeededGmailMessage[]>();
  for (const message of inboxMessages) {
    grouped.set(message.threadId, [...(grouped.get(message.threadId) ?? []), message]);
  }
  return {
    provider: "gmail",
    provenance: "simulated",
    retrieved_at: "2026-07-26T19:15:00+10:00",
    data: [...grouped].map(([id, messages], index) => ({
      id,
      historyId: String(10_001 + index),
      messages,
    })),
    warning: "Seeded Gmail fixture; no message was read from or sent through Google.",
  };
}

export function getSeededCalendarEvents(): ProviderEnvelope<readonly SeededCalendarEvent[]> {
  return {
    provider: "google_calendar",
    provenance: "simulated",
    retrieved_at: "2026-07-26T19:15:00+10:00",
    data: calendarEvents,
    warning: "Seeded Calendar fixture; no event was read from Google.",
  };
}

export async function sendSimulatedGmailMessage(
  input: {
    idempotency_key: string;
    thread_id: string;
    to: string;
    subject: string;
    body_text: string;
    now?: Date;
  },
  store: SimulatedGmailOutboxStore,
): Promise<ProviderEnvelope<{ message: SimulatedGmailOutboxMessage; reused: boolean }>> {
  const key = input.idempotency_key.trim();
  if (!key || !input.thread_id.trim() || !input.to.trim() || !input.subject.trim() || !input.body_text.trim()) {
    throw new Error("Simulated Gmail send requires an idempotency key, thread, recipient, subject, and body.");
  }
  const candidate: SimulatedGmailOutboxMessage = {
    id: `simulated-gmail-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    idempotency_key: key,
    thread_id: input.thread_id.trim(),
    to: input.to.trim().toLowerCase(),
    subject: input.subject.trim(),
    body_text: input.body_text,
    created_at: (input.now ?? new Date()).toISOString(),
  };
  const result = await store.putIfAbsent(candidate);
  return {
    provider: "gmail",
    provenance: "simulated",
    retrieved_at: result.message.created_at,
    data: { message: result.message, reused: !result.inserted },
    warning: result.inserted
      ? "Stored in the simulated Gmail outbox; no email was delivered."
      : "Reused a simulated Gmail outbox record; no email was delivered.",
  };
}
