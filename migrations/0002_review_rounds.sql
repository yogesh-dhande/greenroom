CREATE TABLE `review_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`opens_at` integer,
	`closes_at` integer,
	`criteria` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_rounds_event_idx` ON `review_rounds` (`event_id`);--> statement-breakpoint
CREATE TABLE `round_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`recusal_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `review_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `round_assignments_round_idx` ON `round_assignments` (`round_id`);--> statement-breakpoint
CREATE INDEX `round_assignments_reviewer_idx` ON `round_assignments` (`reviewer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `round_assignments_unq` ON `round_assignments` (`round_id`,`submission_id`,`reviewer_id`);--> statement-breakpoint
CREATE TABLE `round_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`values` text NOT NULL,
	`submitted_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `round_assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `round_scores_assignment_id_unique` ON `round_scores` (`assignment_id`);