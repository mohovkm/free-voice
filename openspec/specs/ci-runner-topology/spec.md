# GitHub Actions Runner Topology

## Purpose

Defines the approved CI topology for this repository when GitHub Actions is enabled with self-hosted execution, ensuring operational isolation from production.

## Requirements

### Requirement: Runner Isolation

The CI runner MUST be physically and logically separated from the production service host.

#### Scenario: Provisioning a runner

- **WHEN** a self-hosted GitHub Actions runner is provisioned for this repository
- **THEN** it SHALL run on a separate Raspberry Pi, not on the production service host
- **THEN** it MUST NOT be colocated with production Matrix data, Dendrite state, or user media

This is an operational isolation decision derived from GitHub's self-hosted runner security model and this repository's need to protect production state.

### Requirement: Network Model

The runner MUST use an outbound-only network model for GitHub control traffic.

#### Scenario: Configuring runner network

- **WHEN** the runner host network is configured
- **THEN** the runner SHALL use an outbound-only network model for GitHub control traffic
- **THEN** inbound ports from the public internet MUST NOT be exposed to the runner for GitHub job dispatch
- **THEN** the runner SHALL be able to make outbound HTTPS connections over port `443`

#### Scenario: Configuring firewall rules

- **WHEN** the runner firewall is restricted
- **THEN** the following outbound destinations SHALL be allowed:
  - `github.com`, `api.github.com`, and `*.actions.githubusercontent.com` for essential operations
  - `codeload.github.com` to download actions
  - `results-receiver.actions.githubusercontent.com` and `*.blob.core.windows.net` for logs, summaries, artifacts, and caches
- **THEN** any extra endpoints required by the workflows themselves SHALL also be allowed

### Requirement: Repository And Trust Boundaries

Self-hosted runners MUST enforce trust boundaries to prevent untrusted code execution and secret leakage.

#### Scenario: Restricting runner usage

- **WHEN** self-hosted runners are configured
- **THEN** they SHALL be used only for private repository workflows or equally trusted code paths
- **THEN** untrusted fork PR code MUST NOT be allowed to run on the self-hosted runner
- **THEN** deployment secrets, production SSH credentials, and environment approvals SHALL be kept out of generic PR jobs
- **THEN** low-trust validation jobs SHALL be separated from privileged deployment or real-environment E2E jobs

GitHub explicitly warns that self-hosted runners should be limited to private repositories because forked public PRs can execute dangerous code on the runner host.

### Requirement: Runner Classification

The runner MUST be registered with explicit labels for scheduling.

#### Scenario: Registering runner labels

- **WHEN** the runner is registered with GitHub
- **THEN** it SHALL carry the following labels: `self-hosted`, `linux`, `arm64`, `pi-ci`

#### Scenario: Adding specialized labels

- **WHEN** optional labels are added for specialized capacity (e.g., `playwright-real`, `deploy`)
- **THEN** privileged labels MUST be reserved for workflows that already have approval and secret boundaries

### Requirement: Runner Tooling

The runner host SHALL carry only the tooling needed for repository validation.

#### Scenario: Provisioning runner tooling

- **WHEN** the runner host is set up
- **THEN** it SHALL include:
  - Git and the GitHub runner service
  - Node.js and npm for Svelte, Vitest, and Playwright jobs
  - Python and `uv` for API checks and `pytest`
  - Browsers and OS packages required for Playwright if browser E2E is assigned to this runner
  - Ansible only if deployment or configuration validation is intentionally routed to this runner
- **THEN** the runner MUST NOT be treated as a general-purpose long-lived development host

### Requirement: Workflow Partitioning

Workflows MUST be partitioned by trust level and explicitly target the runner with labels.

#### Scenario: Default CI jobs

- **WHEN** default CI jobs are defined
- **THEN** they SHALL run formatting, static checks, unit tests, and repository-safe integration tests

#### Scenario: Privileged jobs

- **WHEN** real-environment E2E, deployment, or production-adjacent checks are defined
- **THEN** they MUST run only on explicitly labeled workflows with protected environments

#### Scenario: Targeting the runner

- **WHEN** a workflow definition targets the runner
- **THEN** it SHALL use explicit labels, for example `runs-on: [self-hosted, linux, arm64, pi-ci]`

#### Scenario: Deployment jobs

- **WHEN** a job touches deployment targets
- **THEN** it SHALL document rollback and validation in the same change that introduces it

### Requirement: CI Validation Completeness

The CI setup MUST NOT be considered complete until all validation criteria are met.

#### Scenario: Validating CI setup

- **WHEN** the CI setup is evaluated for completeness
- **THEN** the runner SHALL have registered successfully and stay online in GitHub Actions
- **THEN** a smoke workflow SHALL have completed on the runner using the expected labels
- **THEN** the runner host firewall SHALL confirm outbound-only GitHub control traffic
- **THEN** logs, artifacts, and caches SHALL upload successfully
- **THEN** production secrets SHALL be unavailable to untrusted workflows

### Requirement: Spec Update Triggers

This document MUST be updated whenever the runner topology, trust model, or workflow rules change.

#### Scenario: Changing runner configuration

- **WHEN** the runner host topology, trust model, label contract, network allow-list, or workflow partitioning rules change
- **THEN** this document SHALL be updated in the same change

#### Scenario: CI managing deployment or backup

- **WHEN** CI begins to manage deployment or backup operations
- **THEN** [ansible-deployment spec](../ansible-deployment/spec.md) and [matrix-backup-and-recovery spec](../matrix-backup-and-recovery/spec.md) SHALL also be reviewed
