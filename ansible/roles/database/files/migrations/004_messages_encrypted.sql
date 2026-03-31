-- Migrate messages table from plaintext to E2E encrypted schema
ALTER TABLE messages DROP COLUMN IF EXISTS body;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ciphertext MEDIUMBLOB NOT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encrypted_keys JSON NOT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS iv VARCHAR(32) NOT NULL;

-- Purge legacy plaintext rows that lack encrypted fields
DELETE FROM messages WHERE ciphertext IS NULL OR ciphertext = '' OR encrypted_keys = '' OR iv = '';
