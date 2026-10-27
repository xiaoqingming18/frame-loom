ALTER TABLE `generation_jobs` ADD `snapshot_json` text;
--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `diagnostic_json` text;
--> statement-breakpoint
CREATE TABLE `provider_uploads` (`key` text PRIMARY KEY NOT NULL, `status` text NOT NULL, `url` text, `expires_at` text);
--> statement-breakpoint
UPDATE `app_meta` SET `value` = '6' WHERE `key` = 'schema_version';
