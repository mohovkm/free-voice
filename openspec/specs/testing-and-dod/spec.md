# Testing Strategy And DoD

## Purpose

Defines where tests belong, how they should be written, and what validation is required before a task is considered complete.
## Requirements
### Requirement: Test Layer Placement

Tests MUST be placed in the correct location and use the correct framework based on what they validate.

#### Scenario: Python API test

- **WHEN** a change affects FastAPI routes, request/response contracts, permission/validation logic, token minting, or DAO-facing behavior
- **THEN** the test SHALL be placed in `backend/tests/`
- **THEN** the test SHALL use `pytest`
- **THEN** the test SHALL mock network and external systems not under project control

#### Scenario: Frontend unit or service test

- **WHEN** a change affects stores, services, config, auth, backend adapters, call state logic, or small component contracts
- **THEN** the test SHALL be placed in `client/tests/unit/`
- **THEN** the test SHALL use `vitest`
- **THEN** the test environment SHALL be `happy-dom` via the client Vite configuration

#### Scenario: Frontend end-to-end test (local)

- **WHEN** a change requires browser-level validation against the built preview app
- **THEN** the test SHALL be placed in `client/tests/e2e/local/*.spec.ts`
- **THEN** the test SHALL use Playwright

#### Scenario: Frontend end-to-end test (deployed)

- **WHEN** a change requires validation against the deployed server or multi-user Matrix behavior
- **THEN** the test SHALL be placed in `client/tests/e2e/real/*.spec.ts`
- **THEN** the test SHALL use Playwright against the deployed server

### Requirement: Python Test Authoring

Python tests MUST follow contract-oriented patterns and isolate external dependencies.

#### Scenario: Writing a pytest test

- **WHEN** a contributor writes a Python test
- **THEN** the test SHALL be kept inside the backend workspace at `backend/tests/`
- **THEN** the test SHALL test observable behavior and contract outcomes
- **THEN** external HTTP calls, push providers, and homeserver interactions SHALL be patched instead of relying on the real network
- **THEN** targeted fixture reuse SHALL be preferred through `backend/tests/conftest.py`

### Requirement: Frontend Test Authoring

Frontend tests MUST test behavior over implementation and isolate external boundaries.

#### Scenario: Writing a Vitest test

- **WHEN** a contributor writes a frontend unit test
- **THEN** the test SHALL test behavior, not implementation internals
- **THEN** the test SHALL prefer store/service contract tests and user-facing component outcomes
- **THEN** external dependencies and network boundaries SHALL be mocked
- **THEN** if DOM simulation is insufficient for a browser-specific behavior, that scenario SHALL be escalated to Playwright rather than overfitting `happy-dom`

### Requirement: Playwright Test Authoring

Playwright tests MUST test user-visible behavior with resilient locators and proper isolation.

#### Scenario: Writing a Playwright test

- **WHEN** a contributor writes a Playwright test
- **THEN** the test SHALL test user-visible behavior
- **THEN** the test SHALL be isolated and control the data it depends on
- **THEN** the test SHALL prefer resilient locators and web-first assertions
- **THEN** the test MUST NOT test third-party systems unless the scenario is explicitly a deployed integration check

#### Scenario: Grouping E2E tests by domain

- **WHEN** a contributor adds E2E coverage for a feature
- **THEN** the test SHALL be appended inside the existing spec file for that business domain at the appropriate point in the flow
- **THEN** a new spec file MUST NOT be created just to test a single feature that sits inside an already-covered flow (e.g., typing indicators belong in `two-user.spec.ts` messaging section, not a standalone `typing.spec.ts`)

#### Scenario: Running real E2E tests

- **WHEN** a contributor runs real E2E tests
- **THEN** the updated code MUST be deployed (e.g., `make install-client`) before real E2E tests can verify the new behavior
- **THEN** the contributor SHALL understand that running real E2E before deployment will always test the previous version

#### Scenario: Using the real suite

- **WHEN** a contributor decides whether to use the real E2E suite
- **THEN** the real suite SHALL be used only for flows that genuinely require the deployed stack

