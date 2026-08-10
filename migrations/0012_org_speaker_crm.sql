-- Org-level speaker CRM (decisions.md D-077). Purely additive: five new
-- org-scoped tables and no change to any existing one, so every event-scoped
-- query behaves exactly as it did.
--
-- `email_log` deliberately keeps its shape. It has never had an event column —
-- a send is addressed to a person, and event scoping is composed from the
-- recipient list plus `related_type`/`related_id` (see EmailLogRepo and
-- `buildCommunicationLog` in src/domain/comms.ts) — so an org-level send with
-- no event needs no schema change and cannot leak into an event's log: it
-- simply matches no event's recipients or related ids.
CREATE TABLE `contact_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`author_user_id` text,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contact_notes_user_idx` ON `contact_notes` (`user_id`);--> statement-breakpoint
CREATE TABLE `contact_tags` (
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `label`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_tags_label_idx` ON `contact_tags` (`label`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pipeline_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stage` text DEFAULT 'identified' NOT NULL,
	`score` integer,
	`rationale` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_cards_user_id_unique` ON `pipeline_cards` (`user_id`);--> statement-breakpoint
CREATE INDEX `pipeline_cards_stage_idx` ON `pipeline_cards` (`stage`);--> statement-breakpoint
CREATE TABLE `pipeline_stage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`from_stage` text,
	`to_stage` text NOT NULL,
	`actor_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `pipeline_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pipeline_stage_events_card_idx` ON `pipeline_stage_events` (`card_id`);--> statement-breakpoint
CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
