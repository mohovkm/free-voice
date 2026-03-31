# E2E User-Story Coverage

## Purpose

Defines the authoritative browser-level coverage plan for the web client. This spec is driven by the current product specs first, then annotated with current validation status and execution-layer choices so Playwright growth follows supported behavior instead of drifting from it.

Existing Playwright files are treated as stale until they are refreshed against the current-state specs and the shipping routes/components. They may provide hints about prior validation intent, but they SHALL NOT be treated as the product contract or as sufficient proof that a scenario family is currently covered.
## Requirements
### Requirement: Coverage matrix tracks current-state user-story domains

The repository SHALL maintain an end-to-end coverage matrix for the browser client that is grounded in the current-state specs under `openspec/specs/`.

The matrix SHALL track each domain's authoritative spec sources, current coverage state, and intended execution layer.

| Domain | Authoritative spec sources | Current coverage state | Intended execution layer | Notes |
|---|---|---|---|---|
| Auth and account access | `web-client`, `api-service` | `partial` | `both` | Login, logout, redirects, migration, reset, and register surfaces are spec-defined; migration and reset remain high-risk |
| Contacts and conversations | `web-client`, `online-presence`, `last-message-preview` | `partial` | `both` | Contact creation/acceptance, unread clearing, presence, and preview behavior are core Matrix-mode flows |
| Messaging timeline | `web-client`, `message-types` | `partial` | `both` | Text, typing, read receipts, pagination, system events, and call-log messages belong to the room timeline contract |
| Media messaging | `web-client`, `message-types`, `media-retention`, `audio-waveform-player` | `missing` | `local-playwright` | Happy-path and failure-path browser coverage is still required for image/audio/video/file handling |
| Group rooms | `web-client` | `partial` | `both` | Owner/member permissions and room settings are supported browser behavior, but deployed coverage is thinner than the contract |
| Direct calling | `realtime-call-flow`, `call-state-machine`, `web-client` | `partial` | `both` | Outgoing/incoming call entry is covered more than decline/cancel/no-answer/recovery paths |
| Group calling | `call-state-machine`, `realtime-call-flow` | `partial` | `real-playwright` | LiveKit join and media-flow checks require the deployed stack |
| Settings and shell surfaces | `web-client`, `push-notifications`, `frontend-guardrails` | `partial` | `local-playwright` | Theme/language, push state, and settings-linked navigation are mostly browser-local behaviors |
| PWA and browser lifecycle | `web-client`, `pwa-watchdog-reload`, `push-notifications`, `call-state-machine` | `partial` | `both` | Manifest/meta, cache clear, watchdog, and lifecycle recovery combine local browser hooks with some environment-sensitive flows |

#### Scenario: Spec-defined auth and messaging domains appear in the matrix
- **WHEN** the coverage matrix is reviewed for supported browser-visible behavior
- **THEN** it SHALL include auth/account, contacts/conversations, messaging timeline, and media messaging domains derived from the current-state specs

#### Scenario: Calling and lifecycle domains appear in the matrix
- **WHEN** the coverage matrix is reviewed for runtime-sensitive behavior
- **THEN** it SHALL include direct calling, group calling, and PWA or browser-lifecycle domains derived from the current-state specs

#### Scenario: Each domain includes coverage state and intended layer
- **WHEN** a domain is listed in the matrix
- **THEN** it SHALL record both a current coverage state (`covered`, `partial`, `missing`, or `blocked`) and an intended execution layer (`local-playwright`, `real-playwright`, or `both`)

### Requirement: Execution-layer assignment follows the product contract, not the existing suite layout

Execution-layer choices SHALL be made from the behavior under test rather than from where current tests already happen to exist.

- `local-playwright` SHALL be used for deterministic browser behavior, mocked routing, UI state, upload validation, service-worker hooks, and other flows that do not require real distributed state
- `real-playwright` SHALL be used for Matrix sync, multi-user room state, presence propagation, read receipts, call signaling, WebRTC transport, and similar deployed-stack behaviors
- `both` SHALL be used when a flow has a browser-local contract that benefits from fast feedback and a distributed contract that still needs live validation

#### Scenario: Deterministic browser flow is classified locally
- **WHEN** a scenario only depends on client-side rendering, mocked boundaries, or browser APIs under test control
- **THEN** the matrix SHALL classify it as `local-playwright` even if no local test exists yet

#### Scenario: Distributed Matrix or media flow is classified as real
- **WHEN** a scenario depends on live Matrix sync, two-user behavior, presence propagation, or real WebRTC transport
- **THEN** the matrix SHALL classify it as `real-playwright` or `both` even if a mocked Playwright test already exists

### Requirement: Code-visible surfaces outside the current spec set are tracked as drift, not treated as authoritative product contracts

