# Matrix Client Backend

## Purpose

Specifies the Matrix-backed client implementation in `client/src/lib/services/backends/matrix.ts` and its interaction boundaries with the rest of the client, covering session management, auth, messaging, contacts/DMs, calling, group call presence, and the central event store.

## Requirements

### Requirement: Scope and Ownership

The Matrix backend SHALL own the following capabilities as the sole implementation module.

- Session persistence and Matrix client initialization
- Matrix login against the homeserver, including legacy-email compatibility login through FastAPI
- Matrix registration against the homeserver
- Conversation list and unread count updates
- Message send and history retrieval
- DM/contact creation and invite handling
- Matrix call signal ingestion and active-call tracking
- MatrixRTC-style room membership state for group call presence

#### Scenario: New Matrix capability needed

- **WHEN** a new Matrix-specific client capability is introduced
- **THEN** it SHALL be implemented in `backends/matrix.ts`, not in route handlers or other service modules

### Requirement: Feature Flags

The migration SHALL depend on these client flags for coexistence with the legacy path.

- `FLAGS.USE_MATRIX`: selects `matrix.ts` via `activeBackend.js`
- `FLAGS.MATRIX_CALLS`: enables Matrix P2P calling paths in `callSession.ts`
- `FLAGS.LIVEKIT_GROUP_CALLS`: enables LiveKit-backed group call flow in `callSession.ts`

These flags are runtime selectors and MUST be preserved until removal is explicitly planned.

#### Scenario: Legacy path removal considered

- **WHEN** removal of a feature flag is proposed
- **THEN** it MUST be explicitly planned and documented before the flag is removed

### Requirement: Session Model

The backend SHALL persist and restore Matrix sessions with safe concurrency and deduplication.

Session data is persisted in local storage using:
- `matrix_homeserver`
- `matrix_access_token`
- `matrix_user_id`
- `matrix_device_id`

`init()` restores the stored session, initializes Rust crypto, and starts sync with:
- `initialSyncLimit: 1`
- `lazyLoadMembers: true`

`init()` SHALL be safe to call concurrently. If a second call arrives while the first is still awaiting sync, it receives the same Promise and does not trigger a second `startClient()` call. The sentinel (`_initPromise`) is cleared after the call settles so a fresh call works after logout.

The `onMessage()` live-event handler SHALL deduplicate by `event_id` using an in-module `_processedEventIds` Set. Events already forwarded to subscribers are silently dropped on re-delivery (reconnect, `LIMITED` sync gap, backfill). The Set is capped at 10,000 entries with oldest-first eviction. It is reset on `logout()`.

`sendMessage()` returns a `txnId` string synchronously. The SDK call is fire-and-forget. The `txnId` is passed as the third argument to `_client.sendMessage(roomId, content, txnId)` so the SDK embeds it in `event.getUnsignedData().transaction_id` on the remote echo. `onMessage()` normalizes the event via `normalizeEvent()` and calls `ingestEvent()` before dispatching the `NormalizedEvent` to `fn()` subscribers. Echo reconciliation (txnId match → in-place replace) is handled centrally inside `ingestEvent()` in `matrixStore.js`.

`uploadMedia(file)` uploads a `File` to the Matrix media repository via `_client.uploadContent()` and returns `{ mxcUrl, mimeType, size, filename }`.

`sendMediaMessage(roomId, file, messageType, replyToEventId?)` uploads the file then sends a Matrix message with the appropriate `msgtype` (`m.image`, `m.audio`, `m.video`, `m.file`). Returns a `txnId` string.

`getMediaUrl(mxcUrl)` converts an `mxc://` URI to an authenticated HTTP download URL via `_client.mxcUrlToHttp()`. Returns `null` if the client is not initialised or the URI is falsy.

#### Scenario: Concurrent init calls

- **WHEN** `init()` is called while a previous `init()` is still awaiting sync
- **THEN** the second call SHALL receive the same Promise and SHALL NOT trigger a second `startClient()` call

