# PWA Watchdog Reload

## Purpose

Describes the watchdog and foreground-stale timer subsystem responsible for detecting iOS background suspension and stale Matrix sync, and triggering hard reloads or soft reconnects accordingly.

---

## Requirements

### Requirement: Watchdog detects event-loop freeze and triggers reload
The app SHALL maintain a watchdog timer that ticks every 5 seconds and records the tick timestamp. On each tick, if the real elapsed time since the previous tick exceeds `HARD_RELOAD_THRESHOLD_MS` (180 000 ms), the app SHALL call the reload function (`location.reload()`).

This detects iOS background suspension: the timer does not fire during suspension, so on resume the gap is the actual freeze duration.

#### Scenario: Short background — no reload
- **WHEN** the watchdog fires and the gap since last tick is less than `FREEZE_THRESHOLD_MS`
- **THEN** no reconnect or reload is triggered

#### Scenario: Medium background — soft reconnect
- **WHEN** the watchdog fires and the gap is >= `FREEZE_THRESHOLD_MS` (5 000 ms) but < `HARD_RELOAD_THRESHOLD_MS`
- **THEN** `reconnectOrReload` attempts soft reconnect (stopClient + startClient)

#### Scenario: Long background — hard reload
- **WHEN** the watchdog fires and the gap is >= `HARD_RELOAD_THRESHOLD_MS`
- **THEN** `reloadFn` is called immediately without attempting soft reconnect

### Requirement: Post-reconnect verification triggers reload on stale sync
After a medium-gap soft reconnect, the app SHALL verify that Matrix sync recovers within 20 seconds. If `_lastSyncAt` is still older than `FREEZE_THRESHOLD_MS` at the verification point, the app SHALL call `reloadFn`.

#### Scenario: Sync recovers after reconnect
- **WHEN** soft reconnect is triggered and a sync event arrives within 20 seconds
- **THEN** no reload is triggered

#### Scenario: Sync does not recover after reconnect
- **WHEN** soft reconnect is triggered and no sync event arrives within 20 seconds
- **THEN** `reloadFn` is called

### Requirement: Foreground sync staleness triggers reload
The app SHALL check every 60 seconds whether `_lastSyncAt` is older than `FOREGROUND_STALE_MS` (180 000 ms) while `document.visibilityState === 'visible'`. If stale, the app SHALL call `reloadFn`.

#### Scenario: Sync is fresh — no reload
- **WHEN** the foreground stale check runs and last sync was < 180s ago
- **THEN** no reload is triggered

#### Scenario: Sync is stale in foreground — reload
- **WHEN** the foreground stale check runs and last sync was >= 180s ago while the app is visible
- **THEN** `reloadFn` is called

### Requirement: reconnectOrReload is injectable for testing
`reconnectOrReload(reloadFn)` SHALL accept an optional `reloadFn` parameter. When omitted, it defaults to `() => location.reload()`. Tests SHALL pass a `vi.fn()` mock to assert reload trigger conditions without navigating the page.

#### Scenario: Default reload function
- **WHEN** `reconnectOrReload()` is called without arguments and reload is triggered
- **THEN** `location.reload()` is called

#### Scenario: Injected reload function
- **WHEN** `reconnectOrReload(mockFn)` is called and reload is triggered
- **THEN** `mockFn` is called instead of `location.reload()`

### Requirement: Service worker controller change triggers reload

When the service worker controller changes (e.g. a new SW version takes control of the page), the app SHALL reload to ensure fresh assets are used.

- The layout SHALL listen for `navigator.serviceWorker.addEventListener('controllerchange', ...)` and call `reloadFn` when it fires.
- The listener MUST be registered after `backend.init()` completes and MUST be removed on layout destroy.

#### Scenario: New service worker takes control
- **WHEN** a new service worker version activates and the `controllerchange` event fires
- **THEN** `reloadFn` (i.e. `location.reload()`) SHALL be called to load the updated assets

#### Scenario: controllerchange listener removed on destroy
- **WHEN** the layout component is destroyed
- **THEN** the `controllerchange` event listener SHALL be removed and no reload SHALL be triggered by subsequent controller changes
