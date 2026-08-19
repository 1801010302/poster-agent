CREATE TABLE `user_daily_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`day_key` text NOT NULL,
	`user_id` text NOT NULL,
	`visit_count` integer DEFAULT 1 NOT NULL,
	`last_path` text DEFAULT 'create' NOT NULL,
	`first_seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_daily_activity_day_user_unique` ON `user_daily_activity` (`day_key`,`user_id`);--> statement-breakpoint
CREATE INDEX `user_daily_activity_day_seen_idx` ON `user_daily_activity` (`day_key`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `user_daily_activity_user_seen_idx` ON `user_daily_activity` (`user_id`,`last_seen_at`);