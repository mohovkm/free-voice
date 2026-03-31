# Feature Request Prompt Template

## Purpose

Provides a standardized prompt template for starting new feature requests under the repository's spec-driven workflow.

## Requirements

### Requirement: Prompt Template Structure

Every feature request SHALL use the following template structure:

```text
You are working in the repository at <repo-path>.

Feature request title:
<short feature name>

Goal:
<what outcome the feature must deliver for users or operators>

Current-state specs to read first:
- <openspec/specs/...>

Problem statement:
<what is missing, broken, or insufficient in the current system>

Requested change:
<the concrete capability or behavior to add or modify>

Scope:
- In scope: <list>
- Out of scope: <list>

Affected areas:
- Code: <paths/modules>
- Specs to update: <openspec/specs/... files>
- Optional task-spec to create/update: <openspec/changes/archive/YYYY/MM/TASK-.../spec.md>

Compatibility and migration constraints:
- <backward-compatibility rules>
- <data migration or coexistence rules>
- <operational safety constraints>

Validation requirements:
- <unit/integration/e2e commands or target checks>
- <what must be proven before the feature is considered done>

Deliverables:
- Code changes
- System spec updates in the same change
- Validation summary
- Residual risks or open questions
```

#### Scenario: New feature request is created

- **WHEN** a contributor starts a new feature request
- **THEN** they SHALL fill in all sections of the template above

### Requirement: Current-State Specs Reference

The `Current-state specs to read first` section MUST be filled with real files from `openspec/specs/`. Archived task specs MUST NOT be used as the current source of truth. If the feature needs planning or historical execution context, a task spec SHALL be created under `openspec/changes/archive/YYYY/MM/TASK-.../spec.md`.

#### Scenario: Feature request references archived spec as current truth

- **WHEN** a feature request lists an archived task spec as a current-state reference
- **THEN** it SHALL be rejected until corrected to reference files under `openspec/specs/`

### Requirement: Co-Landing Implementation And Spec Updates

The implementation change and the system-spec update MUST land together in the same change.

#### Scenario: Code change lands without spec update

- **WHEN** a feature implementation is submitted without the corresponding system-spec update
- **THEN** it SHALL be rejected until the spec update is included

### Requirement: Minimal Example

The template SHALL be demonstrated by the following minimal example:

```text
Feature request title:
Matrix typing indicators

Goal:
Show when another participant is actively typing in Matrix rooms.

Current-state specs to read first:
- openspec/specs/web-client/spec.md
- openspec/specs/matrix-client-backend/spec.md
- openspec/specs/api-service/spec.md

Problem statement:
The current Matrix client supports messages and unread counts but does not expose typing state to the UI.

Requested change:
Add typing indicator support for Matrix rooms in the client backend and room/chat UI.

Scope:
- In scope: Matrix room typing state subscription, UI display, spec updates
- Out of scope: Legacy backend typing indicators, message drafts sync

Affected areas:
- Code: client/src/lib/services/backends/matrix.ts, client/src/routes/(app)/room/[id]/+page.svelte
- Specs to update: openspec/specs/matrix-client-backend/spec.md, openspec/specs/web-client/spec.md
- Optional task-spec to create/update: openspec/changes/archive/YYYY/MM/TASK-.../spec.md

Compatibility and migration constraints:
- Must not break legacy backend behavior
- Must tolerate mixed Matrix/legacy rollout

Validation requirements:
- npm run test:unit
- npm run check

Deliverables:
- Code changes
- System spec updates in the same change
- Validation summary
- Residual risks or open questions
```

#### Scenario: Contributor follows the minimal example pattern

- **WHEN** a contributor models their feature request after the minimal example
- **THEN** the request SHALL contain all required sections with concrete values