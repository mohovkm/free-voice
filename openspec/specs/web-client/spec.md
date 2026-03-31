# Web Client

## Purpose

Specifies the SvelteKit SPA browser client under `client/src/` that owns authentication, navigation, conversation UI, call lifecycle orchestration, local persistence, crypto helpers, and push integration across legacy and Matrix backends.

## Requirements

### Requirement: Runtime Structure

The client SHALL be organized as a SvelteKit SPA with defined route groups and shared service layers.

- Framework: SvelteKit SPA
- Main route groups: `routes/(auth)/` and `routes/(app)/`
- Auth routes currently include login, register, verify, forgot-password, and reset-password flows
- Shared services: `lib/services/`
- Shared stores: `lib/stores/`
- Shared components: `lib/components/`

#### Scenario: New shared logic added

- **WHEN** new shared logic is introduced
- **THEN** it SHALL be placed in `lib/services/`, `lib/stores/`, or `lib/components/` as appropriate, not embedded in route handlers

### Requirement: Feature Flags and Backend Selection

Feature flags SHALL be hardcoded to Matrix-only mode. The legacy backend has been deleted.

- `FLAGS.USE_MATRIX = true`
- `FLAGS.MATRIX_CALLS = true`
- `FLAGS.LIVEKIT_GROUP_CALLS = true`

The legacy backend (`backends/legacy.js`) has been deleted (task 9.2). `activeBackend.js` exports `matrix.ts` directly.

- `lib/services/backend.js` and `lib/services/activeBackend.js` choose the active communication backend.
- `lib/services/backends/matrix.ts` owns Matrix-specific client behavior.
- `lib/services/callSession.ts` owns all call lifecycle logic and MUST remain the single state-machine owner.
- `lib/services/api.js` and `lib/services/voipApi.js` own HTTP access patterns.

#### Scenario: Call lifecycle logic needed

- **WHEN** call lifecycle behavior is modified
- **THEN** changes SHALL be made in `lib/services/callSession.ts`, which MUST remain the single state-machine owner

### Requirement: Route and State Rules

Route handlers SHALL delegate business logic to services and stores.

- Route handlers and pages may request actions from services but SHALL NOT embed cross-page business logic.
- Shared UI state belongs in the `lib/stores/` layer.
- Call behavior MUST follow the [call-state-machine spec](../call-state-machine/spec.md).
- Navigation-triggered call flows MUST tolerate both SPA navigation and full reload entry points.

#### Scenario: Cross-page state needed

- **WHEN** UI state must be shared across pages
- **THEN** it SHALL be placed in `lib/stores/`, not duplicated in route handlers

### Requirement: Route Ownership by Mode

Routes SHALL follow Matrix-mode conventions where all conversations navigate to `/room/[id]`.

- **Legacy mode**: DM conversations navigate to `/chat/[email]`; group rooms navigate to `/room/[id]` (integer ID).
- **Matrix mode**: ALL conversations — including DMs — navigate to `/room/[id]` where `id` is the Matrix room ID (e.g. `!abc:server`). The `/chat/[email]` route is never linked to in Matrix mode.
- Any new messaging or chat UX feature (typing indicators, read receipts, message reactions) MUST be implemented in `routes/(app)/room/[id]/+page.svelte` to take effect in Matrix mode. Adding it only to `routes/(app)/chat/[email]/+page.svelte` will have no effect for Matrix users.

#### Scenario: New messaging feature added

- **WHEN** a new messaging or chat UX feature is implemented
- **THEN** it MUST be implemented in `routes/(app)/room/[id]/+page.svelte` to take effect in Matrix mode

### Requirement: Contact Object Shape (Matrix Mode)

Contact objects SHALL carry separate fields for peer identity and room routing.

Contact objects returned by `getDMContacts()` in Matrix mode carry:

| field | value | used for |
|---|---|---|
| `email` | peer's Matrix user ID (`@user:domain`) | subtitle display; call dial URL |
| `roomId` | Matrix room ID (`!room:domain`) | chat navigation (`/room/[roomId]`); accept/reject |
| `display_name` | peer's display name from member event | name display |
| `status` | `'pending'` or `'accepted'` | hiding call buttons and disabling room composition for unaccepted contacts |

