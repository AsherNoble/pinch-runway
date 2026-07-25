CREATE TABLE `collection_actions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `invoice_id` text NOT NULL,
  `action_date` text NOT NULL,
  `state` text NOT NULL,
  `pinch_link_id` text,
  `created_at` text NOT NULL,
  `reserved_at` text NOT NULL,
  `link_created_at` text,
  `shared_at` text,
  `error_code` text,
  `error_status` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_actions_invoice_day` ON `collection_actions` (`invoice_id`,`action_date`);
--> statement-breakpoint
CREATE TABLE `pinch_webhook_events` (
  `event_id` text PRIMARY KEY NOT NULL,
  `received_at` text NOT NULL,
  `event_type` text NOT NULL,
  `payment_id` text,
  `status` text
);