When browser-visible routes or flows exist in the codebase without a matching authoritative current-state spec, the coverage plan SHALL list them explicitly as drift items instead of treating current tests or routes as the source of truth.

Current drift items are:

- Guest or link-based call entry under `routes/call/[slug]/+page.svelte` and `/api/links/*`
- Settings-linked static surfaces under `/guide`, `/about`, and `/links`
- Push-triggered incoming-call behavior, where `call-state-machine` documents the runtime path but `push-notifications` still declares message and call delivery as a known gap

#### Scenario: Code-visible route lacks an authoritative product spec
- **WHEN** a browser-visible flow is discovered in the codebase but not in the current-state specs
- **THEN** the coverage plan SHALL record it as a drift item and SHALL NOT elevate it above the authoritative spec set

#### Scenario: Spec and runtime documents disagree
- **WHEN** two current-state specs disagree about whether a browser-visible path is fully supported
- **THEN** the coverage plan SHALL record the disagreement explicitly and SHALL keep affected end-to-end expectations marked as blocked or prerequisite-bound

### Requirement: Blocked scenario families are documented with explicit prerequisites

Scenario families that cannot yet be treated as executable E2E coverage SHALL remain in the matrix with their blocker stated explicitly.

| Scenario family | Blocker |
|---|---|
| Matrix message or call notification delivery while offline | `push-notifications` still documents Matrix delivery as a known gap pending Sygnal or an equivalent delivery path |
| Push-triggered incoming-call E2E on the deployed stack | Current-state docs disagree between `push-notifications` and `call-state-machine`; product contract reconciliation is required before treating this as executable coverage |
| iOS-specific background and notification-resume behavior | Stable CI automation and device-level harnessing are not yet defined; hook-level browser coverage can exist before full device E2E |

#### Scenario: Blocked flow remains visible in planning
- **WHEN** a scenario family cannot yet be automated end to end
- **THEN** it SHALL remain listed in the blocked registry with its prerequisite rather than disappearing from the coverage plan

### Requirement: High-risk edge cases are prioritized ahead of low-signal smoke growth

The browser coverage backlog SHALL prioritize the following edge-case families before broadening low-risk smoke checks:

- auth and migration regressions that can block sign-in or password recovery
- contact and messaging regressions such as duplicate echo, unread clearing, typing visibility, read receipts, and presence freshness
- media failure paths such as oversize uploads, waveform or duration fallback, missing thumbnails, expired media, and download handling
- direct-call lifecycle failures such as decline, cancel, no-answer, remote hangup, reconnect, reload, and foreground return
- PWA recovery paths such as cache-clear safety, service-worker controller takeover, watchdog-triggered recovery, and stale foreground sync

#### Scenario: Happy-path-only growth is rejected for a high-risk area
- **WHEN** a contributor expands browser coverage for auth, messaging, media, calls, or PWA behavior
- **THEN** the backlog SHALL prioritize the relevant failure or recovery scenarios before adding only additional smoke assertions

### Requirement: Contact reject and re-invite lifecycle remains part of real browser coverage

The browser coverage plan SHALL treat reject and re-invite contact lifecycle behavior as an authoritative real-Playwright scenario family.

#### Scenario: Coverage plan records the re-invite lifecycle

- **WHEN** the contacts and conversations domain is reviewed for deployed-stack coverage
- **THEN** it SHALL include a scenario where one user rejects a direct-contact request and the other user sends a new request without browser reload
- **THEN** the intended execution layer for that scenario SHALL be `real-playwright`

#### Scenario: Expected outcome is a fresh pending request

- **WHEN** the reject and re-invite lifecycle scenario is executed under valid preconditions
- **THEN** the coverage contract SHALL expect the recipient to see a fresh pending contact request with accept or reject controls
- **THEN** stale accepted-contact rows caused by leftover room state SHALL be treated as a regression or precondition failure, not as successful coverage

### Requirement: E2E coverage plan inventories supported browser user stories

The project SHALL maintain an authoritative end-to-end coverage plan for the web client that maps supported browser-visible behavior to user-story domains and scenario families.

The plan SHALL include, at minimum, the following domains and story families:

