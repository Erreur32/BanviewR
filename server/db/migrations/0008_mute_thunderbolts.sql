CREATE TABLE `avatars` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`data` blob NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_at` integer;