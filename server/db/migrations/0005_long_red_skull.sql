CREATE TABLE `ban_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` integer NOT NULL,
	`jail` text NOT NULL,
	`ip` text NOT NULL,
	`banned_at` integer NOT NULL,
	`bantime` integer NOT NULL,
	`failures` integer NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ban_events_identity` ON `ban_events` (`host_id`,`jail`,`ip`,`banned_at`);--> statement-breakpoint
CREATE INDEX `ban_events_host_time` ON `ban_events` (`host_id`,`banned_at`);