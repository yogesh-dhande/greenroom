ALTER TABLE `forms` ADD `max_submissions_per_speaker` integer;--> statement-breakpoint
ALTER TABLE `submissions` ADD `resume_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_resume_token_unique` ON `submissions` (`resume_token`);