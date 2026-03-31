# Dendrite Homeserver

## Purpose

Specifies the Dendrite deployment under `ansible/roles/dendrite/` and the contracts the rest of the system depends on for Matrix authentication, registration, TURN, room sync, token validation, and identity migration.

## Requirements

### Requirement: Deployment Ownership

The Dendrite homeserver SHALL be deployed and managed by the `ansible/roles/dendrite/` role.

- Role: `ansible/roles/dendrite/`
- Service: `dendrite`
- Build model: compiled from source on the target host
- Runtime config: `ansible/roles/dendrite/templates/dendrite.yaml.j2`

#### Scenario: Dendrite deployed

- **WHEN** the Dendrite role is applied
- **THEN** the `dendrite` service SHALL be compiled from source on the target host and configured via `dendrite.yaml.j2`

### Requirement: Configuration Model

Dendrite SHALL be configured with the deployed hostname, federation enabled, and SQLite per-component storage.

- `server_name` is the deployed DuckDNS hostname
- federation is enabled
- the client and server well-known names point at the HTTPS endpoint
- storage uses per-component SQLite databases under the Dendrite install path
- media is stored on local filesystem under the Dendrite media directory

#### Scenario: Storage backend queried

- **WHEN** the storage backend is referenced
- **THEN** it SHALL be per-component SQLite databases; assumptions about PostgreSQL-only global database config SHALL NOT be made

### Requirement: Client/API Contracts

Dendrite SHALL support password login, registration, token validation, TURN credentials, typing notifications, and read receipts.

- Password login and registration are enabled.
- Registration shared-secret support is configured.
- `/_matrix/client/v3/account/whoami` is used by FastAPI routes that validate Matrix bearer tokens, including LiveKit token minting and accepted-contact bootstrap.
- FastAPI uses Matrix client APIs for login and registration flows and the local `create-account` administrative utility as a compatibility bridge when a reset-first migration must reconcile an existing account's password.
- The deployment role installs `create-account` alongside the main Dendrite binaries, and the API service reaches it via supplemental membership in the `dendrite` group rather than by relaxing `/opt/dendrite` directory permissions.
- TURN credentials are served by Dendrite client API configuration using the shared TURN secret.
- Typing notifications are supported: `PUT /_matrix/client/v3/rooms/{roomId}/typing/{userId}` returns HTTP 200 and the resulting `m.typing` ephemeral event propagates correctly to other room members via `/sync` (verified 2026-03-23).
- Read receipts are supported: `POST /_matrix/client/v3/rooms/{roomId}/receipt/m.read/{eventId}` returns HTTP 200 and the resulting `m.receipt` ephemeral event (with sender user ID and timestamp) propagates correctly to other room members via `/sync` (verified 2026-03-23).

#### Scenario: FastAPI validates a Matrix bearer token

- **WHEN** a FastAPI route validates a Matrix bearer token
- **THEN** it SHALL call `/_matrix/client/v3/account/whoami` against Dendrite

#### Scenario: API service accesses create-account

- **WHEN** the API service needs to run `create-account`
- **THEN** it SHALL reach it via supplemental membership in the `dendrite` group, not by relaxing `/opt/dendrite` directory permissions

### Requirement: Identity Migration Constraints

The supported cutover path SHALL be reset-first; legacy bcrypt hashes are not carried directly into Dendrite.

- Existing legacy users do not carry their old bcrypt hashes directly into Dendrite.
- The supported cutover path is reset-first:
  - legacy user requests or is redirected into password reset
  - FastAPI provisions or reconciles the Dendrite account
  - subsequent sign-in uses Matrix password auth
- Matrix identity continuity depends on preserving the same Dendrite account databases and the operator path to the local administrative account utility.
- The reset flow also depends on `voip-api` retaining executable access to `/opt/dendrite/create-account` and read/traverse access required by the Dendrite config path.

#### Scenario: Legacy user migrates

- **WHEN** a legacy user is redirected into password reset
- **THEN** FastAPI SHALL provision or reconcile the Dendrite account, and subsequent sign-in SHALL use Matrix password auth