Contact request objects from `getContactRequests()` use `email = roomId` (both are the Matrix room ID) because accept/reject operates on the room.

A single field SHALL NOT be used for both peer identity and room routing. The Matrix user ID and room ID are always different values and serve different purposes.

#### Scenario: Contact object constructed

- **WHEN** a contact object is constructed in Matrix mode
- **THEN** it SHALL have separate `email` (peer Matrix user ID) and `roomId` (Matrix room ID) fields

#### Scenario: Pending contact room actions suppressed

- **WHEN** a Matrix DM contact remains in `status: 'pending'`
- **THEN** the room view SHALL hide call actions, disable message sending controls, and show the non-contact notice until the contact is accepted

### Requirement: Compatibility Rules

The client SHALL preserve compatibility paths and update specs on contract changes.

- The mixed backend period is intentional. Compatibility paths SHALL NOT be removed unless that removal is explicitly scoped and documented.
- Any change to user-visible route behavior, backend selection rules, signaling behavior, or state-store contracts MUST update this spec.
- Matrix-specific behavior MUST also update [matrix-client-backend.md](matrix-client-backend.md).
- In Matrix mode, email remains the primary human-facing sign-in identifier. Legacy users without a Matrix mapping are redirected into password reset before Matrix login is allowed.
- UI, PWA, and component decisions MUST also follow the [frontend-guardrails spec](../frontend-guardrails/spec.md).
- Testing expectations MUST also follow the [testing-and-dod spec](../testing-and-dod/spec.md).

#### Scenario: Route behavior changed

- **WHEN** user-visible route behavior, backend selection, signaling, or state-store contracts change
- **THEN** this spec MUST be updated in the same change

### Requirement: Immersive Room And Call Routes

Mobile room and call surfaces SHALL use the full vertical viewport without the global bottom navigation consuming composer space.

#### Scenario: Room or call route active on mobile

- **WHEN** the active route is `/room/[id]` or any `/call/...` route
- **THEN** the global `BottomNav` SHALL be hidden for that route
- **THEN** the room or call surface SHALL own the bottom edge for its composer or call controls

### Requirement: Unread Count Architecture (Matrix Mode)

The `unreadCounts` store SHALL be the single source of truth for all badge displays.

- `unreadCounts` store (in `lib/stores/unread.js`) is the single source of truth for all badge displays — per-room badges in the chats list and the global sidebar/BottomNav total.
- In Matrix mode `loadUnread()` SHALL be called once from `+layout.svelte` after `backend.init()` completes. This sets up a `getUnreadCounts` subscription that keeps the store in sync with the SDK's server-reported counts.
- Per-room badges in the chats list SHALL use `$unreadCounts[room.roomId]`, NOT `room.getUnreadNotificationCount('total')` (the latter cannot be cleared client-side without a server round-trip).
- `clearUnread(roomId)` SHALL be called reactively from the layout whenever `$page.params.id` changes; this provides immediate badge-clear on room navigation.

#### Scenario: User navigates to a room

- **WHEN** `$page.params.id` changes due to room navigation
- **THEN** `clearUnread(roomId)` SHALL be called reactively to provide immediate badge-clear

### Requirement: Matrix DM Mutual Visibility

Both parties in a DM MUST write `m.direct` account data for the room to appear in both contact lists.

- **Inviter** (`addContact`): writes `m.direct` immediately after `createRoom`.
- **Acceptee** (`acceptContact`): writes `m.direct` after confirming join via `RoomMember.membership` event, using peer ID from `_getPeerMember` or from the sender of the acceptee's own member state event as fallback.

Failing to write on the acceptee side silently hides the contact from their contacts list even though the room is joined and chat works.

#### Scenario: Contact accepted

- **WHEN** a user accepts a contact invite
- **THEN** the acceptee MUST write `m.direct` account data after confirming join, so the room appears in both parties' contact lists

### Requirement: Matrix DM rejection and re-invite consistency

Matrix direct-message contact flows SHALL treat a rejected or stale DM room as distinct from an accepted contact relationship.

#### Scenario: Stale direct room does not appear as an accepted contact

