CREATE TABLE `agent_heartbeat_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `enabled` integer NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_heartbeat_executions` (
  `scheduled_hour` text PRIMARY KEY NOT NULL,
  `started_at` text NOT NULL,
  `completed_at` text,
  `status` text NOT NULL,
  `run_id` text,
  `error_code` text
);
--> statement-breakpoint
CREATE INDEX `agent_heartbeat_executions_started` ON `agent_heartbeat_executions` (`started_at`);
--> statement-breakpoint
INSERT INTO `agent_heartbeat_settings` (`id`,`enabled`,`updated_at`)
VALUES (1,1,'2026-07-26T00:00:00.000Z');
