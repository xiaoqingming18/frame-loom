CREATE TABLE `channel_models` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`upstream_model_id` text NOT NULL,
	`display_name` text NOT NULL,
	`kind` text,
	`protocol` text NOT NULL,
	`profile_id` text,
	`overrides_json` text NOT NULL,
	`enabled` integer NOT NULL,
	`last_check_json` text,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_models_channel_upstream_protocol` ON `channel_models` (`channel_id`,`upstream_model_id`,`protocol`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`preset` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key_cipher` blob,
	`key_hint` text,
	`headers_cipher` blob,
	`header_names` text NOT NULL,
	`enabled` integer NOT NULL,
	`last_check_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_defaults` (
	`kind` text PRIMARY KEY NOT NULL,
	`channel_model_id` text,
	FOREIGN KEY (`channel_model_id`) REFERENCES `channel_models`(`id`) ON UPDATE no action ON DELETE set null
);
