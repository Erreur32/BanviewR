CREATE TABLE `agents` (
	`host_id` integer PRIMARY KEY NOT NULL,
	`secret_hash` text,
	`enroll_hash` text,
	`enroll_expires_at` integer,
	`enrolled_at` integer,
	`last_seen_at` integer,
	`version` text,
	`write_enabled` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_secret_hash_unique` ON `agents` (`secret_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_enroll_hash_unique` ON `agents` (`enroll_hash`);