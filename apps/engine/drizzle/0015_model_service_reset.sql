DROP TABLE `model_defaults`;
--> statement-breakpoint
DROP TABLE `tts_voices`;
--> statement-breakpoint
DROP TABLE `model_catalog`;
--> statement-breakpoint
DROP TABLE `channel_models`;
--> statement-breakpoint
DROP TABLE `channels`;
--> statement-breakpoint
DROP TABLE `provider_uploads`;
--> statement-breakpoint
DROP TABLE `generation_jobs`;
--> statement-breakpoint
DELETE FROM `app_meta` WHERE `key` IN ('model_bindings_v1', 'model_upgrade_report', 'image_edit_capabilities_v1');
--> statement-breakpoint
CREATE TABLE `channels` (
  `id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `base_url` text NOT NULL,
  `catalog_format` text NOT NULL, `concurrency` integer NOT NULL,
  `api_key_cipher` blob, `key_hint` text, `secret_key_cipher` blob,
  `headers_cipher` blob, `header_names` text NOT NULL, `enabled` integer NOT NULL,
  `created_at` text NOT NULL, `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `models` (
  `id` text PRIMARY KEY NOT NULL, `channel_id` text NOT NULL, `kind` text NOT NULL,
  `upstream_model_id` text NOT NULL, `display_name` text NOT NULL, `protocol_id` text NOT NULL,
  `endpoint_override_json` text NOT NULL, `transport_json` text NOT NULL, `capability_json` text NOT NULL,
  `extras_json` text NOT NULL, `fixed_fields_json` text NOT NULL, `concurrency` integer,
  `enabled` integer NOT NULL, `last_check_json` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `models_channel_upstream_protocol` ON `models` (`channel_id`, `upstream_model_id`, `protocol_id`);
--> statement-breakpoint
CREATE TABLE `model_defaults` (
  `kind` text PRIMARY KEY NOT NULL, `model_id` text,
  FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `tts_voices` (
  `id` text PRIMARY KEY NOT NULL, `owner` text NOT NULL, `protocol_id` text NOT NULL,
  `upstream_model_id` text NOT NULL, `voice_id` text NOT NULL, `name` text NOT NULL, `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tts_voices_owner_protocol_model_voice` ON `tts_voices` (`owner`, `protocol_id`, `upstream_model_id`, `voice_id`);
--> statement-breakpoint
CREATE TABLE `generation_jobs` (
  `id` text PRIMARY KEY NOT NULL, `project_id` text, `page_id` text, `kind` text NOT NULL,
  `model_id` text NOT NULL, `status` text NOT NULL, `request_json` text NOT NULL, `snapshot_json` text NOT NULL,
  `remote_task_id` text, `remote_status` text, `attempts` integer DEFAULT 0 NOT NULL,
  `next_poll_at` text, `deadline_at` text NOT NULL, `error_category` text, `error_code` text, `error_message` text,
  `diagnostic_json` text, `usage_json` text, `raw_response_json` text, `outputs_json` text NOT NULL,
  `staged_outputs_json` text DEFAULT '[]' NOT NULL, `source` text NOT NULL,
  `created_at` text NOT NULL, `updated_at` text NOT NULL, `finished_at` text
);
--> statement-breakpoint
CREATE INDEX `generation_jobs_schedule` ON `generation_jobs` (`status`, `next_poll_at`);
--> statement-breakpoint
CREATE INDEX `generation_jobs_project_page` ON `generation_jobs` (`project_id`, `page_id`);
--> statement-breakpoint
UPDATE `app_meta` SET `value` = '8' WHERE `key` = 'schema_version';
