ALTER TABLE channel_models ADD COLUMN definition_id TEXT;
--> statement-breakpoint
ALTER TABLE channel_models ADD COLUMN connection_id TEXT;
--> statement-breakpoint
ALTER TABLE channel_models ADD COLUMN last_media_check_json TEXT;
--> statement-breakpoint
CREATE TABLE model_catalog (id TEXT PRIMARY KEY NOT NULL, package_json TEXT NOT NULL);
