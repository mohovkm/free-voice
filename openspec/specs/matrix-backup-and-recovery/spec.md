# Matrix Backup And Recovery

## Purpose

Specifies the authoritative Matrix-era data that must be protected and the restore order required to recover user accounts, rooms, messages, and media.

## Requirements

### Requirement: Backup Scope Boundary

The backup boundary SHALL cover Matrix-owned state only.

Included:

- Dendrite component databases under `/opt/dendrite/*.db`
- Dendrite uploaded media under `/opt/dendrite/media/`
- Dendrite signing key `/opt/dendrite/matrix_key.pem`
- Dendrite search index under `/opt/dendrite/searchindex/`
- The continuity of Matrix localparts and passwords created during reset-first legacy-user migration
- Deployment configuration and secrets needed to bring the same Matrix identity back online

Excluded:

- Asterisk, FreePBX, and legacy SIP state scheduled for removal
- Rebuildable application artifacts such as the web bundle, Python virtualenv, and downloaded Dendrite binary
- LiveKit runtime state, because Matrix remains the authority for identity, room membership, and messaging

#### Scenario: Operator determines what to back up

- **WHEN** an operator prepares a backup plan
- **THEN** the backup SHALL include all Dendrite databases, media, signing key, search index, and deployment secrets, and SHALL exclude rebuildable artifacts, legacy SIP state, and LiveKit runtime state

### Requirement: Authoritative Data Tiering

Data SHALL be classified into three tiers governing backup priority.

**Tier 1 — MUST back up:**

- `roomserver.db`
- `federationapi.db`
- `mediaapi.db`
- `syncapi.db`
- `userapi_accounts.db`
- `keyserver.db`
- `relayapi.db`
- `mscs.db`
- `/opt/dendrite/media/`
- `/opt/dendrite/matrix_key.pem`

Losing any Tier 1 item risks permanent loss of Matrix accounts, room history, room membership state, uploaded files, or the homeserver identity itself.

**Tier 2 — SHOULD back up:**

- `/opt/dendrite/searchindex/`

The search index is derivable from primary state, but backing it up shortens restore time and avoids an expensive rebuild after recovery.

**Tier 3 — rebuild instead of back up:**

- Dendrite release binary and temporary build products
- Client build output under `/var/www/voip-client/`
- Local dependency caches and temporary files

These artifacts are deployment outputs and MUST be recreated from versioned source and Ansible configuration instead of treated as source-of-truth data.

#### Scenario: Tier 1 data is missing from backup

- **WHEN** a backup is taken without one or more Tier 1 items
- **THEN** the backup SHALL be considered incomplete and recovery SHALL risk permanent data loss

#### Scenario: Tier 2 data is omitted

- **WHEN** a backup omits the search index
- **THEN** recovery SHALL still succeed but the search index MUST be rebuilt, increasing restore time

### Requirement: Backup Rules

The full Dendrite data set SHALL be backed up as one consistency unit. A filesystem snapshot or a brief Dendrite stop SHALL be preferred during backup so the SQLite component databases and media directory are captured together. Backup archives MUST be encrypted at rest and in transit. At least one copy MUST be kept off the production Raspberry Pi. Backups SHALL be versioned so a bad migration or logical corruption can be rolled back to an earlier restore point. File ownership and permissions MUST be preserved for the restored Dendrite path.

#### Scenario: Backup is executed

- **WHEN** an operator runs a backup
- **THEN** the backup SHALL capture all Dendrite data as one consistency unit, SHALL be encrypted at rest and in transit, and at least one copy MUST be stored off the production Raspberry Pi

#### Scenario: Backup versioning enables rollback

- **WHEN** a migration or logical corruption damages current state
- **THEN** the operator SHALL be able to roll back to a prior versioned backup

### Requirement: Identity And Secret Continuity

The restored homeserver MUST keep the same Matrix server name unless a deliberate migration spec says otherwise. The restored homeserver MUST keep the same `matrix_key.pem`; replacing it changes the homeserver identity and breaks federation trust. Recovery also depends on restoring the deployment secrets that shape Matrix behavior, especially registration and TURN secrets. Recovery for migrated legacy users also depends on preserving the Dendrite account databases that now hold the active password and account identity after reset-first migration. The MariaDB `users` table no longer acts as the durable credential source once `matrix_user_id` is active.

#### Scenario: Homeserver is restored with original signing key

- **WHEN** the homeserver is restored using the original `matrix_key.pem` and server name
- **THEN** federation trust SHALL be maintained and existing users SHALL be able to log in

#### Scenario: Signing key is replaced during restore

- **WHEN** the homeserver is restored with a different `matrix_key.pem`
- **THEN** the homeserver identity SHALL change and federation trust SHALL break

### Requirement: Restore Order

Recovery SHALL follow this exact order:

1. Re-provision the target host with the expected hostname, TLS material, and Ansible-managed service layout.
2. Stop Dendrite before writing restored state back to disk.
3. Restore Tier 1 data into `/opt/dendrite/`, including databases, media, and `matrix_key.pem`.
4. Restore the search index if available; otherwise allow it to rebuild after core services recover.
5. Re-apply deployment configuration and secrets through the Ansible path used by the repository.
6. Start Dendrite and dependent services.
7. Verify login, room sync, historical message retrieval, media download, and federation identity.

#### Scenario: Full restore is performed

- **WHEN** an operator performs a full restore following the prescribed order
- **THEN** Dendrite SHALL be stopped before data is written, Tier 1 data SHALL be restored first, and services SHALL be started only after configuration and secrets are re-applied

### Requirement: Recovery Validation

After every restore rehearsal or real recovery, ALL of the following SHALL be validated:

- `/_matrix/client/v3/account/whoami` succeeds for a known user
- A migrated legacy user can complete Matrix login with the post-reset password
- An existing room appears in sync results
- Historical messages are visible
- An uploaded attachment can be downloaded
- The homeserver still presents the expected server identity

#### Scenario: Post-restore validation is executed

- **WHEN** a restore completes and validation is run
- **THEN** whoami SHALL succeed, legacy user login SHALL work, rooms and messages SHALL be visible, media SHALL be downloadable, and federation identity SHALL match

### Requirement: Spec Dependencies And Change Control

Changes to Dendrite storage layout MUST update this document and `dendrite-homeserver.md` in the same change. Changes to Matrix media handling MUST also review `matrix-client-backend.md` and `web-client.md`. This document MUST be updated whenever the Matrix storage engine, media path, signing-key location, restore order, or disaster-recovery validation rules change.

#### Scenario: Dendrite storage layout changes

- **WHEN** a change modifies the Dendrite storage layout, media path, signing-key location, restore order, or validation rules
- **THEN** this spec and `dendrite-homeserver.md` MUST be updated in the same change