### Requirement: Rollback Limits

Dendrite state changes SHALL be treated as irreversible once accounts are provisioned.

- Once a Dendrite account is provisioned via `create-account`, it persists in the Dendrite SQLite databases regardless of API state. There is no automated rollback path.
- Dendrite database files MUST NOT be deleted or replaced while any user has an active Matrix session or a provisioned account. Doing so invalidates all existing access tokens and device keys.
- If the Dendrite service is rolled back to an earlier binary version, the SQLite schema MUST be compatible with that version. Dendrite does not support downgrade migrations.
- The `create-account` binary version MUST remain compatible with the running Dendrite binary. Replacing the Dendrite binary without also replacing `create-account` may cause provisioning failures.

#### Scenario: Dendrite binary downgrade considered

- **WHEN** a Dendrite binary downgrade is considered
- **THEN** the SQLite schema MUST be compatible with the target version, and `create-account` MUST also be replaced to match

#### Scenario: Database deletion considered

- **WHEN** deletion or replacement of Dendrite database files is considered
- **THEN** it MUST NOT proceed while any user has an active Matrix session or a provisioned account

### Requirement: Media and Limits

Dendrite SHALL enforce media upload limits and support dynamic thumbnails.

- `max_file_size_bytes` is `52428800` (server-side hard cap)
- Client-side per-type limits enforced before upload: image 10 MB, audio 5 MB, video 25 MB, file 15 MB
- dynamic thumbnails are enabled
- thumbnail generation is limited to two generators

#### Scenario: File uploaded exceeding limit

- **WHEN** a file larger than the per-type client limit is submitted
- **THEN** the client SHALL reject the upload before starting the HTTP request with a toast showing the limit
- **WHEN** a file larger than `52428800` bytes bypasses the client and reaches Dendrite
- **THEN** Dendrite SHALL reject the upload

### Requirement: Media Retention

Media files on the Pi SHALL be pruned by a daily cleanup timer to prevent disk exhaustion.

- Default TTL: 30 days (configurable via `media_ttl_days`)
- Emergency TTL: 3 days when disk usage exceeds 80% of `media_disk_budget_gb`
- Cleanup script: `{{ dendrite_install_path }}/media_cleanup.py`, deployed by the Dendrite Ansible role
- Cleanup runs via a systemd timer (`media-cleanup.timer`) on schedule `{{ media_cleanup_schedule }}`
- The script does NOT delete `mediaapi.db` rows — Dendrite returns 404 for purged files
- Clients handle 404 by showing an "expired" placeholder; cached blob URLs are returned from `mediaCache.js` (IndexedDB, 100 MB LRU)

#### Scenario: Media file reaches TTL

- **WHEN** the cleanup timer runs and a local media file is older than the TTL
- **THEN** the file SHALL be deleted from the filesystem
- **AND** the Dendrite DB row SHALL be left intact
- **AND** subsequent client requests for the file SHALL receive a 404 response

#### Scenario: Disk usage exceeds emergency threshold

- **WHEN** total media directory size exceeds 80% of `media_disk_budget_gb`
- **THEN** the cleanup script SHALL apply the emergency TTL (3 days) instead of the default TTL

### Requirement: Operational Constraints

Dendrite operations SHALL respect SQLite storage and backup requirements.

- Dendrite currently uses SQLite component databases, so changes SHALL NOT assume that PostgreSQL-only global database config exists.
- Backup and restore requirements for Dendrite-owned state are defined in [matrix-backup-and-recovery.md](matrix-backup-and-recovery.md).
- Homeserver behavior that affects auth, registration, TURN issuance, room sync, or token validation MUST be reflected in the relevant client/API specs in the same change.

#### Scenario: Homeserver auth behavior changed

- **WHEN** Dendrite auth behavior, storage model, TURN config, federation mode, or external endpoint assumptions change
- **THEN** this spec and the relevant client/API specs MUST be updated in the same change
