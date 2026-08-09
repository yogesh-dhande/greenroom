ALTER TABLE `events` ADD `program_published` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Hand-added backfill (decisions.md D-056): the column defaults to false so
-- new events start unpublished, but every event that already exists was
-- already public — publishing them here keeps live programs live across this
-- deploy instead of blanking them.
UPDATE events SET program_published = 1;