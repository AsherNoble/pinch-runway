CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`company` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`gst_cents` integer NOT NULL,
	`amount_includes_gst` integer NOT NULL,
	`receipt_r2_key` text NOT NULL,
	`created_at` text NOT NULL
);
