# Online Presence

Tracks and displays whether contacts are currently online in the UI.

---

## Requirement: Dendrite presence enabled

Dendrite SHALL have inbound and outbound presence enabled in its configuration.

- `enable_inbound: true` — server accepts and forwards presence from remote users.
- `enable_outbound: true` — server forwards local user presence to subscribers.

#### Scenario: Dendrite config has presence block
- **WHEN** the Dendrite config is rendered from `dendrite.yaml.j2`
- **THEN** the `global.presence` section SHALL include `enable_inbound: true` and `enable_outbound: true`

---

## Requirement: Local user publishes online presence on connect

The Matrix SDK client SHALL publish the local user's presence as `online` after `startClient()` is called via `setSyncPresence('online')`. This applies on initial connect and on every reconnect.

#### Scenario: User opens the PWA
- **WHEN** `startClient()` is called during `backend.init()`
- **THEN** `setSyncPresence('online')` SHALL be called immediately after

---

## Requirement: Stale presence override

Because Dendrite can take up to 5 minutes to flip a user's presence to `unavailable` after disconnect, the client SHALL apply a client-side staleness threshold.

- Threshold constant: `PRESENCE_STALE_MS` (default 60 000 ms)
- If `last_active_ago > PRESENCE_STALE_MS`, the contact SHALL be treated as offline regardless of the `presence` field returned by the API.

#### Scenario: User disconnects
- **WHEN** `fetchPresence` is called and `last_active_ago > PRESENCE_STALE_MS`
- **THEN** the contact SHALL be marked offline in `presenceMap`

---

## Requirement: Shared reactive presence store

A shared Svelte writable store `presenceMap` (userId → boolean) SHALL track online state across all pages.

- `startPresenceTracking()` starts a 15-second polling interval and subscribes to `onPresenceChanged` events.
- It SHALL be called once after `backend.init()` completes in the app layout.
- `stop()` cleans up the interval and event subscription on layout teardown.

#### Scenario: Contact goes online
- **WHEN** the polling interval fires and `fetchPresence` returns `presence: 'online'` with `last_active_ago < PRESENCE_STALE_MS`
- **THEN** `presenceMap[userId]` SHALL be `true`

#### Scenario: Contact goes offline
- **WHEN** the polling interval fires and `last_active_ago > PRESENCE_STALE_MS`
- **THEN** `presenceMap[userId]` SHALL be `false`

---

## Requirement: Avatar online indicator

The `Avatar` component SHALL accept an `online` boolean prop (default `false`). When `online` is `true`, the component SHALL render a small green dot overlay on the bottom-right corner of the avatar circle.

#### Scenario: Contact is online
- **WHEN** `<Avatar online={true} />` is rendered
- **THEN** a green dot SHALL be visible on the avatar

#### Scenario: Contact is offline (default)
- **WHEN** `<Avatar />` is rendered without the `online` prop
- **THEN** no dot SHALL be shown

---

## Requirement: Online status in all contact surfaces

The following pages SHALL wire `presenceMap` to show online status:

| Surface | Lookup key |
|---|---|
| Contacts page (`/contacts`) | `$presenceMap[c.email]` |
| Conversations list (`/`) | `$presenceMap[getRoomPeer(roomId)?.userId]` |
| Chat room header (`/room/[id]`) | `$presenceMap[getRoomPeer(roomId)?.userId]` |
