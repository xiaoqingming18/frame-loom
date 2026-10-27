ALTER TABLE `channel_models` ADD `connection_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
UPDATE `app_meta` SET `value` = '5' WHERE `key` = 'schema_version';
