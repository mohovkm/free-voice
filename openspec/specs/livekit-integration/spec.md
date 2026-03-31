# LiveKit Integration

## Purpose

Specifies the LiveKit integration used for group-call media offload during the Matrix migration, where Matrix remains the identity and signaling authority.

## Requirements

### Requirement: Deployment Model

The LiveKit service SHALL be deployed as a standalone systemd service installed from the official release archive for the target architecture. The configuration SHALL bind on all interfaces using external IP mode for RTC. TURN inside LiveKit MUST be disabled because coturn remains the active TURN service.

Current ownership:

- Deployment: `ansible/roles/livekit/`
- API token minting: `backend/src/routes/livekit.py`
- Client join path: `client/src/lib/services/callSession.ts`

#### Scenario: LiveKit service starts correctly

- **WHEN** the LiveKit systemd service is started
- **THEN** it SHALL bind on all interfaces with external IP mode for RTC and MUST NOT enable its built-in TURN relay

### Requirement: API Token Endpoint

The API SHALL expose `POST /api/livekit-token` accepting `{ "room_name": string }` with `Bearer <matrix access token>` authorization. The API SHALL validate the Matrix token against Dendrite `/_matrix/client/v3/account/whoami` and, on success, mint a short-lived LiveKit JWT with join/publish/subscribe grants for the requested room.

#### Scenario: Valid Matrix token produces LiveKit JWT

- **WHEN** a client sends `POST /api/livekit-token` with a valid Matrix access token and a room name
- **THEN** the API SHALL validate the token against Dendrite whoami and return a short-lived LiveKit JWT with join, publish, and subscribe grants for the requested room

#### Scenario: Invalid Matrix token is rejected

- **WHEN** a client sends `POST /api/livekit-token` with an invalid or expired Matrix access token
- **THEN** the API SHALL reject the request without minting a token

### Requirement: Client Group-Call Contract

The group-call client path SHALL fetch the LiveKit token using the stored Matrix access token. Group-call presence SHALL also be signaled to Matrix rooms using `org.matrix.msc3401.call.member` state events. LiveKit room join/leave logic MUST remain consistent with the Matrix room-presence state updates.

#### Scenario: Client joins a group call

- **WHEN** a client joins a group call via LiveKit
- **THEN** it SHALL fetch a LiveKit token using the stored Matrix access token and SHALL signal presence to the Matrix room using `org.matrix.msc3401.call.member` state events

#### Scenario: Client leaves a group call

- **WHEN** a client leaves a LiveKit group call
- **THEN** the Matrix room-presence state event MUST be updated to reflect the departure

### Requirement: Validation Coverage

`backend/tests/test_livekit.py` SHALL cover authorization handling, Dendrite validation failure modes, and JWT claims.

#### Scenario: Test suite validates token endpoint

- **WHEN** the LiveKit API test suite runs
- **THEN** it SHALL verify authorization handling, Dendrite validation failure modes, and correctness of JWT claims

### Requirement: Spec Change Control

This document MUST be updated whenever the token endpoint contract, LiveKit deployment shape, Matrix validation flow, or room-presence behavior changes.

#### Scenario: Token endpoint contract changes

- **WHEN** any change modifies the token endpoint, deployment shape, Matrix validation flow, or room-presence behavior
- **THEN** this spec MUST be updated in the same change
