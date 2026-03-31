-- FREE VOICE application schema

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255),
  oauth_provider VARCHAR(50),
  oauth_id VARCHAR(255),
  display_name VARCHAR(255) NOT NULL,
  email_verified_at TIMESTAMP NULL,
  email_verification_token_hash CHAR(64),
  email_verification_expires_at TIMESTAMP NULL,
  email_verification_sent_at TIMESTAMP NULL,
  password_reset_token_hash CHAR(64),
  password_reset_expires_at TIMESTAMP NULL,
  password_reset_sent_at TIMESTAMP NULL,
  matrix_user_id VARCHAR(255) UNIQUE,
  matrix_localpart VARCHAR(255) UNIQUE,
  matrix_migration_state ENUM('pending','active','failed') NOT NULL DEFAULT 'pending',
  matrix_migrated_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_verification_token (email_verification_token_hash),
  UNIQUE KEY uq_password_reset_token (password_reset_token_hash),
  UNIQUE KEY uq_oauth (oauth_provider, oauth_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS contacts (
  owner_id CHAR(36) NOT NULL,
  contact_id CHAR(36) NULL,
  contact_email VARCHAR(255) NOT NULL,
  status ENUM('pending','accepted','invited') NOT NULL DEFAULT 'pending',
  node_domain VARCHAR(255) DEFAULT NULL,
  invite_token VARCHAR(64) DEFAULT NULL,
  invite_expires_at TIMESTAMP NULL,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_id, contact_email),
  UNIQUE KEY uq_invite_token (invite_token),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS call_links (
  id CHAR(36) PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  slug VARCHAR(64) NOT NULL UNIQUE,
  room_name VARCHAR(64) NOT NULL UNIQUE,
  max_members INT NOT NULL DEFAULT 2,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  matrix_user_id VARCHAR(255) NOT NULL,
  endpoint VARCHAR(512) NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_endpoint (endpoint(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
