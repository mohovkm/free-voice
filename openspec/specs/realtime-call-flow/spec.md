# Realtime Call Flow

## Purpose

Captures the cross-cutting call flow contracts shared by the client, API, and media layers for both legacy SIP/Asterisk and Matrix calling paths.

## Requirements

### Requirement: Client Call Ownership

`client/src/lib/services/callSession.ts` SHALL be the single owner of call lifecycle transitions. UI routes and components MUST NOT invent independent lifecycle states; they may trigger call actions but MUST delegate state transitions to `callSession.ts`. Shared state semantics are defined in the [call-state-machine spec](../call-state-machine/spec.md).

#### Scenario: UI component triggers a call action

- **WHEN** a UI route or component initiates a dial or hangup
- **THEN** it MUST invoke the corresponding method on `callSession.ts` and MUST NOT manage phase transitions independently

### Requirement: Legacy SIP / Asterisk Path

The legacy calling path SHALL follow this sequence:

1. The client acquires media and registers a SIP session.
2. The client or API resolves the room or peer target.
3. Asterisk terminates signaling and bridges media through ConfBridge where required.
4. TURN is used as fallback for hostile NAT paths.
5. Cleanup MUST clear timers, local media, SIP resources, and any stale room membership state.

#### Scenario: Legacy call teardown

- **WHEN** a legacy SIP call ends (local or remote hangup)
- **THEN** cleanup SHALL clear all timers, release local media tracks, tear down SIP resources, and remove any stale room membership state

### Requirement: Matrix Path

The Matrix calling path SHALL follow this sequence:

1. The active backend creates or retrieves the Matrix call context for the room or DM.
2. The client sends or receives Matrix VoIP events.
3. Incoming call signaling MUST NOT depend on a single deferred SDK event path; user-facing navigation needs a low-latency signal.
4. Answer and hangup flows MUST leave the UI, active backend state, and media resources consistent even when signaling races occur.

#### Scenario: Incoming Matrix call with signaling race

- **WHEN** an incoming Matrix call arrives and the user answers while a concurrent hangup event is in flight
- **THEN** the answer and hangup flows MUST resolve to a consistent state across UI, backend, and media resources without silent stalls

### Requirement: Reliability Rules

All call paths SHALL observe the following reliability rules:

- Client-side call entry points MUST fail fast if the selected backend is not initialized.
- Navigation-triggered call flows MUST be safe on both client-side route changes and full page reloads.
- Missing critical signaling MUST surface as explicit warnings or actionable failures, not silent stalls.
- Any change to call phases, reasons, or transition semantics MUST include a matching update to the call-state-machine spec.

#### Scenario: Backend not initialized

- **WHEN** a call entry point is invoked and the selected backend has not completed initialization
- **THEN** the call attempt MUST fail fast with an actionable error rather than stalling silently

#### Scenario: Page reload during active call

- **WHEN** the user reloads the page while a call flow is in progress
- **THEN** the navigation-triggered flow MUST clean up safely without leaving orphaned media or signaling resources
