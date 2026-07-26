CREATE TABLE `agent_approvals` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `tool_call_id` text NOT NULL,
  `tool_name` text NOT NULL,
  `action_class` text NOT NULL,
  `input_json` text NOT NULL,
  `summary` text NOT NULL,
  `status` text NOT NULL,
  `created_at` text NOT NULL,
  `decided_at` text,
  `result_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_approvals_tool_call` ON `agent_approvals` (`tool_call_id`);
--> statement-breakpoint
CREATE INDEX `agent_approvals_status` ON `agent_approvals` (`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `simulated_calendar_edits` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `event_id` text NOT NULL,
  `summary` text,
  `start_date_time` text,
  `end_date_time` text,
  `note` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `simulated_calendar_edits_event` ON `simulated_calendar_edits` (`event_id`,`created_at`);
