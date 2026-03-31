# API Service

## Purpose

Specifies the FastAPI service under `backend/src/` that owns authentication, user/session management, Matrix identity cutover, contacts, rooms, messaging, call-control, WebSocket, push, TURN, LiveKit token issuance, and Asterisk AMI integration.

## Requirements

### Requirement: Runtime Configuration

The API service SHALL bind and run under a fixed runtime identity and environment.

- Entry point: `backend/src/main.py`
- Service name: `voip-api`
- Bind: `127.0.0.1:8000`
- Runtime owner after deployment: `www-data:www-data`
- The service also joins the `dendrite` supplemental group so reset-time Matrix account reconciliation can execute the local Dendrite admin helper without broadening `/opt/dendrite` permissions.
- Python environment on target host: `uv`-managed project environment under `/opt/voip-api/.venv/`

#### Scenario: Service starts after deployment

- **WHEN** the `voip-api` service is started after deployment
- **THEN** it SHALL bind to `127.0.0.1:8000`, run as `www-data:www-data`, and have supplemental membership in the `dendrite` group

### Requirement: Code Structure

The codebase SHALL follow a modular file-per-domain layout with auto-discovery.

- Route modules live under `routes/` and define domain routers.
- `helpers/dao.py` owns persistence access from the API layer.
- `helpers/control.py` owns Asterisk-facing control behavior.
- `helpers/matrix_auth.py` owns Dendrite HTTP and administrative account reconciliation helpers used by auth and token-validation routes.
- `models/` defines backend request and response schemas.
- `helpers/config.py` owns runtime configuration loading.
- New route modules are registered explicitly from `main.py`; no filesystem auto-discovery requirement applies.

#### Scenario: New route module added

- **WHEN** a new `routes_*.py` file is added to the API directory
- **THEN** it SHALL be auto-discovered without modifying a manual router registry

### Requirement: Auth and Migration Contracts

The API SHALL support both legacy JWT auth and Matrix-era browser sign-in, with a password-reset-driven migration path.

- Legacy JWT auth remains available for the pre-Matrix path through `/api/auth/login`.
- Matrix-era browser sign-in by email uses `POST /api/auth/matrix-login`.
  - `status = "ok"` returns a Matrix access token, `user_id`, `device_id`, and `homeserver`.
  - `status = "reset_required"` means the user exists in the legacy account table but has not completed Matrix migration yet.
- Password reset is implemented as a reusable API flow:
  - `POST /api/auth/password-reset/request`
  - `POST /api/auth/password-reset/confirm`
- When `EMAIL_DEBUG=1`, auth email-dispatch routes also return debug links for automated verification:
  - `POST /api/auth/register` and `POST /api/auth/verify/resend` may include `debug_verification_link`
  - `POST /api/auth/password-reset/request` may include `debug_reset_link`
  - `POST /api/auth/debug/legacy-user` may create a verified unmigrated legacy fixture for automated E2E only
- Public auth links are built from `PUBLIC_BASE_URL` so non-default HTTPS ports are preserved in verification and reset flows.
- Password reset confirmation is the migration trigger for unmigrated legacy users.
  - The API provisions or reconciles the Matrix account.
  - The `users` row stores `matrix_user_id`, `matrix_localpart`, `matrix_migration_state`, and `matrix_migrated_at`.
  - The legacy bcrypt hash is also updated during the compatibility window so rollback to legacy auth remains possible until cleanup.
- Matrix-authenticated bootstrap helpers use Matrix Bearer tokens, not legacy JWTs.
  - `GET /api/matrix/bootstrap/contacts` returns accepted contacts whose peers already have Matrix identities.

#### Scenario: Legacy user signs in via Matrix login

- **WHEN** a legacy user who has not completed Matrix migration calls `POST /api/auth/matrix-login`
- **THEN** the response SHALL have `status = "reset_required"`

#### Scenario: Migrated user signs in via Matrix login

- **WHEN** a user who has completed password reset calls `POST /api/auth/matrix-login`
- **THEN** the response SHALL have `status = "ok"` with `access_token`, `user_id`, `device_id`, and `homeserver`

#### Scenario: Password reset triggers migration

