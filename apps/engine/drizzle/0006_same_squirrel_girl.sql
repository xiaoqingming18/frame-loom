CREATE TABLE `page_views` (
	`project_id` text NOT NULL,
	`page_id` text NOT NULL,
	`view_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `page_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`location_kind` text DEFAULT 'local' NOT NULL,
	`remote_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`added_at` text NOT NULL,
	`last_opened_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_root_path` ON `projects` (`root_path`);--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `page_id` text;--> statement-breakpoint
CREATE INDEX `generation_jobs_project_page` ON `generation_jobs` (`project_id`,`page_id`);
--> statement-breakpoint
UPDATE `app_meta` SET `value` = '2' WHERE `key` = 'schema_version';