#### Scenario: Duplicate event received

- **WHEN** an event with an already-processed `event_id` is received (reconnect, sync gap, backfill)
- **THEN** it SHALL be silently dropped without forwarding to subscribers

### Requirement: Auth Capabilities

The backend SHALL support email-based Matrix login, direct Matrix ID login, registration with display name, and session cleanup.

- `login()` has two paths:
  - email input goes through `POST /api/auth/matrix-login`
  - direct Matrix user IDs such as `@user:domain` still use `m.login.password`
- When the API returns `status = "reset_required"`, the backend SHALL throw an error with `code = "reset_required"` so the login page can redirect into the password-reset flow instead of showing a generic auth error.
- `register()` SHALL support the Dendrite dummy UIAA fallback; calls `setDisplayName(username)` fire-and-forget after creating the authenticated client so that member events always carry a human-readable `displayname`. Without this call, all peer-facing name lookups fall back to the raw Matrix ID.
- `logout()` stops the client, clears stores, and clears persisted session data.
- Session persistence stores the homeserver URL used for the authenticated Matrix session so browser reloads restore against the same homeserver.

#### Scenario: Legacy email login with unmigrated user

- **WHEN** `login()` is called with an email and the API returns `status = "reset_required"`
- **THEN** the backend SHALL throw an error with `code = "reset_required"`

#### Scenario: User registers

- **WHEN** `register()` completes successfully
- **THEN** `setDisplayName(username)` SHALL be called so member events carry a human-readable `displayname`

### Requirement: Messaging Capabilities

The backend SHALL derive conversations from Matrix rooms, support message send/history, unread counts, typing indicators, and read receipts.

- Conversations are derived from Matrix rooms sorted by last activity.
- Messages are sent as `m.room.message`.
- History is read from the live timeline after `scrollback()`.
- Unread counts come from room notification counts via `getUnreadCounts(fn)`, which is the **sole writer** to the `unreadCounts` Svelte store in Matrix mode. `+layout.svelte` MUST NOT call `incrementUnread()` for Matrix-mode messages — dual writers using incompatible strategies (incremental vs full-replace) race on every incoming message and cause badge flicker or silent zeroing (CR-4, SR-1).
- `sendTyping(roomId, isTyping)` sends an `m.typing` notification with a 4-second expiry when `isTyping=true`; errors are swallowed (non-critical).
- `onTypingChanged(roomId, fn)` listens to `RoomMember.typing` SDK events filtered to the given room, skips the local user's own events, and returns an unsubscribe function.
- `sendReadReceipt(roomId)` sends `m.read` for the last event in the live timeline; called on room mount and when incoming messages arrive; errors are swallowed.
- `getPeerReadTs(roomId)` returns the highest read-up-to timestamp (ms) across all non-self joined members, derived from `room.getEventReadUpTo()` and `room.findEventById()`; used for initial tick render.
- `onReadReceiptChanged(roomId, fn)` listens to `Room.receipt` SDK events filtered to the given room, calls `fn(ts)` with the updated peer read timestamp, and returns an unsubscribe function.

#### Scenario: Unread count writer conflict

- **WHEN** `+layout.svelte` processes a Matrix-mode message
- **THEN** it MUST NOT call `incrementUnread()`; `getUnreadCounts(fn)` SHALL be the sole writer to the `unreadCounts` store

#### Scenario: Upload rejected for oversized file

- **WHEN** `sendMediaMessage()` is called with a file exceeding the per-type limit
- **THEN** it SHALL throw an error before making any network request, with a message stating the limit and suggesting a sharing link

#### Scenario: Media fetched from cache

- **WHEN** `fetchCachedMedia(mxcUrl, httpUrl)` is called for an mxc URI present in the IndexedDB cache
- **THEN** it SHALL return a blob URL from cache and update the `accessedAt` timestamp without a network request

