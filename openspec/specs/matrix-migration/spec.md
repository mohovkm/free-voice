# Matrix Migration Program

## Purpose

Defines how Matrix migration work is managed under the repository's spec-driven development model, including source-of-truth boundaries, execution tracking, migration streams, required workflow, and definition of done.

## Requirements

### Requirement: Source-of-Truth Split

Current implementation truth SHALL live in `openspec/specs/`. Migration execution history, investigations, and historical plans SHALL live in `openspec/changes/archive/`. `tasks.json` SHALL be the execution tracker for migration phases and task statuses. The archived playbook and runbook MUST NOT be treated as authoritative for current behavior.

#### Scenario: Determining current system behavior

- **WHEN** a developer needs to understand what the system currently does
- **THEN** they MUST consult `openspec/specs/` and MUST NOT rely on archived documents or `tasks.json` alone

### Requirement: Execution Tracking

`tasks.json` SHALL be used to answer "which migration tasks are marked completed, skipped, or pending?" `openspec/specs/` SHALL be used to answer "what does the system currently do?" A completed task in `tasks.json` MUST NOT by itself define current behavior; the behavior is current only when the corresponding system specs describe it.

Current tracker snapshot from `tasks.json`:

- Phases 0 through 7 are mostly marked completed
- Task `1.11` is marked skipped
- Phase 8 is in progress, an `Identity Cutover` phase now gates cleanup, and phase 9 remains pending

#### Scenario: Task marked complete but spec not updated

- **WHEN** a task in `tasks.json` is marked completed but the corresponding system spec has not been updated
- **THEN** the behavior described by that task MUST NOT be considered current-state until the spec is updated

### Requirement: Migration Stream Tracking

The following migration streams SHALL be tracked with their current state and primary specs:

| Stream | Current state | Primary specs |
| --- | --- | --- |
| Dendrite infrastructure | Present in repo and deployment roles | `modules/dendrite-homeserver.md`, `modules/ansible-deployment.md` |
| Backend selection | Implemented via feature flags and `activeBackend.js` | `modules/web-client.md`, `modules/matrix-client-backend.md` |
| Matrix auth | Implemented | `modules/matrix-client-backend.md` |
| Identity cutover | Reset-first legacy-user migration implemented in code; final rollout and cleanup still pending | `modules/api-service.md`, `modules/matrix-client-backend.md`, `modules/dendrite-homeserver.md` |
| Matrix messaging and DMs | Implemented | `modules/matrix-client-backend.md` |
| Matrix P2P calling | Implemented but still under stabilization | `modules/matrix-client-backend.md`, `common/call-state-machine.md`, `design/realtime-call-flow.md` |
| LiveKit group calling | Partial integration present | `modules/livekit-integration.md`, `modules/media-stack.md` |
| Legacy removal | Not current-state work yet | archived task specs only until explicitly started |

#### Scenario: Starting work on a migration stream

- **WHEN** a developer begins work on a migration stream
- **THEN** they MUST first read the primary specs listed for that stream and identify whether the change affects module behavior, shared contracts, or architecture boundaries

### Requirement: Workflow For Matrix Features

All Matrix feature work MUST follow this workflow:

1. Read the current-state specs for the affected stream.
2. Identify whether the change affects module behavior, shared contracts, or architecture boundaries.
3. Update the relevant system spec first or in the same change as the implementation.
4. Implement the code change in the smallest viable slice.
5. Run the smallest relevant validation for that stream.
6. If the work produces temporary planning or investigation material, store it under `openspec/changes/archive/YYYY/MM/TASK-.../spec.md`.

#### Scenario: Implementing a Matrix feature without spec update

- **WHEN** a developer implements a Matrix feature that changes documented behavior
- **THEN** the relevant system spec MUST be updated in the same change; the change MUST NOT be merged with only code modifications

### Requirement: Stream-Level Validation

Each migration stream SHALL have validation expectations appropriate to its scope.

Dendrite and deployment changes:
- SHALL validate the narrowest relevant Ansible scope
- SHALL confirm any client/API assumptions that changed

Client backend changes:
- SHALL prefer targeted unit tests and client type/build checks first
- SHALL validate auth, messaging, contacts, or call behavior only for the affected path

API integration changes:
- SHALL run targeted pytest coverage first
- SHALL expand to broader API tests only if the change crosses route boundaries

Identity cutover changes:
- MUST update both API and Matrix backend specs in the same change
- SHALL treat password reset, Matrix account mapping, and accepted-contact bootstrap as one compatibility slice
- SHALL validate both the API contract and the browser login path before marking the phase complete

Matrix call changes:
- MUST update both call-flow specs and Matrix backend specs if signaling or lifecycle semantics change
- SHALL validate with unit coverage where possible and treat real-browser E2E runs as a separate, environment-dependent signal

#### Scenario: Dendrite deployment change

- **WHEN** a change modifies Dendrite Ansible roles
- **THEN** validation SHALL target the narrowest relevant Ansible scope and SHALL confirm that client/API assumptions still hold

#### Scenario: Identity cutover change

- **WHEN** a change affects the identity cutover flow
- **THEN** both API and Matrix backend specs MUST be updated in the same change, and both the API contract and browser login path MUST be validated

### Requirement: Definition of Done For Migration Steps

A migration step MUST NOT be considered complete until all of the following are true:

- Current-state specs describe the resulting behavior.
- The implementation matches those specs.
- Targeted validation has been run and reported.
- `tasks.json` is updated if the migration tracker status changed.
- Any remaining exploratory notes are archived in task specs rather than left as de facto source of truth.

#### Scenario: Completing a migration step

- **WHEN** a developer marks a migration step as done
- **THEN** the step MUST have updated specs, matching implementation, reported validation results, updated `tasks.json` status, and archived exploratory notes
