-- Nullable on purpose, with no DEFAULT and no backfill (decisions.md D-068):
-- NULL is the "nobody has said" state, which every surface reads as "fall
-- back to the derived value" (confirmed <=> attached to one of this event's
-- sessions). Backfilling 'confirmed' would freeze today's derivation into
-- stored data and stop a later session change from ever moving the answer.
ALTER TABLE `event_speakers` ADD `confirmation_status` text;
