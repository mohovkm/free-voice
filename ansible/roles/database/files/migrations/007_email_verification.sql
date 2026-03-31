-- Add email verification columns and mark existing users as verified

ALTER TABLE users
  ADD COLUMN email_verified_at TIMESTAMP NULL AFTER tier,
  ADD COLUMN email_verification_token_hash CHAR(64) NULL,
  ADD COLUMN email_verification_expires_at TIMESTAMP NULL,
  ADD COLUMN email_verification_sent_at TIMESTAMP NULL,
  ADD UNIQUE KEY uq_email_verification_token (email_verification_token_hash);

UPDATE users SET email_verified_at = NOW() WHERE email_verified_at IS NULL;
