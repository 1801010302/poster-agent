CREATE TABLE `user_reference_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`path` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_reference_assets_user_role_unique` ON `user_reference_assets` (`user_id`,`role`);--> statement-breakpoint
CREATE INDEX `user_reference_assets_user_updated_idx` ON `user_reference_assets` (`user_id`,`updated_at`);