- **WHEN** a prior DM room still exists in client state or `m.direct`, but the room no longer represents an active mutual contact relationship after a rejection or similar lifecycle break
- **THEN** the contacts view SHALL NOT surface that room as an accepted contact row
- **THEN** client contact-state decisions SHALL treat that room as stale until a valid pending or accepted relationship is established again

#### Scenario: Re-invite creates a fresh pending request

- **WHEN** the inviter sends a new direct-contact request after the previous request was rejected and no active accepted contact relationship remains
- **THEN** the client SHALL create or expose a fresh pending request instead of short-circuiting on stale direct-room metadata
- **THEN** the recipient contacts view SHALL show accept and reject controls for that pending request until the invite is accepted
- **THEN** the pending request SHALL become visible without requiring a full page reload when the contacts view is already open

### Requirement: Service Worker Cache Clearing

`clearCache()` MUST unregister the service worker before deleting caches.

- `clearCache()` in settings MUST **unregister** the SW (via `navigator.serviceWorker.getRegistrations()` + `reg.unregister()`) before deleting caches and reloading. Using `reg.update()` leaves the old SW active for the current page; if caches are deleted first, the old SW intercepts `/_app/` requests, finds empty cache, and network-fetches stale content-hashed URLs that no longer exist on the server — producing unhandled SW rejections.
- The SW `/_app/` fetch handler MUST always catch network errors and return a 404 response rather than propagating a rejection.
- The SW navigation fetch handler MUST apply a 4-second network timeout. If the network fetch does not complete within 4 seconds, the handler SHALL fall back to the cached `index.html` (cache-first fallback). If no cached `index.html` is available, the handler SHALL return a synthetic error response (status 503) rather than hanging indefinitely.

#### Scenario: User clears cache from settings

- **WHEN** the user triggers `clearCache()` from settings
- **THEN** the service worker SHALL be unregistered before caches are deleted and the page is reloaded

#### Scenario: Navigation fetch — network hangs beyond 4s
- **WHEN** the SW navigation fetch handler issues a network request and the response does not arrive within 4 000 ms
- **THEN** the fetch race SHALL time out and the handler SHALL serve `index.html` from cache instead

#### Scenario: Navigation timeout with cached index.html
- **WHEN** the network fetch times out and a cached `index.html` exists in the SW cache
- **THEN** the cached `index.html` SHALL be returned so the app loads without delay

#### Scenario: Navigation timeout with no cached index.html
- **WHEN** the network fetch times out and no cached `index.html` exists
- **THEN** the handler SHALL return a synthetic 503 response rather than hanging or propagating a rejection

### Requirement: Validation Expectations

Client changes SHALL be validated with the smallest relevant check first.

- Client logic changes SHALL use the smallest relevant check first: `npm run test:unit`, `npm run check`, or targeted Playwright coverage.
- E2E changes that rely on real deployed services SHALL be treated separately from sandbox-only validation.

#### Scenario: Client logic modified

- **WHEN** client logic is changed
- **THEN** `npm run test:unit` or `npm run check` SHALL be run before broader E2E coverage

### Requirement: Message Types and Media Rendering

The room page SHALL render all Matrix message types using the `type` field from `NormalizedEvent`.

- `ChatBubble` accepts a `type` prop (`text | image | audio | video | file | system | call`) and a `media` prop.
- `type: 'system'` renders as `SystemMessage` (centered muted line, no bubble wrapper).
- `type: 'call'` renders as `CallMessage` (centered pill with phone icon, direction, status, duration).
- `type: 'image'` renders an `<img>` via authenticated `getMediaUrl()`.
- `type: 'audio'` renders `AudioPlayer` (inline play/pause, progress bar, blob URL).
- `type: 'video'` renders `VideoPlayer` (poster thumbnail, loads blob on tap).
- `type: 'file'` renders `FileAttachment` (icon, name, size, download button).
- `type: 'text'` renders the message body as plain text (default).
- `isGroup` prop on `ChatBubble` controls sender name visibility: shown only in group rooms for received messages.

#### Scenario: Mixed message types in room timeline

- **WHEN** a room timeline contains text, image, audio, video, file, system, and call events
- **THEN** each SHALL render with its appropriate component without errors

