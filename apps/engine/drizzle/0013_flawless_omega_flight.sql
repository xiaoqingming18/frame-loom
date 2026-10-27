CREATE TABLE `tts_voices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`protocol` text NOT NULL,
	`model` text NOT NULL,
	`voice_id` text NOT NULL,
	`name` text NOT NULL
);