| Domain | Story families that SHALL be represented |
|---|---|
| Auth and account access | login success/failure, unauthenticated redirect, logout, registration surface, password-reset and verification flows, legacy-to-Matrix migration, plain-username/localpart sign-in |
| Contacts and conversations | empty and populated chat list states, add/accept/reject contact flows, DM room entry, group creation entry, unread badge clearing, presence indicator wiring, last-message preview behavior |
| Messaging timeline | text send/receive, local echo reconciliation, typing indicators, read receipts, pagination/load-more, system messages, call log messages |
| Media messaging | image/audio/video/file send and render flows, voice recording waveform and duration behavior, upload size-limit failures, expired-media fallbacks, image download |
| Group rooms | owner/member permission differences, settings-route access, room rename, member add/remove flows, active room call banner |
| Direct calling | outgoing and incoming call entry, answer/decline/hangup/cancel/no-answer flows, call end-state reporting, permission or device failures, reload/background recovery |
| Group calling | room call join, participant count, rejoin, reconnect, and RTP media-flow verification |
| Settings, shell, and static app surfaces | language and theme toggles, persistence-sensitive settings behavior, guide/about/links route rendering, general route smoke coverage |
| PWA and browser lifecycle | manifest/meta/install surface, push-subscription state, cache clear, service-worker controller-change reload, watchdog reload, foreground stale-sync recovery |

#### Scenario: Auth and account stories are present in the plan
- **WHEN** the coverage plan is reviewed for authentication behavior
- **THEN** it SHALL include story families for login, logout, unauthenticated redirects, registration/reset surfaces, and legacy-to-Matrix migration paths

#### Scenario: Messaging and media stories are present in the plan
- **WHEN** the coverage plan is reviewed for room-timeline behavior
- **THEN** it SHALL include text, media, local-echo, typing, read-receipt, pagination, and expired-media scenario families

#### Scenario: Calling and PWA lifecycle stories are present in the plan
- **WHEN** the coverage plan is reviewed for runtime-sensitive behavior
- **THEN** it SHALL include direct-call, group-call, service-worker, watchdog, and background/foreground recovery scenario families

### Requirement: Each scenario family is assigned to an execution layer and coverage state

Each scenario family in the coverage plan SHALL declare both an execution layer and a current coverage state.

- Allowed execution layers: `local-playwright`, `real-playwright`, or `both`
- Allowed coverage states: `covered`, `partial`, `missing`, or `blocked`

Layer assignment SHALL follow these rules:

- `local-playwright` SHALL be used for deterministic UI, routing, input validation, mocked permission handling, and browser behavior that does not require real distributed state
- `real-playwright` SHALL be used for Matrix sync, multi-user behavior, read receipts, presence propagation, actual call signaling, WebRTC media flow, or other deployed-stack behavior
- `both` SHALL be used when a story needs fast deterministic feedback locally and a thinner deployed validation slice for integration confidence
- `blocked` SHALL only be used when the product contract or environment prerequisite is unresolved, and the prerequisite SHALL be named explicitly in the plan

#### Scenario: Deterministic client story uses local Playwright
- **WHEN** a scenario family only depends on local browser state or mocked boundaries
- **THEN** the plan SHALL classify it as `local-playwright` rather than `real-playwright`

#### Scenario: Multi-user transport story uses real Playwright
- **WHEN** a scenario family depends on Matrix sync, multi-user room state, or real WebRTC transport
- **THEN** the plan SHALL classify it as `real-playwright` or `both`

#### Scenario: Blocked scenario names its prerequisite
- **WHEN** a scenario family cannot yet be automated because a product contract or environment prerequisite is unresolved
- **THEN** the plan SHALL mark it `blocked` and SHALL name the missing prerequisite instead of treating it as covered

### Requirement: The plan prioritizes high-risk edge cases and regression paths

The coverage plan SHALL explicitly identify high-risk edge-case families that need incremental automation priority over low-risk smoke coverage.

High-risk families SHALL include at least:

- auth and migration regressions that can block sign-in or password recovery
- contact and messaging sync regressions such as duplicate echo, unread clearing, presence staleness, typing visibility, and read receipts
- media-path failures such as oversize uploads, decode fallback, missing thumbnails, expired media, and download behavior
- call-state failures such as decline, cancel, no-answer, remote hangup, reconnect, page reload, foreground return, and media-permission failure
- PWA lifecycle failures such as cache-clear recovery, service-worker takeover, watchdog-triggered recovery, and stale foreground sync

#### Scenario: Media failure coverage is prioritized
- **WHEN** the plan lists media messaging scenarios
- **THEN** it SHALL include upload-limit and expired-media fallback scenarios as high-risk coverage work, not only happy-path media sends

#### Scenario: Call lifecycle failures are prioritized
- **WHEN** the plan lists calling scenarios
- **THEN** it SHALL include failure and recovery paths such as decline, cancellation, reconnect, and background or reload recovery alongside happy-path call connection

#### Scenario: Push-dependent scenarios are not overstated
- **WHEN** a scenario depends on notification delivery or another disputed prerequisite
- **THEN** the plan SHALL classify it as `blocked` or equivalent gap status until the prerequisite is confirmed by the product contract

