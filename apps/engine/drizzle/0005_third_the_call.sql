CREATE TABLE `canvas_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`schema_version` integer NOT NULL,
	`revision` integer NOT NULL,
	`document_json` text NOT NULL,
	`view_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
