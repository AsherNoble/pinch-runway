CREATE TABLE `agent_permissions` (
  `action_class` text PRIMARY KEY NOT NULL,
  `mode` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `trigger_type` text NOT NULL,
  `status` text NOT NULL,
  `provenance` text NOT NULL,
  `started_at` text NOT NULL,
  `completed_at` text,
  `summary` text,
  `forecast_json` text,
  `error_code` text
);
--> statement-breakpoint
CREATE INDEX `agent_runs_started` ON `agent_runs` (`started_at`);
--> statement-breakpoint
CREATE TABLE `agent_tool_calls` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `tool_name` text NOT NULL,
  `action_class` text,
  `status` text NOT NULL,
  `provenance` text NOT NULL,
  `input_json` text NOT NULL,
  `result_json` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_tool_calls_run` ON `agent_tool_calls` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `agent_messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `run_id` text,
  `channel` text NOT NULL,
  `direction` text NOT NULL,
  `provider_message_id` text,
  `body` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_messages_provider_id` ON `agent_messages` (`provider_message_id`);
--> statement-breakpoint
CREATE INDEX `agent_messages_created` ON `agent_messages` (`created_at`);
--> statement-breakpoint
CREATE TABLE `simulated_outbox` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `thread_id` text NOT NULL,
  `recipient` text NOT NULL,
  `subject` text NOT NULL,
  `body` text NOT NULL,
  `status` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `simulated_outbox_run` ON `simulated_outbox` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `demo_agent_state` (
  `id` integer PRIMARY KEY NOT NULL,
  `scenario_state` text NOT NULL,
  `active_run_id` text,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `agent_permissions` (`action_class`,`mode`,`updated_at`) VALUES
  ('collection_email','auto','2026-07-26T00:00:00.000Z'),
  ('payment_link','auto','2026-07-26T00:00:00.000Z'),
  ('calendar_edit','blocked','2026-07-26T00:00:00.000Z'),
  ('receipt_request','ask','2026-07-26T00:00:00.000Z');
--> statement-breakpoint
INSERT INTO `demo_agent_state` (`id`,`scenario_state`,`active_run_id`,`updated_at`)
VALUES (1,'ready',NULL,'2026-07-26T00:00:00.000Z');
