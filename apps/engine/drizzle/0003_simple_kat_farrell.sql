CREATE TABLE `object_storage_config` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`region` text NOT NULL,
	`bucket` text NOT NULL,
	`access_key_id` text NOT NULL,
	`secret_cipher` blob NOT NULL,
	`force_path_style` integer NOT NULL,
	`key_prefix` text NOT NULL,
	`presign_ttl_seconds` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `object_uploads` (
	`sha256` text NOT NULL,
	`storage_fingerprint` text NOT NULL,
	`object_key` text NOT NULL,
	`uploaded_at` text NOT NULL,
	PRIMARY KEY(`sha256`, `storage_fingerprint`)
);
--> statement-breakpoint
ALTER TABLE `media_files` ADD `fps` real;--> statement-breakpoint
ALTER TABLE `media_files` ADD `codec` text;--> statement-breakpoint
ALTER TABLE `media_files` ADD `audio_codec` text;