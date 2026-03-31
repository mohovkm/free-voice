# Call State Machine

## Purpose

Defines the authoritative state-machine contract for `client/src/lib/services/callSession.ts`, including phases, end reasons, transitions, store fields, and LiveKit cleanup guardrails.

## Requirements

### Requirement: Call Phases

The call session SHALL support exactly the following phases:

| Phase | Description |
| --- | --- |
| `idle` | No call is active. |
| `acquiring_media` | Local media acquisition is running. |
| `registering` | Registration or backend join setup is in progress. |
| `ringing_out` | Caller is waiting for answer. |
| `ringing_in` | Callee has an incoming call waiting for action. |
| `connecting` | Call setup is progressing after answer or room join. |
| `connected` | Media is active. |
| `reconnecting` | Transport or ICE recovery is in progress. |
| `ended` | The call has terminated and an end-reason screen is shown briefly. |

#### Scenario: Initiating a call

- **WHEN** `dial()` is invoked from the `idle` phase
- **THEN** the phase SHALL transition to `acquiring_media`

#### Scenario: Answering an incoming call

- **WHEN** `answer()` is invoked from the `ringing_in` phase
- **THEN** the phase SHALL transition to `acquiring_media` then proceed through `registering` to `connecting`

### Requirement: End Reasons

The call session SHALL use exactly the following end reasons:

| Reason | Meaning |
| --- | --- |
| `hangup` | Local hangup completed. |
| `remote_hangup` | Remote party ended the call. |
| `declined` | The callee declined. |
| `busy` | The target is already busy. |
| `no_answer` | The ring timer expired. |
| `cancelled` | The caller cancelled before answer. |
| `answered_elsewhere` | Another device answered. |
| `network_error` | Recovery failed after a connection problem. |
| `error` | An unrecoverable call setup or runtime failure occurred. |

#### Scenario: Remote party hangs up

- **WHEN** the remote party ends the call during `connected` phase
- **THEN** the end reason SHALL be set to `remote_hangup` and the phase SHALL transition to `ended`

### Requirement: Transition Rules

The call session SHALL enforce the following transition rules and MUST NOT allow transitions not listed here:

- `idle -> acquiring_media` on `dial()` or `answer()`.
- `acquiring_media -> registering` when required local media is ready.
- `registering -> ringing_out` when the caller has sent the initial invite.
- `registering -> connecting` when the callee or room join path is established.
- `ringing_out -> connected` when answer succeeds.
- `ringing_in -> connecting` when the local user answers.
- `connected -> reconnecting` only for transport or ICE recovery paths.
- `ended -> idle` only after the end-screen timeout finishes.

#### Scenario: Attempting an invalid transition

- **WHEN** code attempts to transition from `idle` directly to `connected`
- **THEN** the transition MUST be rejected because it is not in the allowed transition list

#### Scenario: Reconnection during active call

- **WHEN** a transport or ICE failure occurs during the `connected` phase
- **THEN** the phase SHALL transition to `reconnecting` and recovery SHALL be attempted

### Requirement: Store Contract

The call store MUST expose the following fields:

- `phase`
- `endReason`
- `micMuted`
- `camOff`
- `video`
- `remoteName`
- `roomName`
- `mode`

Any change to these fields or to the allowed transitions MUST include a matching update to this document.

#### Scenario: UI reads call state

- **WHEN** a UI component subscribes to the call store
- **THEN** all listed fields SHALL be available and reflect the current call session state

### Requirement: LiveKit Cleanup Guardrails

`_cleanupLivekit()` MUST call `removeAllListeners()` on the Room object before calling `disconnect()`. The `RoomEvent.Disconnected` event fires asynchronously after disconnect; if listeners are still attached and the phase has already advanced (e.g. a rejoin started), the stale handler will call `_end()` against the new session.

