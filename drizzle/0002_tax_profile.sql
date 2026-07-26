CREATE TABLE `tax_profiles` (
	`owner_email` text PRIMARY KEY NOT NULL,
	`gst_registered` integer NOT NULL,
	`income_tax_rate_bp` integer NOT NULL,
	`updated_at` text NOT NULL
);
