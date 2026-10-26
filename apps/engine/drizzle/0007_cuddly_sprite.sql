ALTER TABLE `generation_jobs` ADD `staged_outputs_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
UPDATE `app_meta` SET `value` = '3' WHERE `key` = 'schema_version';