- **WHEN** an unmigrated legacy user completes `POST /api/auth/password-reset/confirm`
- **THEN** the API SHALL provision or reconcile the Matrix account, store `matrix_user_id`, `matrix_localpart`, `matrix_migration_state`, and `matrix_migrated_at` in the `users` row, and update the legacy bcrypt hash

### Requirement: Rollback Limits

The system SHALL observe rollback constraints for identity cutover (tasks 8.7–8.11) before phase 9 cleanup begins.

#### Scenario: Legacy bcrypt hash compatibility window

- **WHEN** a user completes password reset
- **THEN** the API SHALL update both the Dendrite account password and the legacy bcrypt hash in the `users` table, so rolling back to legacy auth remains possible as long as `matrix_migration_state` and legacy auth routes are still present
- This window closes when phase 9 removes the legacy auth routes and shrinks the schema.

#### Scenario: Schema rollback safety

- **WHEN** schema rollback is considered for migration `008_matrix_migration_and_password_reset.sql`
- **THEN** it SHALL be safe only if no user has completed migration (no `matrix_user_id` populated); once any `matrix_user_id` is populated, dropping the column loses the Matrix identity mapping permanently
- Schema rollback MUST be explicitly approved and preceded by a full database backup.

Columns added: `password_reset_token_hash`, `password_reset_expires_at`, `password_reset_sent_at`, `matrix_user_id`, `matrix_localpart`, `matrix_migration_state`, `matrix_migrated_at`.

#### Scenario: Dendrite account rollback

- **WHEN** `matrix_auth.ensure_account()` provisions a Dendrite account via `create-account`
- **THEN** that account SHALL persist in the Dendrite SQLite databases regardless of API state; there is no automated rollback path
- Removing a provisioned account requires direct Dendrite database access and is a destructive operation. If the API is rolled back after provisioning, the Dendrite account remains and the user can still authenticate directly against Dendrite — but the legacy API will no longer recognize their Matrix identity.

#### Scenario: Contact bootstrap rollback

- **WHEN** DM rooms are created by `GET /api/matrix/bootstrap/contacts`
- **THEN** those rooms SHALL persist in Dendrite even if the bootstrap endpoint is removed or the API is rolled back
- The bootstrap is idempotent (skips already-known peers) but not reversible. Rooms created during bootstrap cannot be automatically cleaned up.

### Requirement: Contract Rules

All external persistence access and API evolution SHALL follow these rules.

- External callers MUST interact with persistence only through API endpoints. Side-channel database workflows SHALL NOT be added.
- API changes that affect schema, payload shape, room membership, message behavior, or token contracts MUST update this spec in the same change.
- Backward compatibility matters: prefer additive changes and compatibility windows over destructive rewrites.
- Matrix-integrated token flows and group-call token minting MUST also update [livekit-integration.md](livekit-integration.md) when their contract changes.

#### Scenario: New feature touches persistence

- **WHEN** a new feature requires database access
- **THEN** it SHALL use an API endpoint; direct database access outside the API layer SHALL NOT be introduced

### Requirement: Python Guardrails

Python dependency and testing practices SHALL follow these rules.

- Runtime dependencies belong in `pyproject.toml` `[project.dependencies]`
- Test and local development dependencies belong in `[dependency-groups]`
- Keep `requires-python` aligned with the language features used in API code
- Route behavior SHALL be validated in `backend/tests/`
- External HTTP integrations SHALL be mocked in tests rather than exercised against the live network by default

#### Scenario: New dependency added

- **WHEN** a new runtime dependency is introduced
- **THEN** it SHALL be added to `pyproject.toml` `[project.dependencies]`, not to a test or dev group

### Requirement: Validation Expectations

Backend changes SHALL be validated with appropriate test coverage.

- Backend changes SHALL run `pytest` against `backend/tests/`.
- Targeted endpoint changes SHALL be validated with the smallest relevant test set first, then broader coverage if the surface area expanded.
- Overall task completion MUST also satisfy the [service-guardrails spec](../service-guardrails/spec.md) and [testing-and-dod spec](../testing-and-dod/spec.md).

#### Scenario: Endpoint modified

- **WHEN** an existing endpoint's behavior is changed
- **THEN** `pytest` SHALL be run against the relevant tests in `backend/tests/` before the change is considered complete
