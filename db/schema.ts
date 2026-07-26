import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Minimal, non-sensitive action ledger. Australia/Sydney date is supplied by server code. */
export const collectionActions = sqliteTable("collection_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: text("invoice_id").notNull(),
  actionDate: text("action_date").notNull(),
  state: text("state", { enum: ["reserving", "link_created", "shared", "failed_known", "outcome_unknown"] }).notNull(),
  pinchLinkId: text("pinch_link_id"),
  createdAt: text("created_at").notNull(),
  reservedAt: text("reserved_at").notNull(),
  linkCreatedAt: text("link_created_at"),
  sharedAt: text("shared_at"),
  resendEmailId: text("resend_email_id"),
  emailedAt: text("emailed_at"),
  errorCode: text("error_code"),
  errorStatus: integer("error_status"),
}, (table) => [uniqueIndex("collection_actions_invoice_day").on(table.invoiceId, table.actionDate)]);

export const pinchWebhookEvents = sqliteTable("pinch_webhook_events", {
  eventId: text("event_id").primaryKey(),
  receivedAt: text("received_at").notNull(),
  eventType: text("event_type").notNull(),
  paymentId: text("payment_id"),
  status: text("status"),
});