#### Scenario: Answered call log entry rendered

- **WHEN** a `NormalizedEvent` with `type: 'call'` and `callMeta.status: 'answered'` is rendered
- **THEN** `CallMessage` SHALL show a green phone icon, direction label (Incoming/Outgoing), "Answered" status, and formatted duration

#### Scenario: Missed call log entry rendered

- **WHEN** a `NormalizedEvent` with `type: 'call'` and `callMeta.status: 'missed'` is rendered
- **THEN** `CallMessage` SHALL show a red phone icon, direction label, and "Missed" status with no duration

### Requirement: ChatInput Media Affordances

`ChatInput` SHALL provide attachment, audio recording, and video recording capabilities.

- Attachment button opens a file picker; on selection dispatches `sendMedia` event with `{ file, messageType }`.
- Audio record button (hidden if `MediaRecorder` unsupported) toggles recording; on stop dispatches `sendMedia` with `m.audio`.
- Video record button opens a 160×160px viewfinder; supports camera swap, 60s max, thumbnail extraction on send.
- The room page handles `sendMedia` by calling `backend.sendMediaMessage(roomId, file, messageType, replyToEventId)`.

### Requirement: Voice message metadata (MSC3245)

When the room page dispatches `sendMedia` with `isRecording: true` and `messageType: 'm.audio'`, `extractAudioInfo` decodes the recorded blob via `AudioContext.decodeAudioData` and returns `{ durationSecs, waveformData }`.

- `info.duration` SHALL be set to `Math.round(durationSecs * 1000)` (milliseconds, integer).
  - If `buffer.duration` is non-finite (iOS `audio/mp4` streaming format returns `Infinity`), `durationSecs` SHALL be `null` and `info.duration` SHALL be omitted.
- `info.waveform` SHALL be an array of **60 integers in the range 0–1024** (MSC3245 format).
  - Values are computed as `Math.round(peak * 1024)` over 60 equal windows of the first channel's PCM data.
  - Non-finite PCM samples are skipped when computing the per-bar peak.
  - Floats MUST NOT be used — gomatrixserverlib rejects non-integer JSON numbers as "value is outside of safe range".

#### Scenario: User attaches a file

- **WHEN** the user selects a file via the attachment picker
- **THEN** `sendMedia` SHALL be dispatched with the correct `messageType` inferred from `file.type`

### Requirement: Media local echo lifecycle
When a media message is sent, the system SHALL add a local echo with a blob preview URL and SHALL NOT revoke that blob URL until the local echo is removed from the store. The blob URL SHALL be revoked at the moment `removeLocalEcho` removes the echo, ensuring the preview remains valid for the full duration the local echo is visible.

#### Scenario: Blob URL valid while echo is live
- **WHEN** `sendMediaMessage` is called and the upload completes
- **THEN** the local echo's blob preview URL SHALL remain valid (not revoked) until `removeLocalEcho` is called for that echo's `txnId`

#### Scenario: Blob URL revoked on echo removal
- **WHEN** `removeLocalEcho` is called for a local echo that carries a `_blobUrl`
- **THEN** `URL.revokeObjectURL(_blobUrl)` SHALL be called to free the object URL memory

#### Scenario: Echo removal on upload failure
- **WHEN** the media upload fails and `removeLocalEcho` removes the echo
- **THEN** the blob URL SHALL also be revoked at that point (same path as success case)

### Requirement: Upload size limits

`sendMediaMessage` SHALL enforce per-type upload size limits before calling `uploadContent()`.

| Type | Limit |
|------|-------|
| `m.image` | 10 MB |
| `m.audio` | 5 MB |
| `m.video` | 25 MB |
| `m.file` | 15 MB |

When the limit is exceeded, an error is thrown and the room page SHALL display a dismissable error banner above `ChatInput` for 6 seconds with the limit and a suggestion to use a sharing link for larger files.

#### Scenario: File too large

- **WHEN** the user attempts to send a file that exceeds the per-type limit
- **THEN** `sendMediaMessage` SHALL throw before starting the upload
- **AND** the room page SHALL display an error banner with the message `"File too large (max N MB). For larger files, share a link from a cloud storage service."`
- **AND** no local echo SHALL be added to the message list