### Requirement: Upload Size Validation

`sendMediaMessage()` SHALL enforce per-type upload limits before calling `uploadContent()`.

- Limits are defined in `MEDIA_SIZE_LIMITS` in `matrix/messaging.js`
- If `file.size > limit`, throw with message: `"File too large (max N MB). For larger files, share a link from a cloud storage service."`
- No local echo is added; no network request is made

### Requirement: Media Cache

A `mediaCache.js` service SHALL provide a `fetchCachedMedia(mxcUrl, httpUrl)` async function with IndexedDB-backed LRU caching.

- Cache max size: 100 MB; eviction target: 80 MB (LRU by `accessedAt`)
- Returns blob URL on hit or after fetching and caching on miss
- Returns `null` on 404 (expired/purged media)
- Falls back to `httpUrl` on non-404 server errors or if IndexedDB is unavailable
- Used by `AudioPlayer` for cache-first audio loading and by image `Download` buttons

### Requirement: Contacts and DM Handling

The backend SHALL manage DM contacts, contact requests, bootstrap from legacy, and mutual visibility.

- `addContact(input)` normalises bare usernames to full Matrix IDs via `_normaliseUserId()` (e.g. `"alice"` → `"@alice:domain"`) then creates a direct room and updates `m.direct` account data immediately so the SDK in-memory state is consistent before the next sync.
- `init()` runs a one-time accepted-contact bootstrap after initial sync:
  - fetches `GET /api/matrix/bootstrap/contacts` with the live Matrix access token
  - compares the returned peers to existing joined or invited DM rooms
  - calls `addContact()` only for missing peers
- The bootstrap flow migrates accepted legacy contacts into Matrix DMs incrementally. It does not recreate pending requests, invited-email placeholders, legacy room memberships, or message history.
- `getDMContacts()` returns contact-shaped objects with these fields:
  - `email` — peer's Matrix user ID (used for call routing)
  - `roomId` — Matrix room ID (used for chat navigation to `/room/[roomId]`)
  - `display_name` — peer's display name from their member event; falls back to `userId` then `room.name`
  - `status` — `'pending'` when the peer's membership is still `'invite'`; `'accepted'` once joined
- `getContactRequests()` returns pending DM invites for the current user (rooms where `getMyMembership() === 'invite'` and `is_direct` is set). Each object has `email = roomId` and `roomId` (both the Matrix room ID) for use with `acceptContact` / `rejectContact`.
- `acceptContact(roomId)` joins the room; `rejectContact(roomId)` leaves it.
- `getRoomPeer(roomId)` returns `{ name, userId }` for the peer in a DM room, or `{ name, userId: null }` for group rooms. Used by `room/[id]/+page.svelte` to populate the chat header without calling the legacy `/rooms` API.
- `onConversationsChanged(fn)` emits only `join`-state rooms. Invite-state rooms are excluded from the conversation list and handled as contact requests. Subscribes to `Room.timeline`, `Room`, and `RoomMember.membership` — the last is required to catch live invite arrivals. If called before `init()` completes, the listener is queued in `_pendingConversationListeners` and flushed after first sync. The flush atomically snapshots and clears the pending array before registering SDK listeners — if `unsubscribe()` fires during the flush callback, it correctly falls through to `_client.off()` rather than silently failing (CR-5).

#### Scenario: Contact added with bare username

- **WHEN** `addContact("alice")` is called
- **THEN** the input SHALL be normalised to `"@alice:domain"` via `_normaliseUserId()`, a direct room created, and `m.direct` updated immediately

#### Scenario: Conversations listener registered before init

- **WHEN** `onConversationsChanged(fn)` is called before `init()` completes
- **THEN** the listener SHALL be queued in `_pendingConversationListeners` and flushed after first sync

### Requirement: DM Detection Rules

A joined room SHALL be treated as a DM contact if any of the following holds.

