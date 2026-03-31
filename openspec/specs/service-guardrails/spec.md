# Service Development Guardrails

## Purpose

Defines the baseline rules for implementing features in this repository, covering read order, source of truth, dependency management, change scope, testing, and definition of done.

## Requirements

### Requirement: Read Order Before Any Change

Every contributor SHALL follow a defined read order before modifying code to ensure awareness of existing contracts and constraints.

#### Scenario: Standard feature change

- **WHEN** a contributor begins any code change
- **THEN** they SHALL read the relevant spec in `openspec/specs/`
- **THEN** they SHALL read the relevant shared-contract specs (e.g. `service-guardrails`, `call-state-machine`, `testing-and-dod`)
- **THEN** they SHALL read the relevant architecture specs (e.g. `architecture`, `realtime-call-flow`) if the change crosses module boundaries

#### Scenario: Matrix persistence change

- **WHEN** a change touches Matrix persistence, room history, file uploads, or recovery behavior
- **THEN** the contributor SHALL read `openspec/specs/matrix-backup-and-recovery/spec.md` before proceeding

#### Scenario: CI or delivery automation change

- **WHEN** a change touches GitHub Actions, CI runners, or delivery automation
- **THEN** the contributor SHALL read `openspec/specs/ci-runner-topology/spec.md` before proceeding

### Requirement: Source Of Truth

The repository MUST maintain a single authoritative documentation tree to prevent conflicting behavior definitions.

#### Scenario: Determining current behavior

- **WHEN** a contributor needs to understand current system behavior
- **THEN** they SHALL treat `openspec/specs/` as the only current-state documentation tree
- **THEN** they SHALL treat `openspec/changes/archive/` as historical execution and investigation context only
- **THEN** they SHALL treat `tasks.json` as an execution tracker, not a behavior spec

### Requirement: JavaScript Dependency Management

JavaScript dependencies MUST be managed through the client workspace package manifest to maintain a clean dependency surface.

#### Scenario: Adding a client dependency

- **WHEN** a new dependency is needed for the web client
- **THEN** it SHALL be added only in `client/package.json`
- **THEN** runtime libraries SHALL go in `dependencies`
- **THEN** build, test, and tooling libraries SHALL go in `devDependencies`
- **THEN** `client/package-lock.json` SHALL be updated whenever `client/package.json` changes

#### Scenario: Evaluating root-level dependencies

- **WHEN** a contributor considers adding a dependency to the repository root `package.json`
- **THEN** they MUST NOT add client app dependencies there unless the dependency is truly root-scoped tooling
- **THEN** they SHALL prefer the smallest dependency surface that solves the problem and avoid overlapping SDKs or UI libraries

### Requirement: Python Dependency Management

Python dependencies MUST be managed through standardized `pyproject.toml` metadata to keep the environment reproducible.

#### Scenario: Adding a Python dependency

- **WHEN** a new Python dependency is needed
- **THEN** runtime dependencies SHALL be added to `[project.dependencies]` in `pyproject.toml`
- **THEN** local development and test tools SHALL be added to `[dependency-groups]`
- **THEN** `requires-python` SHALL remain aligned with the code being written
- **THEN** `uv.lock` SHALL be updated when Python dependency declarations change

#### Scenario: Avoiding ad-hoc environment mutation

- **WHEN** a contributor manages Python dependencies
- **THEN** they SHALL prefer standardized dependency metadata in `pyproject.toml` over ad-hoc environment mutation

### Requirement: Change Scope

Changes MUST be incremental and backward compatible unless explicitly migrating, and spec updates MUST accompany behavior changes.

#### Scenario: Making a code change

- **WHEN** a contributor implements a change
- **THEN** they SHALL prefer incremental changes over broad rewrites
- **THEN** they SHALL keep behavior backward compatible unless the task explicitly includes a controlled migration

#### Scenario: Changing a documented contract

- **WHEN** a feature changes an API, contract, route shape, deployment assumption, or documented runtime behavior
- **THEN** the contributor SHALL update the corresponding system spec in the same change
- **THEN** they MUST NOT create a new documentation silo when an existing module/common/design spec can be updated instead

### Requirement: Testing

Every meaningful change MUST have validation using established frameworks only.

#### Scenario: Validating a change

- **WHEN** a contributor completes a meaningful change
- **THEN** they SHALL provide validation for that change
- **THEN** they SHALL use only established frameworks: `pytest`, `vitest`, and `playwright`
- **THEN** they MUST NOT create standalone bash test harnesses
- **THEN** they SHALL use the narrowest test surface that proves the change first, then broaden only if the change crossed boundaries

### Requirement: Definition Of Done

A task MUST NOT be considered done until all completion criteria are satisfied.

#### Scenario: Completing a task

- **WHEN** a contributor marks a task as done
- **THEN** the relevant current-state specs SHALL have been read
- **THEN** the implementation SHALL match the intended behavior
- **THEN** the affected system specs SHALL have been updated in the same change when behavior changed
- **THEN** relevant tests or executable validations SHALL have been run and reported
- **THEN** residual risks and unverified areas SHALL be explicit
- **THEN** if the task is tracked in `tasks.json`, its status SHALL be updated when appropriate

### Requirement: Delivery Checklist

Every delivered change MUST include a complete set of artifacts to be considered shippable.

#### Scenario: Delivering a change

- **WHEN** a change is ready for delivery
- **THEN** it SHALL include code changes
- **THEN** it SHALL include matching spec updates
- **THEN** it SHALL include a validation output summary
- **THEN** it SHALL include compatibility and rollback notes if the change affects live behavior