`joinRoom()` SHALL guard on `_phase() !== 'idle'`. The full cleanup-and-reset cycle (`_cleanupSip()` → `_reset()`) MUST complete before a rejoin is attempted. The 2.5 s `_endTimer` in `_end()` provides this window; it MUST NOT be shortened below the time required for `disconnect()` to propagate.

#### Scenario: Cleaning up LiveKit before rejoin

- **WHEN** a LiveKit room is being cleaned up and a rejoin is pending
- **THEN** `removeAllListeners()` MUST be called before `disconnect()`, and the rejoin MUST NOT begin until the phase has returned to `idle`

#### Scenario: End timer duration

- **WHEN** `_end()` sets the `_endTimer`
- **THEN** the timer MUST be at least 2.5 s to allow `disconnect()` propagation before a rejoin can proceed

### Requirement: Media Element Wiring

`setMediaElements(remoteAudio, remoteVideo, localVideo)` MUST be called before `_startLivekit()` runs so that `TrackSubscribed` events have valid DOM elements to attach to.

- Call pages (`dial`, `incoming`) MUST call `setMediaElements` in their `onMount` using `await tick()` to ensure the `CallView` component reference is bound before reading its media elements.
- `setMediaElements` MUST re-attach any already-subscribed remote tracks when called, to handle the race where `TrackSubscribed` fires before the elements are wired.

#### Scenario: TrackSubscribed before setMediaElements

- **WHEN** remote tracks arrive via `TrackSubscribed` before `setMediaElements` has been called
- **THEN** `setMediaElements` SHALL re-attach all currently subscribed remote tracks when it is subsequently called

### Requirement: iOS Safari Gesture Context for Media Acquisition

On iOS Safari, `getUserMedia` (called internally by `enableCameraAndMicrophone`) requires an active user gesture context. Any `await` on a network call before `getUserMedia` loses this context.

- `_startLivekit` MUST call `enableCameraAndMicrophone()` in parallel with `_getLivekitToken()` and `room.connect()` so that `getUserMedia` fires immediately within the gesture chain.
- `room.startAudio()` MUST be called after connect to unblock iOS Safari audio playback.

#### Scenario: Answering a call on iOS Safari

- **WHEN** the user taps the answer button on iOS Safari
- **THEN** `enableCameraAndMicrophone()` SHALL be called immediately (before any network round-trip) to preserve the gesture context

### Requirement: Hangup Signaling

For P2P calls, `hangup()` MUST send `m.call.hangup` via Matrix in addition to disconnecting LiveKit. This ensures the remote party is notified even if the LiveKit disconnect event does not propagate (e.g. iOS background kill).

- `onCallSignal` MUST listen for `m.call.hangup` events and fire `call_ended` to the callback.
- `_pendingCallId` MUST be stored from incoming `call_invite` so the answerer can also send `m.call.hangup`.

### Requirement: LiveKit transport reconnect events drive phase transitions

LiveKit `RoomEvent.Reconnecting` and `RoomEvent.Reconnected` events SHALL drive call phase transitions and audio resumption.

- On `RoomEvent.Reconnecting`: the phase SHALL transition to `reconnecting` (from `connected`).
- On `RoomEvent.Reconnected`: the phase SHALL transition back to `connected`, and `room.startAudio()` SHALL be called to unblock iOS Safari audio playback after the transport recovers.
- These event handlers MUST be registered in `_startLivekit()` alongside other RoomEvent listeners and MUST be removed by `_cleanupLivekit()`.

#### Scenario: Transport reconnection starts during active call
- **WHEN** `RoomEvent.Reconnecting` fires while the phase is `connected`
- **THEN** the phase SHALL transition to `reconnecting`

#### Scenario: Transport reconnection succeeds
- **WHEN** `RoomEvent.Reconnected` fires after a `reconnecting` phase
- **THEN** the phase SHALL transition to `connected` and `room.startAudio()` SHALL be called

### Requirement: Audio context restored on app foreground during active call

While a call is active (`phase === 'connected'` or `phase === 'reconnecting'`), returning the app to the foreground SHALL resume the iOS Safari audio context.