1. The room ID appears in the user's `m.direct` account data.
2. The current user's own member event content has `is_direct: true` (invitee path).
3. Any other member's state event has `is_direct: true` (creator path — the SDK sets this on the invited member's event, not the creator's own).

`is_direct` SHALL always be read via `room.currentState.getStateEvents('m.room.member', userId)?.getContent()` — not via `RoomMember.events.member`, which is unreliable for stripped invite state.

#### Scenario: DM detection for invite-state room

- **WHEN** a room is received as an invite (stripped state)
- **THEN** `is_direct` SHALL be read via `currentState.getStateEvents()`, not via `RoomMember.events.member`

### Requirement: Call Capabilities

The backend SHALL support Matrix call creation and hybrid signal detection.

- `createMatrixCall(roomId)` creates and stores the active Matrix call object.
- `onCallSignal()` uses a hybrid listener model:
  - direct `Room.timeline` handling for immediate `m.call.invite` detection
  - `Call.incoming` handling for fully initialized `MatrixCall` objects
- `notify()` currently normalizes incoming call invites into the shared call store.

#### Scenario: Incoming call detected

- **WHEN** an `m.call.invite` event arrives on the room timeline
- **THEN** it SHALL be detected immediately via the `Room.timeline` handler, and the fully initialized `MatrixCall` object SHALL be handled via `Call.incoming`

### Requirement: Group Call Presence

The backend SHALL publish and remove MatrixRTC call member state events.

- `setCallMember()` and `clearCallMember()` publish and remove `org.matrix.msc3401.call.member` state events for room membership signaling.
- `getAccessToken()` exposes the live SDK access token for other modules that need to authenticate against backend services on behalf of the logged-in Matrix user.

#### Scenario: User joins group call

- **WHEN** a user joins a group call
- **THEN** `setCallMember()` SHALL publish an `org.matrix.msc3401.call.member` state event

### Requirement: Service Boundary Guardrails

Access token reads SHALL go through the module boundary, not direct localStorage.

- NEVER read `matrix_access_token` directly from localStorage outside of `matrix.ts`. The SDK can update its internal token (e.g. via token refresh) without re-calling `saveSession()`, making the localStorage value stale. Always call `getAccessToken()` through the module boundary.
- Other modules that need the current access token MUST import `getAccessToken()` from `backends/matrix.ts`, not read storage keys directly.

#### Scenario: External module needs access token

- **WHEN** a module outside `matrix.ts` needs the current Matrix access token
- **THEN** it MUST call `getAccessToken()` from `backends/matrix.ts`, not read `matrix_access_token` from localStorage

### Requirement: Matrix SDK Guardrails

SDK usage SHALL follow these safety rules.