### Requirement: Media cache (IndexedDB LRU)

Downloaded media blobs SHALL be cached in IndexedDB via `mediaCache.js` to reduce repeated fetches and provide fast playback.

- Cache max size: 100 MB; evicted to 80 MB using LRU (by `accessedAt`)
- Cache key: `mxc://` URI
- On 404 (expired media), `fetchCachedMedia` SHALL return `null`

#### Scenario: Cache hit

- **WHEN** `fetchCachedMedia(mxcUrl, httpUrl)` is called and the entry exists in IndexedDB
- **THEN** a blob URL SHALL be returned without an HTTP fetch, and `accessedAt` SHALL be updated

#### Scenario: Cache miss

- **WHEN** `fetchCachedMedia(mxcUrl, httpUrl)` is called and no entry exists
- **THEN** the blob SHALL be fetched from `httpUrl`, stored in IndexedDB, and a blob URL returned

#### Scenario: Expired media (404)

- **WHEN** `fetchCachedMedia` fetches from the server and receives a 404
- **THEN** `null` SHALL be returned
- **AND** `MediaThumbnail` SHALL display "Media expired" text placeholder
- **AND** `AudioPlayer` SHALL display "Audio expired" text instead of controls

### Requirement: Media thumbnail error fallback
`MediaThumbnail` SHALL render the placeholder (icon/emoji) and keep the button tappable when the thumbnail image fails to load for any reason (revoked blob URL, network error, unsupported format).

#### Scenario: Thumbnail image fails to load
- **WHEN** the `<img>` in `MediaThumbnail` fires an `error` event
- **THEN** the component SHALL render the placeholder content (`🖼` for images, Play icon for videos) instead of the broken image, while the `<button>` wrapper remains rendered and interactive

### Requirement: Image download

Images in chat bubbles SHALL provide a download button (lucide `Download` icon) overlaying the thumbnail.

#### Scenario: User taps download on an image bubble

- **WHEN** the user taps the download button on an image thumbnail
- **THEN** the full-res image SHALL be fetched via `fetchCachedMedia` (cache-first) and downloaded via `<a download>`

### Requirement: Chat history display windowing
The room page SHALL render at most `PAGE_SIZE` (30) messages at any time via `visibleMessages = messages.slice(-displayLimit)`. `displayLimit` starts at `PAGE_SIZE` and increases by `PAGE_SIZE` on each load-more trigger. Gallery image navigation SHALL use the full `messages` array.

#### Scenario: Initial render shows only recent messages
- **WHEN** the room page mounts and history is loaded
- **THEN** at most `PAGE_SIZE` (30) messages SHALL be rendered in the DOM

#### Scenario: Scrolling to top reveals older in-memory messages
- **WHEN** the user scrolls to within 80px of the top AND `messages.length > displayLimit`
- **THEN** `displayLimit` SHALL increase by `PAGE_SIZE` without a server request

#### Scenario: Scrolling to top triggers server pagination when memory is exhausted
- **WHEN** the user scrolls to within 80px of the top AND `messages.length <= displayLimit` AND `canLoadMore` is true
- **THEN** `loadMore` SHALL call `backend.loadMoreHistory` to fetch older events from the server

#### Scenario: Load-more scroll trigger fires for both cases
- **WHEN** `scrollTop < 80`
- **THEN** `loadMore` SHALL be called if `canLoadMore` is true OR `messages.length > displayLimit`

### Requirement: Chat input icon button spacing
The media action buttons (attach, mic, video) in the chat input toolbar SHALL have a `gap` of `4px` between them.

#### Scenario: Icons are visually compact
- **WHEN** the chat input toolbar is rendered
- **THEN** the gap between attach / mic / video icon buttons SHALL be `4px`

### Requirement: Message timestamp and read indicator spacing
The `.tick` span SHALL have `margin-left: 2px` and the `.ts` timestamp row SHALL have `margin-top: 1px`.

#### Scenario: Tick is close to timestamp
- **WHEN** a chat bubble with a read or unread indicator is rendered
- **THEN** the check mark SHALL sit `2px` to the right of the time text and the timestamp row SHALL sit `1px` below the message body

