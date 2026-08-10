CREATE TABLE `auth_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`reference_id` text NOT NULL,
	`prefix` text,
	`key` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`rate_limit_enabled` integer DEFAULT false NOT NULL,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`request_count` integer DEFAULT 0 NOT NULL,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`permissions` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`reference_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_api_keys_key_unique` ON `auth_api_keys` (`key`);--> statement-breakpoint
CREATE INDEX `auth_api_keys_config_idx` ON `auth_api_keys` (`config_id`);--> statement-breakpoint
CREATE INDEX `auth_api_keys_reference_idx` ON `auth_api_keys` (`reference_id`);--> statement-breakpoint
CREATE INDEX `auth_api_keys_key_idx` ON `auth_api_keys` (`key`);--> statement-breakpoint
CREATE TABLE `auth_jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `auth_oauth_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text,
	`reference_id` text,
	`refresh_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `auth_oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `auth_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refresh_id`) REFERENCES `auth_oauth_refresh_tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_oauth_access_tokens_token_unique` ON `auth_oauth_access_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `auth_oauth_access_client_idx` ON `auth_oauth_access_tokens` (`client_id`);--> statement-breakpoint
CREATE INDEX `auth_oauth_access_session_idx` ON `auth_oauth_access_tokens` (`session_id`);--> statement-breakpoint
CREATE INDEX `auth_oauth_access_user_idx` ON `auth_oauth_access_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_oauth_access_refresh_idx` ON `auth_oauth_access_tokens` (`refresh_id`);--> statement-breakpoint
CREATE TABLE `auth_oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text,
	`disabled` integer DEFAULT false,
	`skip_consent` integer,
	`enable_end_session` integer,
	`subject_type` text,
	`scopes` text,
	`user_id` text,
	`created_at` integer,
	`updated_at` integer,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`software_id` text,
	`software_version` text,
	`software_statement` text,
	`redirect_uris` text NOT NULL,
	`post_logout_redirect_uris` text,
	`token_endpoint_auth_method` text,
	`grant_types` text,
	`response_types` text,
	`public` integer,
	`type` text,
	`require_pkce` integer,
	`reference_id` text,
	`metadata` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_oauth_clients_client_id_unique` ON `auth_oauth_clients` (`client_id`);--> statement-breakpoint
CREATE INDEX `auth_oauth_clients_user_idx` ON `auth_oauth_clients` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_oauth_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`reference_id` text,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `auth_oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_oauth_consents_client_idx` ON `auth_oauth_consents` (`client_id`);--> statement-breakpoint
CREATE INDEX `auth_oauth_consents_user_idx` ON `auth_oauth_consents` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_oauth_refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text NOT NULL,
	`reference_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked` integer,
	`auth_time` integer,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `auth_oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `auth_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_oauth_refresh_tokens_token_unique` ON `auth_oauth_refresh_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `auth_oauth_refresh_client_idx` ON `auth_oauth_refresh_tokens` (`client_id`);--> statement-breakpoint
CREATE INDEX `auth_oauth_refresh_session_idx` ON `auth_oauth_refresh_tokens` (`session_id`);--> statement-breakpoint
CREATE INDEX `auth_oauth_refresh_user_idx` ON `auth_oauth_refresh_tokens` (`user_id`);