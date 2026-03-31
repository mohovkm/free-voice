# Push Notifications

## Purpose

Specifies the Web Push (VAPID) notification integration, its subscription management, platform support, API contract, and the known gap in Matrix-mode delivery.

## Requirements

### Requirement: Subscription Ownership

Push subscription management SHALL be owned by the API and client modules listed below.

- Subscription management: `backend/src/routes/push.py`
- Client subscription flow: `client/src/lib/services/push.ts`
- Subscription storage: `push_subscriptions` table, keyed by `matrix_user_id`

#### Scenario: Subscription storage queried

- **WHEN** a push subscription is stored or looked up
- **THEN** it SHALL be keyed by `matrix_user_id` in the `push_subscriptions` table

### Requirement: Subscription Flow

The client SHALL subscribe to Web Push after Matrix init, and the API SHALL validate subscriptions via Dendrite whoami.

- The client subscribes to Web Push (VAPID) after Matrix `init()` completes, so `getAccessToken()` is available.
- `POST /api/push/subscribe` accepts a Matrix Bearer token, validates it against Dendrite `whoami`, and stores the subscription keyed by Matrix user ID.
- `DELETE /api/push/subscribe` removes the subscription.
- `GET /api/push/vapid-key` returns the server's VAPID public key (unauthenticated).
- The subscription SHALL be re-attempted on every app load and on settings page focus to recover from expired or missing subscriptions.

#### Scenario: App loads with existing Matrix session

- **WHEN** the app loads and Matrix `init()` completes
- **THEN** the client SHALL attempt to subscribe to Web Push using the live Matrix access token

#### Scenario: Subscription expired

- **WHEN** the settings page gains focus and the subscription is expired or missing
- **THEN** the client SHALL re-attempt subscription

### Requirement: Platform Support

Web Push (VAPID) SHALL be supported on the following platforms.

- Desktop: Chrome, Firefox, Edge
- Android: Chrome
- iOS: Safari 16.4+ when the app is installed as a PWA (Add to Home Screen)

#### Scenario: iOS user without PWA install

- **WHEN** an iOS user accesses the app in Safari without installing it as a PWA
- **THEN** push notifications SHALL NOT be available

### Requirement: Matrix Delivery Path (Known Gap)

Push notifications are NOT currently delivered for Matrix messages or calls. The subscription infrastructure is in place but no component triggers delivery. A delivery path MUST be implemented before push notifications are considered functional.

The correct Matrix-native delivery path requires one of:

1. **Sygnal push gateway**: Dendrite supports the Matrix push rules spec. Deploying a Sygnal instance and configuring a push rule on Dendrite would allow Dendrite to trigger VAPID delivery via Sygnal when messages arrive, even when the client is offline.
2. **API-side Matrix sync listener**: A background task in the FastAPI service that subscribes to Dendrite's `/_matrix/client/v3/sync` on behalf of users and dispatches VAPID pushes when relevant events arrive.

Option 1 (Sygnal) is the standard Matrix approach and the recommended path.

#### Scenario: Matrix message arrives while client is offline

- **WHEN** a Matrix message arrives and the recipient's browser tab is not active
- **THEN** no push notification is currently delivered (known gap); this requires Sygnal or an equivalent delivery path to be implemented

### Requirement: API Contract

The push API SHALL expose these endpoints with the specified auth requirements.

- `GET /api/push/vapid-key` — returns `{ "public_key": string }`, no auth required
- `POST /api/push/subscribe` — `Bearer <matrix access token>`, body: `{ endpoint, keys: { p256dh, auth } }`
- `DELETE /api/push/subscribe` — `Bearer <matrix access token>`, body: `{ endpoint, keys }`

#### Scenario: Unauthenticated VAPID key request

- **WHEN** `GET /api/push/vapid-key` is called without auth
- **THEN** it SHALL return `{ "public_key": string }` with HTTP 200

#### Scenario: Subscribe with invalid token

- **WHEN** `POST /api/push/subscribe` is called with an invalid Matrix Bearer token
- **THEN** the request SHALL be rejected after Dendrite `whoami` validation fails

### Requirement: Validation Coverage

Push endpoints SHALL be covered by automated tests.

- `backend/tests/test_push.py` covers VAPID key endpoint, subscribe/unsubscribe auth, and send_push dispatch logic.

#### Scenario: Push tests run

- **WHEN** `pytest backend/tests/test_push.py` is executed
- **THEN** VAPID key endpoint, subscribe/unsubscribe auth, and send_push dispatch logic SHALL be validated

### Requirement: Spec Update Policy

This document MUST be updated when the delivery path or subscription model changes.

- Update this document when Sygnal or an equivalent delivery path is implemented.
- Update when the push subscription model changes (e.g. per-device keying, expiry handling).

#### Scenario: Sygnal deployed

- **WHEN** Sygnal or an equivalent push delivery path is implemented
- **THEN** this spec MUST be updated to reflect the new delivery mechanism
