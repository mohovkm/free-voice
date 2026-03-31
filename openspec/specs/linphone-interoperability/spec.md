# Linphone Interoperability

## Purpose

Specifies the supported Linphone interoperability settings for legacy SIP endpoints connecting to the VoIP system.

## Requirements

### Requirement: Desktop Account Configuration

Desktop Linphone clients SHALL use the FreePBX extension number as username, the deployed VoIP domain as domain, UDP as transport, and the extension password from FreePBX. Clients SHOULD match media encryption with the server configuration and SHOULD disable AVPF if negotiation issues appear.

#### Scenario: Desktop client registers successfully

- **WHEN** a desktop Linphone client is configured with the FreePBX extension number, deployed VoIP domain, UDP transport, and extension password
- **THEN** it SHALL register and be able to place and receive calls

### Requirement: iOS Account Configuration

iOS Linphone clients SHALL use the same username, domain, and password model as desktop clients. The outbound proxy SHALL be set to the deployed VoIP domain for reliable outgoing calls. Microphone access MUST be granted and background calling SHALL be treated as push-dependent behavior.

#### Scenario: iOS client registers and places outbound call

- **WHEN** an iOS Linphone client is configured with extension credentials and the outbound proxy set to the deployed VoIP domain
- **THEN** it SHALL register and reliably place outgoing calls

### Requirement: FreePBX Extension Settings for Linphone

For Linphone-only extensions, WebRTC defaults MUST be disabled. ICE support SHALL remain enabled. Direct media MUST be disabled. Media encryption SHALL be aligned with the client capability being used.

#### Scenario: Linphone-only extension is provisioned

- **WHEN** a FreePBX extension is designated for Linphone-only use
- **THEN** WebRTC defaults MUST be disabled, ICE MUST remain enabled, direct media MUST be disabled, and media encryption SHALL match the client capability

### Requirement: Known Constraints Handling

Linphone video interoperability SHALL be treated as more fragile than the browser WebRTC path. When troubleshooting video failures, operators MUST prefer narrowing codecs and validating SDP compatibility before changing Asterisk topology. Codec mismatches and direct-media reinvite behavior can terminate video unexpectedly.

#### Scenario: Video call fails between Linphone and the system

- **WHEN** a Linphone video call fails or terminates unexpectedly
- **THEN** the operator SHALL first narrow codecs and validate SDP compatibility before changing Asterisk topology

### Requirement: Spec Change Control

Linphone behavior SHALL be treated as a compatibility surface, not a primary architecture driver. This spec MUST be updated if extension defaults, codec expectations, or required account settings change.

#### Scenario: Extension defaults or codec expectations change

- **WHEN** any change modifies Linphone extension defaults, codec expectations, or required account settings
- **THEN** this spec MUST be updated in the same change
