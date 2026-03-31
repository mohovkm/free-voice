# Message Types

## Purpose

Defines the supported Matrix message types, their event mappings, upload/download contracts, and rendering rules.

### Requirement: Supported message types
The system SHALL support the following message types, each mapped to a Matrix `content.msgtype`:

| Type | Matrix msgtype | Rendering |
|------|---------------|-----------|
| text | `m.text` | Text bubble (existing) |
| image | `m.image` | Thumbnail with tap-to-expand |
| audio | `m.audio` | Inline audio player with duration |
| video | `m.video` | Inline video player with thumbnail |
| file | `m.file` | File icon + name + size + download link |
| system | state events | Centered muted line (not a bubble) |

#### Scenario: Text message received
- **WHEN** a Matrix event with `msgtype: m.text` is received
- **THEN** it SHALL be rendered as a text chat bubble

#### Scenario: Image message received
- **WHEN** a Matrix event with `msgtype: m.image` is received
- **THEN** it SHALL be rendered as a thumbnail image inside a chat bubble

#### Scenario: Audio message received
- **WHEN** a Matrix event with `msgtype: m.audio` is received
- **THEN** it SHALL be rendered as an inline audio player showing duration

#### Scenario: Video message received
- **WHEN** a Matrix event with `msgtype: m.video` is received
- **THEN** it SHALL be rendered as an inline video player with a poster thumbnail

#### Scenario: File attachment received
- **WHEN** a Matrix event with `msgtype: m.file` is received
- **THEN** it SHALL be rendered as a file icon with filename, size, and a download action

#### Scenario: System event received
- **WHEN** a room state event (membership change, room name change, or call event) is received
- **THEN** it SHALL be rendered as a centered, muted system message line — not a chat bubble

### Requirement: Media upload contract
The system SHALL upload media via the Matrix SDK `uploadContent()` method and send the resulting `mxc://` URI in the event content.

#### Scenario: User sends a file attachment
- **WHEN** a user selects a file to attach
- **THEN** the system SHALL upload it via `uploadContent()`, then send an `m.room.message` event with the appropriate `msgtype` and `url` field containing the `mxc://` URI

### Requirement: Authenticated media download
All media downloads SHALL use `getMediaUrl(mxcUrl)` which converts `mxc://` URIs to authenticated HTTP download URLs via `_client.mxcUrlToHttp()`.

#### Scenario: Rendering an image from mxc URI
- **WHEN** a component needs to display media from an `mxc://` URI
- **THEN** it SHALL call `getMediaUrl(mxcUrl)` to obtain an authenticated HTTP URL

### Requirement: Audio recording
The system SHALL support recording audio messages via the browser MediaRecorder API. The record button SHALL be hidden if `MediaRecorder` is not supported.

#### Scenario: User records an audio message
- **WHEN** the user taps the record button and speaks
- **THEN** the system SHALL capture audio via `MediaRecorder`, upload the blob on stop, and send as `m.audio`

### Requirement: Video recording
The system SHALL support recording short video messages (max 60s) via the browser MediaRecorder API with camera preview.

#### Scenario: User records a video message
- **WHEN** the user taps the video record button
- **THEN** the system SHALL show a 160×160px viewfinder, capture via `MediaRecorder`, extract a thumbnail on stop, upload, and send as `m.video`

### Requirement: Normalized event shape extension
`normalizeEvent()` SHALL return a `type` field (`text | image | audio | video | file | system`) and a `media` object for non-text types.

The `media` object SHALL contain: `{ mxcUrl, mimeType, size, filename, thumbnailUrl }` with fields populated as available per message type.

#### Scenario: normalizeEvent receives m.image
- **WHEN** `normalizeEvent()` processes an event with `msgtype: m.image`
- **THEN** it SHALL return `type: 'image'` and `media: { mxcUrl, mimeType, size, filename, thumbnailUrl }` extracted from event content
