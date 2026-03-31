-- Add type column to PJSIP realtime tables (required by Asterisk sorcery)
ALTER TABLE ps_endpoints ADD COLUMN type VARCHAR(40) DEFAULT 'endpoint';
ALTER TABLE ps_auths ADD COLUMN type VARCHAR(40) DEFAULT 'auth';
ALTER TABLE ps_aors ADD COLUMN type VARCHAR(40) DEFAULT 'aor';

UPDATE ps_endpoints SET type='endpoint' WHERE type IS NULL OR type='';
UPDATE ps_auths SET type='auth' WHERE type IS NULL OR type='';
UPDATE ps_aors SET type='aor' WHERE type IS NULL OR type='';
