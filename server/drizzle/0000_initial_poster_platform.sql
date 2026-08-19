CREATE TABLE `access_grants` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text,
	`granted_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `access_grants_status_expiry_idx` ON `access_grants` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `app_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`display_name` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_profiles_role_idx` ON `app_profiles` (`role`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`safe_metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `invite_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_digest` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`used_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_codes_digest_unique` ON `invite_codes` (`code_digest`);--> statement-breakpoint
CREATE INDEX `invite_codes_status_expiry_idx` ON `invite_codes` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `invite_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`invite_code_id` text NOT NULL,
	`user_id` text NOT NULL,
	`redeemed_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invite_code_id`) REFERENCES `invite_codes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_redemptions_user_unique` ON `invite_redemptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `invite_redemptions_code_idx` ON `invite_redemptions` (`invite_code_id`);--> statement-breakpoint
CREATE TABLE `payment_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`merchant_order_no` text NOT NULL,
	`amount_fen` integer DEFAULT 80000 NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_provider` text DEFAULT 'wechat_pay' NOT NULL,
	`provider_transaction_id` text,
	`code_url` text,
	`failure_reason` text,
	`paid_at` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_orders_merchant_no_unique` ON `payment_orders` (`merchant_order_no`);--> statement-breakpoint
CREATE INDEX `payment_orders_user_created_idx` ON `payment_orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payment_orders_status_idx` ON `payment_orders` (`status`);--> statement-breakpoint
CREATE TABLE `payment_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`user_id` text,
	`provider_transaction_id` text,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`amount_fen` integer DEFAULT 0 NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`raw_event_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payment_transactions_order_idx` ON `payment_transactions` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_transactions_provider_tx_unique` ON `payment_transactions` (`provider_transaction_id`);--> statement-breakpoint
CREATE TABLE `poster_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`provider_task_id` text,
	`title` text DEFAULT '未命名海报' NOT NULL,
	`mode` text DEFAULT 'copy' NOT NULL,
	`poster_type` text DEFAULT '生活类' NOT NULL,
	`category` text DEFAULT '生活分享' NOT NULL,
	`ratio` text DEFAULT '3:4' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 8 NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`plan_json` text DEFAULT '{}' NOT NULL,
	`output_s3_uri` text,
	`remote_image_url` text,
	`error_message` text,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `poster_jobs_user_idempotency_unique` ON `poster_jobs` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `poster_jobs_user_updated_idx` ON `poster_jobs` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `poster_jobs_provider_task_idx` ON `poster_jobs` (`provider_task_id`);--> statement-breakpoint
CREATE TABLE `provider_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`key_prefix` text NOT NULL,
	`key_last4` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`verified_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_credentials_user_provider_unique` ON `provider_credentials` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `provider_credentials_user_status_idx` ON `provider_credentials` (`user_id`,`status`);