- Create clients through `sdk.createClient(...)`; do not instantiate ad-hoc parallel client wrappers.
- Call `startClient()` only after the client is configured and listeners for the intended flow are ready.
- Initialize encryption with `initRustCrypto()` before relying on encrypted Matrix features.
- Do not create multiple `MatrixClient` instances against the same browser crypto store; the SDK warns this causes data corruption and decryption failures.
- Treat SDK objects as event emitters and subscribe through the documented event model rather than polling.
- When listening to room timelines, filter out backfilled history using the `toStartOfTimeline` signal where appropriate.
- Treat `createCall()`/call creation as potentially unsupported and guard null or failed call creation paths.
- If future work adds Matrix media rendering, assume authenticated media may require attaching authorization headers rather than relying on anonymous media URLs.
- **Always call `setDisplayName()` on registration.** The SDK does not auto-populate profile display names.
- **Read member event content via `currentState.getStateEvents()`, never via `RoomMember.events.member`.** For rooms received as invites (stripped state), `RoomMember.events.member` is not reliably populated.
- **Never reuse a single field for both peer identity and room routing in Matrix mode.** Contact objects MUST carry `email` (peer's Matrix user ID, for calls) and `roomId` (room ID, for navigation) as separate fields.
- **`onConversationsChanged` MUST subscribe to `RoomMember.membership`.** `Room` and `Room.timeline` events do not reliably fire for incoming invites.

#### Scenario: New Matrix client created

- **WHEN** a new `MatrixClient` is needed
- **THEN** it SHALL be created through `sdk.createClient(...)` and SHALL NOT share a browser crypto store with another instance

### Requirement: Central Event Store (`matrixStore.js`)

All Matrix message events SHALL flow through a central store. Components MUST NOT maintain their own message arrays in Matrix mode.

#### NormalizedEvent shape

```
{ id, roomId, senderId, senderName, type, body, media, ts, isoTs, mine, txnId, replyTo }
```

- `type` — `'text' | 'image' | 'audio' | 'video' | 'file' | 'system'`
- `body` — message text for `text` type; descriptive string for `system` events (e.g. "Alice joined")
- `media` — `{ mxcUrl, mimeType, size, filename, thumbnailUrl }` for media types, `null` otherwise
- `ts` — Unix-ms timestamp (from `ev.getTs()`)
- `isoTs` — ISO 8601 string (from `new Date(ts).toISOString()`)
- `txnId` — present for own-device sends, `null` otherwise
- `replyTo` — `{ eventId, body, senderName }` or `null`

State events (`m.room.member`, `m.room.name`, etc.) are normalized as `type: 'system'` with a human-readable `body`.

Call events (`m.call.invite`, `m.call.hangup`) are normalized as `type: 'call'` with a `callMeta` field when a `call_id` is present. Call events without `call_id` fall back to `type: 'system'`. `callMeta` shape: `{ direction: 'incoming'|'outgoing', status: 'answered'|'missed'|'ringing', durationSecs: number|null }`. `readTimeline()` pairs invites and hangups by `call_id`, suppressing the invite when a matching hangup exists and using the hangup as the canonical call log entry. Any invite with a matching hangup is treated as `status: 'answered'`, with `durationSecs` derived from the event timestamp delta. Invites without a matching hangup have `status: 'ringing'`.

#### Ingestion pipeline

1. `normalizeEvent(ev, myUserId, room)` — maps a MatrixEvent SDK object to NormalizedEvent. This is the single source of truth for event shape; `_mapEvent()` and `_extractReplyTo()` have been removed.
2. `ingestEvent(roomId, event)` — deduplicates by `event.id`; if `event.txnId` matches a pending local echo, replaces it in-place (echo reconciliation); otherwise appends to the room timeline.
3. `prependEvents(roomId, events)` — prepends an oldest-first batch (used by `getHistory()` and `loadMoreHistory()` for pagination).
4. `addLocalEcho(roomId, localEcho)` — adds an optimistic send with `_isLocalEcho: true`; replaced by `ingestEvent()` on confirmed remote arrival.

#### Derived stores

- `messagesFor(roomId)` — ordered message list (oldest-first) including local echoes.
- `lastMessageFor(roomId)` — body of the most recent confirmed (non-echo) message.

#### Lifecycle

`resetStore()` is called by `logout()` and `destroy()` to clear all in-memory event state between sessions.

#### Scenario: Component displays messages

- **WHEN** a component needs to display messages for a room in Matrix mode
- **THEN** it SHALL subscribe to `$messagesFor(roomId)` from `matrixStore.js` and SHALL NOT maintain its own message array

#### Scenario: Local echo reconciliation

- **WHEN** a remote echo arrives with a `txnId` matching a pending local echo
- **THEN** `ingestEvent()` SHALL replace the local echo in-place

### Requirement: Component Contract

Room page components SHALL use the central store for message display and send.

- `room/[id]/+page.svelte` subscribes to `$messagesFor(roomId)` instead of maintaining a local `messages` array in Matrix mode.
- `handleSend()` calls `addLocalEcho()` in Matrix mode; `ingestEvent()` (triggered by the remote echo arriving via `onMessage`) replaces it in-place.
- `loadMore()` calls `backend.loadMoreHistory()` which populates the store via `prependEvents()`. The component does not re-populate `messages` manually; it just restores scroll position after `tick()`.

#### Scenario: User sends a message

- **WHEN** `handleSend()` is called in Matrix mode
- **THEN** `addLocalEcho()` SHALL be called, and the remote echo arriving via `onMessage` SHALL trigger `ingestEvent()` to replace it

### Requirement: Coupling Constraints

Changes to Matrix calling MUST review both `matrix.ts` and `callSession.ts` together.

- `activeBackend.js` selects the Matrix backend for most application flows.
- `callSession.ts` still imports Matrix call helpers directly from `backends/matrix.ts` for the Matrix calling path.

#### Scenario: Matrix calling behavior modified

- **WHEN** Matrix calling behavior is changed
- **THEN** both `backends/matrix.ts` and `callSession.ts` MUST be reviewed together

### Requirement: Known Stability Notes

Certain capabilities SHALL be treated as less stable than core flows.

- Presence support exists but SHALL be treated as less stable than auth, messaging, and DM flows.
- Matrix calling is implemented but remains an active stabilization area; archived investigation material lives under `openspec/changes/archive/`.
- Contact display names depend on peers having called `setDisplayName()` at registration. The reset-first migration path now sets a profile display name while reconciling legacy accounts, so migrated legacy users do not rely on a future re-registration to show a readable name.

#### Scenario: Presence feature relied upon

- **WHEN** a feature depends on presence data
- **THEN** it SHALL be treated as less stable than auth, messaging, and DM flows

### Requirement: Background Timestamp Tracking

The Matrix client backend SHALL export a `handleHide()` function that records the current timestamp when called. This timestamp is used by `reconnectIfNeeded()` to determine how long the app was backgrounded.

#### Scenario: handleHide called on page hide

- **WHEN** `handleHide()` is called
- **THEN** an internal `_backgroundedAt` timestamp SHALL be set to `Date.now()`

### Requirement: Forced Sync Restart After Long Background

`reconnectIfNeeded()` SHALL force-restart the Matrix sync loop (via `stopClient()` + `startClient()`) when the sync state is `SYNCING` AND the app was backgrounded for >= 30 seconds. It SHALL continue to restart on `STOPPED`, `ERROR`, or `null` states as before.

- The restart threshold SHALL be 30000ms (30 seconds).
- Force-restart MUST call `stopClient()` before `startClient()` to cleanly terminate the frozen XHR.
- After a forced restart, `_backgroundedAt` SHALL be reset to `null`.

#### Scenario: Stuck SYNCING after long background

- **WHEN** `reconnectIfNeeded()` is called AND sync state is `SYNCING` AND elapsed time since `handleHide()` >= 30s
- **THEN** `stopClient()` SHALL be called followed by `startClient()` with the same options as initial start

#### Scenario: Fresh SYNCING after short background

- **WHEN** `reconnectIfNeeded()` is called AND sync state is `SYNCING` AND elapsed time since `handleHide()` < 30s
- **THEN** `stopClient()` SHALL NOT be called and the sync loop SHALL continue undisturbed

#### Scenario: Dead sync loop on return

- **WHEN** `reconnectIfNeeded()` is called AND sync state is `STOPPED`, `ERROR`, or `null`
- **THEN** `startClient()` SHALL be called to restart the sync loop (existing behavior)

### Requirement: Spec Update Policy

This document MUST be updated whenever backend exports, session keys, feature-flag meaning, DM detection rules, or Matrix signaling behavior change.

#### Scenario: Backend export changed

- **WHEN** a backend export, session key, feature-flag meaning, DM detection rule, or Matrix signaling behavior changes
- **THEN** this spec MUST be updated in the same change