#### Scenario: Browser-level change needs layer selection

- **WHEN** a contributor changes browser-visible auth, messaging, media, call, settings, or PWA behavior
- **THEN** they SHALL map the affected scenario family to the authoritative coverage plan in `openspec/specs/e2e-user-story-coverage/spec.md`
- **THEN** they SHALL choose `local-playwright`, `real-playwright`, or `both` based on the behavior under test rather than on the current suite layout

#### Scenario: Current tests and product docs disagree

- **WHEN** the existing Playwright suite and the authoritative current-state specs imply different support levels for a browser-visible flow
- **THEN** the contributor SHALL treat `openspec/specs/` as the product source of truth
- **THEN** they SHALL use the coverage plan only to record current validation state, drift items, or blocked scenarios

#### Scenario: Auth flows in E2E

- **WHEN** an E2E test involves auth flows that depend on verification or reset email
- **THEN** the test MAY use `EMAIL_DEBUG=1` on the API service and consume returned debug links instead of scraping SMTP delivery
- **THEN** when real E2E needs a verified unmigrated legacy user and normal registration is outside the scenario under test, it MAY use the debug-only fixture endpoint exposed under `EMAIL_DEBUG=1`

#### Scenario: Real contact lifecycle tests validate deployed-state preconditions

- **WHEN** a real Playwright test exercises reject, acceptance, or re-invite behavior for Matrix contacts
- **THEN** the test SHALL verify that no stale accepted contact relationship remains that would invalidate the scenario
- **THEN** the test SHALL reset that state through supported client behavior or fail with an explicit precondition error before asserting pending invite controls

#### Scenario: Contact lifecycle regression uses both narrow and real validation

- **WHEN** a change modifies Matrix contact rejection, acceptance, or re-invite logic
- **THEN** targeted client-side unit coverage SHALL be added or updated for the affected contact-state logic
- **THEN** real Playwright validation SHALL run for the deployed multi-user lifecycle path when the change affects live propagation or room-state reconciliation

### Requirement: WebRTC Media Flow Verification

WebRTC media verification MUST use RTP stats rather than relying solely on UI state.

#### Scenario: Verifying media is flowing

- **WHEN** a test needs to verify actual media flow beyond UI state (mic button enabled, participant count)
- **THEN** the test SHALL intercept `RTCPeerConnection` at context level via `context.addInitScript()` and collect instances in `window.__rtcPCs`
- **THEN** the test SHALL call `pc.getStats()` from `page.evaluate()` after a short accumulation wait (≥ 2 s with fake devices)
- **THEN** the test SHALL assert `outbound-rtp.bytesSent > 0` for publishing and `inbound-rtp.bytesReceived > 0` for receiving
- **THEN** the test SHALL use `report.mediaType` to assert audio and video independently
- **THEN** the test SHALL skip connections where `signalingState === 'closed'` (stale from a previous call on the same SPA page)

### Requirement: Test Commands

Test execution MUST use the established command interfaces.

#### Scenario: Running Python tests

- **WHEN** a contributor runs Python tests
- **THEN** they SHALL use:

```bash
pytest
pytest backend/tests/test_<domain>.py
```

#### Scenario: Running frontend tests

- **WHEN** a contributor runs frontend tests
- **THEN** they SHALL use:

```bash
cd client
npm run check
npm run test:unit
npm run test:e2e
npx playwright test --config tests/e2e/playwright.real.config.ts
```

### Requirement: Task-Level Definition Of Done

Every task MUST meet minimum DoD criteria, with expanded criteria for high-risk areas.

#### Scenario: Minimum DoD

- **WHEN** a task is completed
- **THEN** the implementation SHALL be completed
- **THEN** relevant system specs SHALL be updated if behavior changed
- **THEN** the narrowest relevant validation SHALL have run successfully

#### Scenario: Expanded DoD

