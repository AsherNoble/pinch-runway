CREATE TABLE `runway_profiles` (
  `id` integer PRIMARY KEY NOT NULL,
  `operator_email` text NOT NULL,
  `basiq_user_id` text,
  `bank_state` text NOT NULL,
  `consent_status` text NOT NULL,
  `connect_state_hash` text,
  `last_synced_at` text,
  `sync_error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_accounts` (
  `account_id` text PRIMARY KEY NOT NULL,
  `profile_id` integer NOT NULL,
  `name` text NOT NULL,
  `masked_number` text,
  `institution` text,
  `account_class` text NOT NULL,
  `cash_role` text NOT NULL,
  `currency` text NOT NULL,
  `balance_cents` integer NOT NULL,
  `available_funds_cents` integer,
  `selected` integer NOT NULL,
  `last_updated_at` text,
  `synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bank_accounts_profile_selected` ON `bank_accounts` (`profile_id`,`selected`);
--> statement-breakpoint
CREATE TABLE `bank_snapshots` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `profile_id` integer NOT NULL,
  `created_at` text NOT NULL,
  `operating_cash_cents` integer NOT NULL,
  `liabilities_cents` integer NOT NULL,
  `expense_profile_json` text
);
--> statement-breakpoint
CREATE INDEX `bank_snapshots_profile_created` ON `bank_snapshots` (`profile_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `expense_exclusions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `profile_id` integer NOT NULL,
  `pattern` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_exclusions_profile_pattern` ON `expense_exclusions` (`profile_id`,`pattern`);
--> statement-breakpoint
CREATE TABLE `receivables` (
  `id` text PRIMARY KEY NOT NULL,
  `payer_name` text NOT NULL,
  `payer_email` text NOT NULL,
  `safe_address` text NOT NULL,
  `amount_cents` integer NOT NULL,
  `issued_date` text NOT NULL,
  `due_date` text NOT NULL,
  `status` text NOT NULL,
  `paid_date` text,
  `payer_history_count` integer NOT NULL,
  `avg_days_late` integer,
  `reminder_count` integer NOT NULL,
  `last_reminder_at` text,
  `source` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `receivables_status_due` ON `receivables` (`status`,`due_date`);
--> statement-breakpoint
CREATE TABLE `reminder_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `local_date` text NOT NULL,
  `evaluated_at` text NOT NULL,
  `target_receivable_id` text,
  `eligible` integer NOT NULL,
  `suppression_reason` text,
  `earliest_breach_date` text,
  `risk_buffer_cents` integer NOT NULL,
  `cash_at_breach_cents` integer,
  `repair_amount_cents` integer,
  `forecast_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_decisions_local_target` ON `reminder_decisions` (`local_date`,`target_receivable_id`);
--> statement-breakpoint
CREATE TABLE `reminder_deliveries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `decision_id` text NOT NULL,
  `receivable_id` text NOT NULL,
  `reminder_sequence` integer NOT NULL,
  `intended_recipient` text NOT NULL,
  `actual_recipient` text NOT NULL,
  `automation_mode` text NOT NULL,
  `provider_delivery_id` text,
  `status` text NOT NULL,
  `reserved_at` text NOT NULL,
  `sent_at` text,
  `terminal_at` text,
  `error_code` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_deliveries_decision` ON `reminder_deliveries` (`decision_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_deliveries_invoice_sequence` ON `reminder_deliveries` (`receivable_id`,`reminder_sequence`);
--> statement-breakpoint
CREATE TABLE `scheduler_executions` (
  `local_date` text PRIMARY KEY NOT NULL,
  `started_at` text NOT NULL,
  `completed_at` text,
  `status` text NOT NULL,
  `decision_id` text,
  `error_code` text
);
--> statement-breakpoint
CREATE TABLE `basiq_webhook_events` (
  `event_id` text PRIMARY KEY NOT NULL,
  `received_at` text NOT NULL,
  `event_type` text NOT NULL,
  `entity_url` text
);
--> statement-breakpoint
INSERT INTO `receivables` (
  `id`,`payer_name`,`payer_email`,`safe_address`,`amount_cents`,
  `issued_date`,`due_date`,`status`,`paid_date`,`payer_history_count`,
  `avg_days_late`,`reminder_count`,`last_reminder_at`,`source`,`updated_at`
) VALUES
  ('DEMO-1042','Harbour Studio','accounts@harbour-studio.example','10 Sample Street, Sydney NSW 2000',245000,'2026-06-25','2026-07-16','unpaid',NULL,4,3,1,NULL,'demo','2026-07-26T00:00:00.000Z'),
  ('DEMO-1047','Lumen Events','payables@lumen-events.example','22 Example Avenue, Newcastle NSW 2300',128500,'2026-07-04','2026-07-18','unpaid',NULL,3,8,0,NULL,'demo','2026-07-26T00:00:00.000Z'),
  ('DEMO-1051','New Leaf Allied Health','finance@new-leaf.example','4 Test Lane, Wollongong NSW 2500',360000,'2026-07-14','2026-07-28','unpaid',NULL,0,NULL,0,NULL,'demo','2026-07-26T00:00:00.000Z'),
  ('DEMO-1031','Paper Kite Co','hello@paper-kite.example','7 Prototype Road, Parramatta NSW 2150',97500,'2026-06-02','2026-06-16','paid','2026-06-17',5,1,0,NULL,'demo','2026-07-26T00:00:00.000Z');
