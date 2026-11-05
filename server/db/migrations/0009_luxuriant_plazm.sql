ALTER TABLE `sessions` ADD `confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `must_change_password` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_at` integer;