-- Migrate contacts table to federation-ready schema
ALTER TABLE contacts ADD COLUMN contact_email VARCHAR(255) NOT NULL DEFAULT '' AFTER contact_id;
ALTER TABLE contacts ADD COLUMN status ENUM('pending','accepted','invited') NOT NULL DEFAULT 'pending' AFTER contact_email;
ALTER TABLE contacts ADD COLUMN node_domain VARCHAR(255) DEFAULT NULL AFTER status;
ALTER TABLE contacts ADD COLUMN invite_token VARCHAR(64) DEFAULT NULL AFTER node_domain;
ALTER TABLE contacts ADD COLUMN invite_expires_at TIMESTAMP NULL AFTER invite_token;
ALTER TABLE contacts MODIFY COLUMN contact_id CHAR(36) NULL;

-- Backfill contact_email from users table
UPDATE contacts c JOIN users u ON c.contact_id = u.id SET c.contact_email = u.email WHERE c.contact_email = '';

-- Mark existing contacts as accepted
UPDATE contacts SET status = 'accepted' WHERE status = 'pending' AND contact_id IS NOT NULL AND contact_email != '';

-- Backfill contact_id for email-only rows
UPDATE contacts c JOIN users u ON u.email = c.contact_email SET c.contact_id = u.id WHERE c.contact_id IS NULL AND c.status = 'accepted';
