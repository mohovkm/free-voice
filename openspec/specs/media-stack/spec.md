# Media Stack

## Purpose

Specifies the current calling and realtime media stack components, browser calling constraints, codec configuration, stale channel defense, and network/proxy rules.

## Requirements

### Requirement: Media Stack Components

The system SHALL include the following media components:

- Asterisk 20 plus FreePBX 17 handle legacy SIP/WebRTC signaling and room media.
- ConfBridge is the active bridge for current browser-based room media.
- coturn provides TURN for NAT traversal.
- nginx terminates TLS and proxies websocket traffic.
- SIP.js is the browser SIP client for the legacy media path.
- LiveKit exists in the deployment tree for group-call evolution during the Matrix transition.

#### Scenario: Deploying the media stack

- **WHEN** the media stack is deployed via Ansible
- **THEN** all listed components SHALL be present and configured according to their respective role definitions

### Requirement: Browser Calling Constraints

The following ConfBridge constraints MUST be maintained for browser-based calling:

- ConfBridge `video_mode` MUST stay `follow_talker`.
- `video_update_discard=500` is required to avoid long freezes during active speaker changes.
- `max_members=3` SHALL be kept as a safety margin during stale-channel rejoin races.
- `sfu` mode MUST NOT be enabled for this path; it is not compatible with the current single-stream browser client.

#### Scenario: Configuring ConfBridge for browser rooms

- **WHEN** a ConfBridge room is created for browser-based calling
- **THEN** `video_mode` SHALL be `follow_talker`, `video_update_discard` SHALL be `500`, `max_members` SHALL be `3`, and `sfu` mode SHALL be disabled

### Requirement: Endpoint and Codec Constraints

Endpoint codec order MUST be `opus,ulaw,alaw,vp8,vp9`. `ulaw` MUST NOT be moved ahead of `opus`. H.264 MUST NOT be part of the current ConfBridge softmix browser path. `timers_sess_expires=90` and `timers_min_se=90` are required for stable cleanup behavior.

#### Scenario: Verifying codec order on a WebRTC endpoint

- **WHEN** a WebRTC endpoint is configured
- **THEN** the codec order SHALL be `opus,ulaw,alaw,vp8,vp9` and session timer values SHALL be `timers_sess_expires=90` and `timers_min_se=90`

### Requirement: Stale Channel Defense

All of the following layers are required together and MUST NOT be deployed partially:

1. Best-effort websocket close on page exit.
2. `remove_existing=yes` on registration.
3. Dialplan `SoftHangup` plus `Wait(1)` before rejoin.
4. `qualify_frequency=15`.
5. Session refresh expiry at 90 seconds.

#### Scenario: Browser tab closed during active call

- **WHEN** a user closes the browser tab during an active call
- **THEN** the best-effort websocket close SHALL fire, and the remaining stale channel defense layers (registration removal, SoftHangup, qualify, session expiry) SHALL clean up the orphaned channel

### Requirement: Network and Proxy Constraints

The following network and proxy rules MUST be observed:

- `http2` MUST NOT be enabled on the websocket listener.
- TURN credentials SHALL be issued through `GET /api/turn-credentials` using ephemeral HMAC-based credentials.
- `LD_PRELOAD=/usr/lib/aarch64-linux-gnu/libopus.so.0` is required for the Asterisk opus module to load correctly.
- The LiveKit nginx proxy location MUST use a trailing slash on both the `location` block and `proxy_pass` target (`location /livekit-ws/ { proxy_pass http://127.0.0.1:<port>/; }`). Without the trailing slash nginx does not strip the `/livekit-ws/` prefix, so the `/rtc` path appended by livekit-client reaches the upstream as `/livekit-ws/rtc` and the WebSocket handshake fails.

#### Scenario: Configuring LiveKit nginx proxy

- **WHEN** the LiveKit websocket proxy is configured in nginx
- **THEN** both the `location` block and `proxy_pass` target MUST include a trailing slash to ensure correct path stripping

#### Scenario: Asterisk opus module loading

- **WHEN** Asterisk starts on the aarch64 platform
- **THEN** `LD_PRELOAD=/usr/lib/aarch64-linux-gnu/libopus.so.0` MUST be set for the opus module to load correctly

### Requirement: Change Control

Media-path changes MUST preserve currently deployed call behavior unless an explicit migration step says otherwise. Any change to codec order, session timers, TURN issuance, or bridge mode MUST include an update to this document in the same change.

#### Scenario: Modifying codec order

- **WHEN** a change proposes to alter the endpoint codec order
- **THEN** this spec MUST be updated in the same change and the new order MUST be validated against deployed call behavior
