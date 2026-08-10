CREATE TABLE `session_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`field` text DEFAULT 'abstract' NOT NULL,
	`prior_value` text,
	`new_value` text,
	`author_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `session_revisions_session_idx` ON `session_revisions` (`session_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `content_status` text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
-- Hand-added backfill (decisions.md D-072): SQLite's ADD COLUMN already
-- stamps every existing row with the DEFAULT above, but the gate this column
-- feeds (isPubliclyVisible) is the one thing standing between the live demo
-- and a blank public program, so the backfill is written out rather than
-- inferred -- the same reasoning as 0008_program_published.sql. Idempotent:
-- it only touches rows that somehow have no value.
UPDATE sessions SET content_status = 'approved' WHERE content_status IS NULL OR content_status = '';
