# Architecture Overview

## Purpose

Describes the current repository architecture and the runtime boundaries that all implementation work must preserve during the mixed legacy/Matrix transition state.

## Requirements

### Requirement: Backward Compatibility During Transition

The system SHALL preserve backward compatibility while legacy FastAPI/Asterisk and Matrix/Dendrite/LiveKit paths coexist. The repository still contains the legacy FastAPI plus Asterisk calling path, the Svelte client contains a backend abstraction supporting both legacy and Matrix-backed flows, and Dendrite and LiveKit roles exist in the deployment tree as part of the active migration path.

Legacy identity cutover is reset-first: FastAPI still owns legacy user records and password-reset issuance, while Dendrite becomes the durable post-reset identity authority for migrated users.

#### Scenario: Mixed-state deployment

- **WHEN** a deployment includes both legacy and Matrix components
- **THEN** both calling paths SHALL remain functional and the backend selector SHALL route correctly to each

### Requirement: Runtime Topology

The system SHALL maintain the following runtime topology:

```text
Browser (SvelteKit SPA)
  -> nginx (TLS, static files, websocket proxy, /api proxy)
  -> FastAPI (legacy app services, TURN credentials, LiveKit token API)
  -> Dendrite (Matrix homeserver during migration)
  -> LiveKit (group call/media offload where enabled)
  -> Asterisk + FreePBX (legacy SIP/WebRTC calling and room media)
  -> MariaDB + astdb.sqlite3
  -> coturn
```

#### Scenario: Request routing through nginx

- **WHEN** a browser request arrives at the system
- **THEN** nginx SHALL terminate TLS, serve static files, and proxy websocket and `/api` traffic to the appropriate backend service

### Requirement: Repository Ownership Boundaries

Each subsystem SHALL be owned by a single directory tree. Changes MUST NOT cross ownership boundaries without updating the affected specs.

| Owner path | Responsibility |
| --- | --- |
| `client/src/` | Browser UI, backend selector, call state machine, client-side stores |
| `backend/src/` | HTTP API, websocket endpoints, notifications, AMI call control, persistence layer |
| `ansible/playbooks/`, `ansible/roles/`, `ansible/inventory/` | Deployment and runtime configuration |
| `backend/tests/` | Backend test coverage |
| `client/tests/e2e/` | Browser-level end-to-end coverage |
| `client/tests/unit/` | Frontend unit and service coverage |

#### Scenario: Modifying call state machine code

- **WHEN** a change touches `client/src/lib/services/callSession.ts`
- **THEN** the change MUST be reviewed against the client ownership scope and the call-state-machine spec SHALL be updated if transitions or store fields change

### Requirement: Operational Invariants

All repository workflows MUST observe the following invariants without exception.

- Workflows MUST NOT access the database directly for testing or debugging; they SHALL go through FastAPI endpoints.
- Asterisk MUST be managed only with `systemctl`; `safe_asterisk` MUST NOT be used.
- Directory deployment MUST use `synchronize`; file-by-file copy loops MUST NOT replace it.
- `timers_min_se` MUST remain >= 90 on Asterisk WebRTC endpoints.
- `astdb.sqlite3` SHALL be treated as persistent state and MUST NOT be deleted.
- Dendrite databases, media, and signing key SHALL be treated as persistent Matrix state (see `openspec/specs/matrix-backup-and-recovery/spec.md`).
- Any GitHub Actions runner for this repository MUST run on a separate machine with outbound-only connectivity (see `openspec/specs/ci-runner-topology/spec.md`).

#### Scenario: Running integration tests

- **WHEN** a test needs to verify or modify application data
- **THEN** the test MUST use FastAPI endpoints and MUST NOT issue direct database queries

#### Scenario: Restarting Asterisk

- **WHEN** Asterisk needs to be restarted
- **THEN** the operator MUST use `systemctl restart asterisk` and MUST NOT use `safe_asterisk`

### Requirement: Documentation Boundaries

Current implementation context SHALL live only under `openspec/specs/`. Historical migration playbooks, postmortems, and investigations SHALL live under `openspec/changes/archive/`. If a historical finding becomes a permanent system rule, it MUST be copied as a normalized rule into a system spec.

#### Scenario: Promoting an archived finding to a permanent rule

- **WHEN** an investigation in `openspec/changes/archive/` produces a rule that applies to ongoing work
- **THEN** the rule MUST be added to the appropriate spec under `openspec/specs/` rather than remaining only in the archived document
