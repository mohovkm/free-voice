# Audio Waveform Player

## Purpose

Defines the custom `AudioPlayer.svelte` component for `m.audio` messages, waveform data extraction for voice recordings, duration badges, and local echo behaviour.

## Requirements

### Requirement: Waveform audio player component

The system SHALL provide a custom `AudioPlayer.svelte` component that replaces the native `<audio>` element for `m.audio` messages.

The component SHALL accept a `media` prop with fields: `mxcUrl`, `httpUrl`, `durationSecs` (number | null), `waveformData` (number[] | null).

The component SHALL:
- Display 60 vertical amplitude bars derived from `waveformData`; if `waveformData` is absent, render 60 uniform-height bars as a placeholder
- Show a play/pause button
- Show elapsed and total time in `M:SS / M:SS` format (e.g., `0:14 / 0:32`)
- Show a horizontal scrub bar (HTML range input) that the user can drag to seek
- Update the progress bar and elapsed time continuously during playback
- Load the audio blob via `mediaCache.get()` and create a blob URL for an internal hidden `<audio>` element

The component SHALL NOT render native browser audio controls.

#### Scenario: Incoming audio message with waveform data

- **WHEN** an `m.audio` message is received that includes `info.waveform` and `info.duration`
- **THEN** the component SHALL render the real waveform shape with 60 bars
- **AND** the total time SHALL display the duration from `info.duration`

#### Scenario: Incoming audio message without waveform data

- **WHEN** an `m.audio` message is received that does NOT include `info.waveform`
- **THEN** the component SHALL render 60 uniform-height placeholder bars
- **AND** the total time SHALL display `0:00` until the audio is loaded

#### Scenario: User presses play

- **WHEN** the user presses the play button
- **THEN** the hidden `<audio>` element SHALL start playback
- **AND** the elapsed time and scrub bar progress SHALL update in real time

#### Scenario: User scrubs to a position

- **WHEN** the user drags the scrub bar
- **THEN** `audio.currentTime` SHALL be set to the corresponding position
- **AND** elapsed time SHALL update immediately

#### Scenario: Playback reaches end

- **WHEN** the audio reaches the end
- **THEN** the play button SHALL reset to the play icon
- **AND** elapsed time SHALL reset to `0:00`

### Requirement: Duration badge before playback

The audio bubble SHALL show the total duration (e.g., `0:32`) when the message is rendered, even before the user presses play.

For sent messages the duration SHALL come from `media.durationSecs` on the local echo or the confirmed event's `info.duration`.

For received messages the duration SHALL come from `info.duration` if present; otherwise the badge SHALL be absent.

#### Scenario: Duration badge on a sent message

- **WHEN** the user sends an audio message
- **THEN** the local echo bubble SHALL display the duration badge immediately

#### Scenario: Duration badge on a received message with duration

- **WHEN** an `m.audio` event is received with `info.duration` present
- **THEN** the bubble SHALL show the formatted duration badge

#### Scenario: Duration badge on a received message without duration

- **WHEN** an `m.audio` event is received without `info.duration`
- **THEN** no duration badge SHALL be shown

### Requirement: Waveform data extraction for voice recordings

When the user sends a **voice recording** (produced by the in-app recorder), the system SHALL:
- Decode the recorded blob with `AudioContext.decodeAudioData`
- Downsample the PCM channel to exactly 60 amplitude values normalised to `[0, 1]`
- Store the values in `info.waveform` (JSON array, non-standard extension)
- Store the duration in `info.duration` (milliseconds, standard Matrix field)

Audio files sent as attachments via the file picker SHALL NOT be decoded. No `AudioContext` call is made for file-picker audio sends; `info.waveform` and `info.duration` are omitted from those events.

If `decodeAudioData` fails for a voice recording (unsupported format), the system SHALL send the event without `info.waveform` and without `info.duration`, and the send SHALL NOT be blocked.

#### Scenario: Voice recording successfully decoded

- **WHEN** the user sends a voice recording
- **THEN** the Matrix event SHALL include `info.waveform` with 60 values and `info.duration` in milliseconds

#### Scenario: Voice recording decode fails

- **WHEN** `decodeAudioData` throws for an unsupported codec
- **THEN** the system SHALL still send the audio event without `info.waveform` and without `info.duration`
- **AND** the send SHALL NOT be blocked

#### Scenario: Audio file attachment — no waveform extraction

- **WHEN** the user attaches an audio file via the file picker and sends it
- **THEN** the system SHALL NOT call `AudioContext.decodeAudioData`
- **AND** the Matrix event SHALL be sent without `info.waveform`

### Requirement: Local echo carries waveform and duration

When a user sends an audio message, the local echo SHALL include `media.waveformData` and `media.durationSecs` so the waveform player renders immediately without waiting for server confirmation.

#### Scenario: Local echo waveform display

- **WHEN** the user sends an audio message
- **THEN** the local echo bubble SHALL display the waveform bars immediately
- **AND** the duration badge SHALL be visible before server confirmation arrives
