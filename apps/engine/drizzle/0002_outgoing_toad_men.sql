CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`channel_model_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`profile_json` text NOT NULL,
	`status` text NOT NULL,
	`request_json` text NOT NULL,
	`remote_task_id` text,
	`remote_status` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_poll_at` text,
	`deadline_at` text NOT NULL,
	`error_category` text,
	`error_code` text,
	`error_message` text,
	`usage_json` text,
	`raw_response_json` text,
	`outputs_json` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `generation_jobs_schedule` ON `generation_jobs` (`status`,`next_poll_at`);--> statement-breakpoint
CREATE TABLE `media_files` (
	`sha256` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`created_at` text NOT NULL,
	`ext` text NOT NULL
);
