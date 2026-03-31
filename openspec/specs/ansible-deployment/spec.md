# Ansible Deployment

## Purpose

Specifies the deployment model managed by `ansible/playbooks/` and `ansible/roles/`, including configuration inputs, execution rules, role boundaries, and operational constraints.

## Requirements

### Requirement: Configuration Inputs

Playbooks MUST load configuration from the defined variable sources.

#### Scenario: Loading configuration

- **WHEN** a playbook executes
- **THEN** it SHALL load `config.yml` for user- and environment-specific configuration
- **THEN** it SHALL load `ansible/inventory/group_vars/all/vars.yml` for non-secret shared constants
- **THEN** it SHALL load `ansible/inventory/group_vars/all/vault.yml` for secrets, which MUST remain encrypted
- **THEN** deployment targets SHALL be defined in `ansible/inventory/hosts.yml`

### Requirement: Directory Deployment Strategy

Directory deployments MUST use `synchronize` and follow role-specific exclusion rules.

#### Scenario: Deploying the API service

- **WHEN** the API service is deployed
- **THEN** the deployment SHALL use `synchronize` with delete enabled from the canonical `backend/` workspace
- **THEN** the deployment SHALL also place `pyproject.toml` and `uv.lock` into the deployed API workspace so host-side dependency sync can run through `uv`
- **THEN** `uv` SHALL be installed on the target host via the official Astral installer into a stable system path before service sync commands rely on it
- **THEN** `.venv/` SHALL be excluded from synchronization

#### Scenario: Deploying the web client

- **WHEN** the web client is deployed
- **THEN** the deployment SHALL first run local client validation appropriate for the `client/` workspace before synchronizing artifacts
- **THEN** TypeScript-capable client workspaces SHALL pass `npm run check` before `npm run build`
- **THEN** the deployment SHALL synchronize the locally built client artifact directory into `client_install_path`
- **THEN** the deployment MAY use delete enabled when the deployed client is treated as a fully built static artifact tree

#### Scenario: Avoiding copy loop regression

- **WHEN** a contributor modifies deployment tasks
- **THEN** directory deployments MUST NOT be replaced with file-by-file copy loops

### Requirement: Role Boundaries

Each Ansible role MUST own a specific deployment domain.

#### Scenario: Identifying role ownership

- **WHEN** a contributor needs to modify deployment for a subsystem
- **THEN** they SHALL use the following role boundaries:
  - `ansible/roles/api/` — FastAPI deployment wrapper for the `backend/` workspace
  - `ansible/client/` — web-client deployment wrapper for the `client/` workspace
  - `ansible/roles/asterisk/`, `ansible/roles/freepbx/`, `ansible/roles/webrtc*`, `ansible/roles/coturn/` — media and calling infrastructure
  - `ansible/roles/dendrite/`, `ansible/roles/livekit/` — migration architecture
  - `ansible/roles/nginx/` — TLS termination and request routing

### Requirement: Ansible Authoring Guardrails

Ansible code MUST follow established conventions for naming, idempotence, and organization.

#### Scenario: Writing Ansible tasks

- **WHEN** a contributor writes or modifies Ansible tasks
- **THEN** infrastructure logic SHALL be organized by role and top-level playbook purpose
- **THEN** plays, tasks, and blocks SHALL always be named
- **THEN** module state SHALL be explicitly set where it matters instead of relying on defaults
- **THEN** FQCNs SHALL be preferred for builtin modules in new or touched tasks
- **THEN** handlers SHALL be used for change-triggered restarts or reloads instead of unconditional service bounces
- **THEN** secrets SHALL be kept in vault-backed variables and shared constants in `group_vars`
- **THEN** idempotence SHALL be preserved: a second run without input change should be quiet except for read-only checks

### Requirement: Operational Constraints

Service restarts and reloads MUST use the prescribed commands and favor compatibility over destruction.

#### Scenario: Restarting Asterisk

- **WHEN** Asterisk needs to be restarted
- **THEN** it SHALL be restarted only via `systemctl restart asterisk`

#### Scenario: Reloading FreePBX

- **WHEN** FreePBX configuration changes require a reload
- **THEN** `fwconsole reload` SHALL be used

#### Scenario: Maintaining deployment compatibility

- **WHEN** deployment behavior is modified
- **THEN** it SHALL remain compatible with the current running system
- **THEN** expand-and-compatibility steps SHALL be favored over destructive migrations

### Requirement: Deployment Validation

Deployment changes MUST be validated at the narrowest applicable scope.

#### Scenario: Validating a deployment change

- **WHEN** a deployment change is validated
- **THEN** the smallest playbook or role scope that covers the change SHALL be used
- **THEN** large deployment logs SHALL be captured to a file with only the relevant tail or error slices inspected
- **THEN** overall task completion SHALL also satisfy the service development guardrails spec

#### Scenario: Deploying systemd-managed backend services

- **WHEN** a playbook deploys long-running backend services such as `voip-api` or `dendrite`, or schedules the `media-cleanup` timer
- **THEN** the role SHALL verify the relevant systemd units reached healthy post-deploy states before the playbook succeeds
- **THEN** `voip-api` and `dendrite` SHALL be checked for `ActiveState=active` and `SubState=running`
- **THEN** `media-cleanup.timer` SHALL be checked for `ActiveState=active` and `SubState=waiting`
- **THEN** deployment MUST fail if any checked unit reports a failed systemd result
