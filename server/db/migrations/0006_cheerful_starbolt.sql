CREATE TABLE `webhooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`chat_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`on_bans` integer DEFAULT true NOT NULL,
	`on_actions` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_sent_at` integer,
	`last_error` text
);
