CREATE TABLE `risk_buffer_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `mode` text NOT NULL,
  `manual_cents` integer,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `risk_buffer_settings` (`id`,`mode`,`manual_cents`,`updated_at`)
VALUES (1,'auto',NULL,'2026-07-30T00:00:00.000Z');
