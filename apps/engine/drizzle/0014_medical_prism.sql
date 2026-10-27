ALTER TABLE `channel_models` ADD `retired` text;
--> statement-breakpoint
UPDATE `app_meta` SET `value` = '7' WHERE `key` = 'schema_version';