### Requirement: PWA Background Freeze Recovery

The app layout SHALL record the time when the page becomes hidden and SHALL trigger a forced sync restart if the app was backgrounded for >= 30 seconds when returning to the foreground.

- When `visibilityState` transitions to `hidden`, `backend.handleHide()` SHALL be called to record the background timestamp.
- When `visibilityState` transitions to `visible`, `backend.reconnectIfNeeded()` SHALL be called (which internally checks elapsed background time).
- When `pageshow` fires with `event.persisted = true` (bfcache restore), `backend.reconnectIfNeeded()` SHALL be called.

#### Scenario: App returns from long background

- **WHEN** the user returns to the PWA after >= 30 seconds in background
- **THEN** `backend.handleHide()` SHALL have been called on hide and `backend.reconnectIfNeeded()` SHALL trigger a forced sync restart

#### Scenario: App returns from short background

- **WHEN** the user returns to the PWA after < 30 seconds in background
- **THEN** `backend.reconnectIfNeeded()` SHALL NOT force-restart the sync loop if the sync state is SYNCING

### Requirement: Layout mounts watchdog and foreground-stale timers
`+layout.svelte` SHALL set up two recovery timers on mount (after `backend.init()` succeeds) and tear them down on destroy:

1. **Watchdog timer** (5 000 ms interval): calls `backend.reconnectOrReload(reload)` where `reload = () => location.reload()`
2. **Foreground stale timer** (60 000 ms interval): calls `backend.reconnectOrReload(reload)` when `document.visibilityState === 'visible'`

Both timers MUST be cleared in the layout's cleanup function.

#### Scenario: Timers start after init
- **WHEN** `backend.init()` resolves successfully
- **THEN** both watchdog and foreground-stale intervals are active

#### Scenario: Timers stopped on destroy
- **WHEN** the layout component is destroyed
- **THEN** both intervals are cleared and `location.reload` is no longer called by them

---

### Requirement: ConversationItem last message prop type
`ConversationItem.svelte` SHALL accept `lastMessage` as `{ text: string, msgtype: string }` (or empty string for backward compatibility during transition).

The component SHALL render a localized service label when `msgtype` is one of the known media/call types, and SHALL fall back to rendering `text` for `m.text` or unknown types.

#### Scenario: Structured object passed
- **WHEN** `lastMessage` is `{ text: 'filename.mp4', msgtype: 'm.video' }`
- **THEN** the component renders the localized Video label

#### Scenario: Empty object passed
- **WHEN** `lastMessage` is `{ text: '', msgtype: '' }` or empty string
- **THEN** the component renders the `email` fallback

### Requirement: Typing indicator — multi-user state tracking

The room page SHALL track typing state per user, not as a single boolean.

- State: `typingUsers: Record<userId, displayName>` (plain object, Svelte-reactive via reassignment)
- On `onTypingChanged` event with `typing: true`: add `{ [userId]: displayName }` entry
- On `onTypingChanged` event with `typing: false`: delete the userId entry
- Derived: indicator is shown when `Object.keys(typingUsers).length > 0`

**Previous behaviour (removed):** `peerTyping = typing` — last-event-wins boolean that incorrectly hides the indicator when any peer stops typing, even if others are still typing.

#### Scenario: Single user starts typing

- **WHEN** `onTypingChanged` fires with `typing: true` for userId A
- **THEN** `typingUsers` SHALL contain an entry for userId A and the indicator SHALL be visible

#### Scenario: One of two typing users stops

- **WHEN** `onTypingChanged` fires with `typing: false` for userId A while userId B is still in `typingUsers`
- **THEN** `typingUsers` SHALL no longer contain userId A but SHALL still contain userId B, and the indicator SHALL remain visible

### Requirement: Typing indicator — visual design

The typing indicator SHALL display as a styled bubble consistent with the chat message list.

- Container: same left-aligned layout as incoming messages (avatar-sized left margin)
- Content: animated three-dot row inside a bubble shape
- Animation: JS-driven via Svelte tweened stores inside `TypingDots.svelte` (staggered per-dot vertical offset). CSS `@keyframes` MUST NOT be used for this animation because they flicker on iOS Safari PWA.
- Entrance: `transition:fly={{ y: 8, duration: 180 }}` + `transition:fade={{ duration: 120 }}`
- Exit: reverse fade, duration 120 ms

