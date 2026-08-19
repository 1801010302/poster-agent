CREATE TABLE `onboarding_tutorials` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`oss_uri` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text DEFAULT 'video/mp4' NOT NULL,
	`size_bytes` integer NOT NULL,
	`duration_seconds` integer,
	`status` text DEFAULT 'uploading' NOT NULL,
	`validation_error` text,
	`published_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `onboarding_tutorials_status_published_idx` ON `onboarding_tutorials` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `onboarding_tutorials_creator_created_idx` ON `onboarding_tutorials` (`created_by`,`created_at`);