CREATE TABLE IF NOT EXISTS `game_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`db_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
