PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_file_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text DEFAULT 'assignment' NOT NULL,
	`assignment_id` text,
	`owner_user_id` text,
	`file_key` text,
	`url` text NOT NULL,
	`filename` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `task_assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Hand-fixed copy step: drizzle-kit's generated SELECT reads the two new
-- columns off the old table, which does not have them. Every existing row is
-- an assignment upload, so `scope` is literal and `owner_user_id` is null —
-- the assignment linkage itself is copied across untouched.
INSERT INTO `__new_file_versions`("id", "scope", "assignment_id", "owner_user_id", "file_key", "url", "filename", "uploaded_by", "created_at") SELECT "id", 'assignment', "assignment_id", NULL, "file_key", "url", "filename", "uploaded_by", "created_at" FROM `file_versions`;--> statement-breakpoint
DROP TABLE `file_versions`;--> statement-breakpoint
ALTER TABLE `__new_file_versions` RENAME TO `file_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `file_versions_assignment_idx` ON `file_versions` (`assignment_id`);--> statement-breakpoint
CREATE INDEX `file_versions_owner_idx` ON `file_versions` (`owner_user_id`);