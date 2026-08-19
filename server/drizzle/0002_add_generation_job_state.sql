ALTER TABLE `poster_jobs` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `poster_jobs` ADD `error_category` text;--> statement-breakpoint
ALTER TABLE `poster_jobs` ADD `failure_stage` text;--> statement-breakpoint
ALTER TABLE `poster_jobs` ADD `retryable` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `poster_jobs` ADD `attempt_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `poster_jobs` ADD `last_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `poster_jobs` ADD `deadline_at` integer;