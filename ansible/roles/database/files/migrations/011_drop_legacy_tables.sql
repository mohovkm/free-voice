-- Migration 011: drop legacy SIP and messaging tables; remove SIP columns from users
-- Backup was taken before this migration.

-- Drop SIP/PJSIP tables (may not exist if Alembic never ran)
DROP TABLE IF EXISTS ps_contacts;
DROP TABLE IF EXISTS ps_auths;
DROP TABLE IF EXISTS ps_aors;
DROP TABLE IF EXISTS ps_endpoints;

-- Drop legacy messaging and room tables (FK order matters)
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS call_events;
DROP TABLE IF EXISTS room_members;
DROP TABLE IF EXISTS rooms;

-- Drop legacy device key table
DROP TABLE IF EXISTS devices;

-- Remove SIP credential columns and tier from users
ALTER TABLE users
  DROP COLUMN IF EXISTS sip_username,
  DROP COLUMN IF EXISTS sip_password,
  DROP COLUMN IF EXISTS tier;