- A `visibilitychange` handler SHALL be registered when the call enters the `connected` phase and SHALL call `room.startAudio()` when `document.visibilityState === 'visible'`.
- The handler MUST be removed when the call ends (i.e. in `_cleanupLivekit()` or at `ended` phase transition).
- `resumeAudio()` is the internal helper that wraps the visibility check and `room.startAudio()` call.

#### Scenario: App returns to foreground during active call
- **WHEN** `document.visibilityState` transitions to `'visible'` while `phase` is `connected` or `reconnecting`
- **THEN** `resumeAudio()` SHALL call `room.startAudio()` to restore the iOS audio context

#### Scenario: Visibility handler removed on call end
- **WHEN** the call transitions to `ended`
- **THEN** the `visibilitychange` listener SHALL be removed and `room.startAudio()` SHALL NOT be called by it after teardown

### Requirement: Incoming Call from Push Notification

When the app opens from a push notification — cold start or warm foreground return — the `m.call.invite` may not be in the SDK timeline due to `initialSyncLimit: 1` or a post-background Matrix client restart. IndexedDB polling is the authoritative detection path; Matrix timeline events are a secondary live path only.

**Why polling, not events:** On iOS Safari PWA, `visibilitychange`, `pageshow`, and `ServiceWorkerClient.postMessage` are all unreliable when the app is restored from the background via a notification tap. IDB polling every second is the industry-recommended pattern: the SW writes unconditionally on push arrival, and the UI reads until it detects the record or the window expires.

- The service worker MUST store call push data (`room_id`, `from`, `video`, `ts`) in IndexedDB `fv-push/call/pending` when a call push arrives, before the notification is shown.
- The push API MUST include `room_id` and `video` in the call push payload.
- The layout MUST start a 1-second polling loop against `fv-push/call/pending` **before** `backend.init()` so cold-start detection does not wait for the full Matrix sync (~30s on a fresh device).
- The poll MUST restart with a fresh 2-minute window on `visibilitychange:visible` and `pageshow(persisted=true)`.
- Each IDB read MUST be a readonly peek wrapped in an 800ms timeout guard; deletion MUST happen separately after the record is confirmed for handling, to prevent the record being silently lost if WebKit stalls the IDB operation past the timeout.
- Deduplication MUST be enforced via a `Set` keyed on `room_id:ts` so the same record is not handled twice across poll ticks.
- The watchdog reload (`reconnectOrReload`) MUST be suppressed while the poll interval is active, to prevent a race where the watchdog reloads the page before the poll detects the call.
- Navigation MUST be skipped if the current path already starts with `/call/incoming`.
- The SW `notificationclick` handler MUST focus the existing PWA window (via `clients.matchAll` + `focus()`) if one exists, and fall back to `openWindow` otherwise. No postMessage is required.
- `onCallSignal` MUST subscribe to the Matrix SDK `'sync'` event and re-run `checkPendingInvites()` on `PREPARED` state as a secondary path for the live-timeline case.

#### Scenario: App opened from call push (cold start)

- **WHEN** the user taps a call push notification and the app cold-starts
- **THEN** the incoming call layout SHALL be shown within 1–2s of the poll detecting the IDB record, without requiring the `m.call.invite` event to be in the SDK timeline

#### Scenario: App opened from call push (warm start — app was backgrounded)

- **WHEN** the user taps a call push notification and the app was already running in the background
- **AND** the app has been backgrounded for ≥ `FREEZE_THRESHOLD_MS` (5s), causing a Matrix client restart on foreground return
- **THEN** the incoming call layout SHALL be shown via the IDB polling loop within 1s of the app resuming
- **AND** the call SHALL NOT be signalled twice (deduplication via `Set`)

#### Scenario: IDB stalls on WebKit resume

- **WHEN** the first IDB read after resume takes longer than 800ms (WebKit post-resume stall)
- **THEN** that poll tick SHALL return null and the loop SHALL retry on the next 1s tick without losing the record
