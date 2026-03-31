-- Migration 010: re-key push_subscriptions by matrix_user_id
-- Drops the legacy FK to users.id; stores subscriptions by Matrix user ID instead.
-- Existing rows are deleted (no active push subs in Matrix mode yet).

ALTER TABLE push_subscriptions
  DROP FOREIGN KEY push_subscriptions_ibfk_1;

TRUNCATE TABLE push_subscriptions;

ALTER TABLE push_subscriptions
  CHANGE COLUMN user_id matrix_user_id VARCHAR(255) NOT NULL;
