-- Migration 009: Add tier and email_verified_at columns on servers where they are absent.
--
-- Root cause: Servers installed before these columns were added to schema.sql never
-- received them via a migration. The user_insert query explicitly lists 'tier', and
-- user_mark_verified updates email_verified_at. If either column is absent on the live
-- server the POST /api/auth/debug/legacy-user fixture route returns 500.
--
-- This migration is idempotent: IF NOT EXISTS makes it a no-op on servers that already
-- have these columns (fresh installs from current schema.sql, or servers that applied
-- migration 007 successfully).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP NULL;

-- Backfill: mark pre-verification-era users as verified, mirroring migration 007 intent.
-- On servers where email_verified_at already existed this is a no-op (no NULL rows).
UPDATE users SET email_verified_at = NOW() WHERE email_verified_at IS NULL;
