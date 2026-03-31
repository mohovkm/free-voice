-- Add Matrix migration state and password reset support

ALTER TABLE users
  ADD COLUMN password_reset_token_hash CHAR(64) NULL,
  ADD COLUMN password_reset_expires_at TIMESTAMP NULL,
  ADD COLUMN password_reset_sent_at TIMESTAMP NULL,
  ADD COLUMN matrix_user_id VARCHAR(255) NULL UNIQUE,
  ADD COLUMN matrix_localpart VARCHAR(255) NULL UNIQUE,
  ADD COLUMN matrix_migration_state ENUM('pending','active','failed') NOT NULL DEFAULT 'pending',
  ADD COLUMN matrix_migrated_at TIMESTAMP NULL,
  ADD UNIQUE KEY uq_password_reset_token (password_reset_token_hash);
