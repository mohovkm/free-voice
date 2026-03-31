# Repository Layout

## Purpose

Defines the top-level repository structure so deployment code, application code, specs, and workspace-owned tests have clear ownership boundaries.

## Requirements

### Requirement: Top-Level Repository Layout

The repository SHALL organize its primary source and operations surfaces under dedicated top-level directories so contributors can identify deployment code, application code, specs, and workspace boundaries without entering Ansible role internals.

#### Scenario: Root tree inspection

- **WHEN** a contributor inspects the repository root
- **THEN** the root SHALL contain dedicated top-level directories for `ansible/`, `openspec/`, `client/`, and `backend/`
- **THEN** Ansible deployment assets SHALL live under `ansible/`
- **THEN** current-state specifications SHALL live under `openspec/`

### Requirement: Workspace-Owned Test Trees

All automated tests SHALL live under the application workspace they validate rather than being split between application source trees and deployment-role directories.

#### Scenario: Locating test layers

- **WHEN** a contributor adds or updates tests
- **THEN** backend pytest coverage SHALL live under `backend/tests/`
- **THEN** client unit coverage SHALL live under `client/tests/unit/`
- **THEN** local Playwright coverage SHALL live under `client/tests/e2e/local/`
- **THEN** deployed Playwright coverage SHALL live under `client/tests/e2e/real/`

### Requirement: Structured Backend Workspace

The backend workspace SHALL use a stable internal package layout so transport routes, helper modules, models, and operator CLI code remain easy to locate.

#### Scenario: Inspecting backend source layout

- **WHEN** a contributor inspects `backend/src/`
- **THEN** the workspace SHALL expose `main.py` as the FastAPI entry point
- **THEN** HTTP route modules SHALL live under `backend/src/routes/`
- **THEN** shared helper modules SHALL live under `backend/src/helpers/`
- **THEN** backend data schemas SHALL live under `backend/src/models/`
- **THEN** operator-facing backend CLI code SHALL live under `backend/src/cli/`