#### Scenario: Typing indicator appears

- **WHEN** `Object.keys(typingUsers).length` transitions from 0 to 1
- **THEN** the indicator bubble SHALL fly in from below (`y: 8`) with a 180 ms duration and fade in over 120 ms

#### Scenario: Typing indicator disappears

- **WHEN** `Object.keys(typingUsers).length` transitions from non-zero to 0
- **THEN** the indicator bubble SHALL fade out over 120 ms

### Requirement: Typing indicator — sender label

The indicator SHALL show who is typing.

| Room type | Label |
|-----------|-------|
| DM (2 members) | No name label needed |
| Group (3+ members), 1 typer | "{Name} is typing…" |
| Group, 2 typers | "{Name1}, {Name2} are typing…" |
| Group, 3+ typers | "{Name1}, {Name2} + N more are typing…" |

Display name resolution: use `room?.members` array; fall back to the local part of the Matrix userId.

#### Scenario: Group room with one typer

- **WHEN** one user is typing in a room with 3+ members
- **THEN** the label SHALL read `"{Name} is typing…"`

#### Scenario: Group room with two typers

- **WHEN** two users are typing simultaneously in a group room
- **THEN** the label SHALL read `"{Name1}, {Name2} are typing…"`

#### Scenario: Group room with three or more typers

- **WHEN** three or more users are typing simultaneously in a group room
- **THEN** the label SHALL read `"{Name1}, {Name2} + N more are typing…"` where N is the overflow count

#### Scenario: DM room with one typer

- **WHEN** the peer is typing in a DM room (2 members)
- **THEN** no name label SHALL be displayed alongside the typing dots

### Requirement: Typing indicator — test coverage

The `onTypingChanged` subscription logic SHALL have vitest coverage in `matrix.test.js` (or a sibling `messaging.test.js`):

- Single user starts and stops typing: indicator toggled correctly
- Two users typing simultaneously: indicator stays visible when one stops
- Own typing events are ignored (no indicator shown for self)
- Subscription is cleaned up on unsubscribe (no further callbacks after teardown)

#### Scenario: Own typing event ignored

- **WHEN** `onTypingChanged` fires with the local user's own userId
- **THEN** no entry SHALL be added to `typingUsers` and the indicator SHALL not appear

#### Scenario: Subscription teardown

- **WHEN** the unsubscribe function returned by `onTypingChanged` is called
- **THEN** no further callbacks SHALL fire after that point

### Requirement: Typed Client Contracts

The web client SHALL expose app-owned typed contracts for its shared services, stores, route data, and component interactions.

#### Scenario: Shared client contract consumed across layers

- **WHEN** the same client domain object is used across routes, services, stores, and components
- **THEN** the client SHALL define and reuse a shared typed contract for that object instead of duplicating implicit shapes

#### Scenario: Route page uses shared logic

- **WHEN** a route page consumes migrated shared logic
- **THEN** the route page SHALL consume typed services, stores, or helpers rather than embedding cross-page business logic in the page file

### Requirement: Migration Compatibility Rules

The web client SHALL preserve runtime compatibility while JavaScript and TypeScript modules temporarily coexist during migration.

#### Scenario: Mixed module graph during migration

- **WHEN** a migrated TypeScript module is imported by an unmigrated JavaScript module, or the reverse
- **THEN** the client workspace SHALL provide compatible module resolution and build behavior for both files until the migration step is complete
- **THEN** compatibility shims or adapters MUST be removed only after all dependent modules have been migrated and validated

#### Scenario: Runtime infrastructure still in JavaScript

- **WHEN** critical client runtime modules such as Matrix transport, event stores, browser cache or storage helpers, push support, or service worker code have not yet been migrated
- **THEN** the migration plan SHALL continue to treat them as first-class client work rather than out-of-scope infrastructure
- **THEN** route and component migration alone MUST NOT be treated as sufficient evidence that the full client has been migrated to TypeScript