- **WHEN** a task touches public routes, auth, calls, media, migration boundaries, or deployment
- **THEN** targeted unit/API tests SHALL be updated or added
- **THEN** browser or end-to-end validation SHALL run where the risk requires it
- **THEN** backward-compatibility implications SHALL be documented
- **THEN** unverified production-only behavior SHALL be called out explicitly

### Requirement: Validation Reporting

Every completed task MUST include a validation report.

#### Scenario: Reporting validation results

- **WHEN** a contributor completes a task
- **THEN** they SHALL report which commands were run
- **THEN** they SHALL report what passed
- **THEN** they SHALL report what was not tested
- **THEN** they SHALL report any environment limitation that prevented stronger validation

### Requirement: Browser-level changes map back to the E2E user-story coverage plan

When a change affects browser-visible client behavior, contributors SHALL use the `e2e-user-story-coverage` plan to decide whether Playwright coverage must be added, expanded, or explicitly deferred.

For every affected browser-visible flow, the change SHALL:

- identify the affected user-story domain and scenario family in the coverage plan
- keep the execution-layer choice aligned with the plan (`local-playwright`, `real-playwright`, or `both`)
- update the plan in the same change if the product surface or risk profile changes materially
- document any `blocked` scenario with its prerequisite rather than silently omitting coverage expectations

#### Scenario: Existing domain coverage is expanded
- **WHEN** a contributor changes an existing browser-visible flow such as auth, messaging, media, calls, settings, or PWA behavior
- **THEN** they SHALL map the change to the existing scenario family in `e2e-user-story-coverage`
- **AND** they SHALL extend the existing Playwright domain coverage or explicitly document why it remains blocked

#### Scenario: New browser-visible scenario family is introduced
- **WHEN** a contributor introduces a new browser-visible story that is not yet represented in the coverage plan
- **THEN** they SHALL update `e2e-user-story-coverage` in the same change before or alongside adding Playwright coverage

### Requirement: E2E backlog growth preserves business-domain grouping

Coverage added from the E2E user-story plan SHALL continue to grow inside the existing business-domain-oriented Playwright suite structure unless a genuinely new domain is introduced.

#### Scenario: Story fits an existing Playwright domain
- **WHEN** a new E2E scenario belongs to an already-covered business flow such as auth, two-user messaging, group chat, settings, or LiveKit room calls
- **THEN** the scenario SHALL be appended to the existing domain spec file at the appropriate point in the flow

#### Scenario: Story introduces a genuinely new business domain
- **WHEN** a new E2E scenario does not fit any existing business-domain suite
- **THEN** a new Playwright spec file MAY be introduced, but only for that new domain rather than for a narrow subfeature

### Requirement: Frontend TypeScript Validation
Client changes that introduce or modify TypeScript SHALL run type-aware validation in addition to existing lint and test checks.

#### Scenario: Validating migrated client code
- **WHEN** a contributor changes TypeScript-bearing client code, TypeScript configuration, or Svelte `lang="ts"` scripts
- **THEN** the contributor SHALL run the relevant TypeScript-aware validation command for the client workspace
- **THEN** the validation report SHALL state whether formatting, linting, type-checking, and unit tests passed

### Requirement: Frontend Coverage Reporting
Client migration work SHALL produce unit-test coverage output so maintainers can see where typed refactors remain weakly protected.

#### Scenario: Running client unit tests for migration work
- **WHEN** a contributor validates a TypeScript migration task with frontend unit tests
- **THEN** the client test command or companion validation command SHALL emit a coverage report for the executed unit-test suite
- **THEN** the contributor SHALL call out migrated areas that still lack meaningful coverage if they remain untested

#### Scenario: Validating residual runtime-module migration
- **WHEN** a contributor migrates remaining client-side runtime modules such as Matrix adapters, event stores, browser integrations, push logic, or service worker support
- **THEN** the validation report SHALL distinguish targeted coverage for the migrated slice from any broader suite failures that remain outside the touched area
- **THEN** explicit environment limitations for browser-only, service-worker, or e2e-sensitive paths SHALL be recorded instead of silently treating them as fully verified
