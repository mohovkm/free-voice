# Last Message Preview

## Overview

This spec defines how the last message in a Matrix room is extracted, typed, and displayed in the chat list (conversation sidebar). The goal is to show localized service labels for media and call events instead of raw filenames.

---

## Requirements

### Requirement: Last message producer returns structured type
`_getLastMessageBody(room)` and `lastMessageFor(roomId)` SHALL return `{ text: string, msgtype: string }` instead of a plain string.
- `text` is the raw `body` field from the Matrix event (may be empty string for call events)
- `msgtype` is the Matrix `msgtype` field for `m.room.message` events, or `'call'` for call events
- The producer SHALL inspect the timeline from newest to oldest and return the first qualifying room-message or call event
- For rooms with no qualifying events, both functions SHALL return `{ text: '', msgtype: '' }`

#### Scenario: Text message
- **WHEN** the last `m.room.message` event has `msgtype: 'm.text'`
- **THEN** the producer returns `{ text: <body>, msgtype: 'm.text' }`

#### Scenario: Image message
- **WHEN** the last `m.room.message` event has `msgtype: 'm.image'`
- **THEN** the producer returns `{ text: <filename>, msgtype: 'm.image' }`

#### Scenario: Audio message
- **WHEN** the last `m.room.message` event has `msgtype: 'm.audio'`
- **THEN** the producer returns `{ text: <filename>, msgtype: 'm.audio' }`

#### Scenario: Video message
- **WHEN** the last `m.room.message` event has `msgtype: 'm.video'`
- **THEN** the producer returns `{ text: <filename>, msgtype: 'm.video' }`

#### Scenario: File message
- **WHEN** the last `m.room.message` event has `msgtype: 'm.file'`
- **THEN** the producer returns `{ text: <filename>, msgtype: 'm.file' }`

#### Scenario: Latest call event wins over older room messages
- **WHEN** the newest qualifying timeline event is `m.call.invite` or `m.call.hangup` with a `call_id`
- **THEN** the producer returns `{ text: '', msgtype: 'call' }`

#### Scenario: No events
- **WHEN** the room timeline has no qualifying events
- **THEN** the producer returns `{ text: '', msgtype: '' }`

---

### Requirement: Chat list renders localized service message labels
`ConversationItem.svelte` SHALL display a localized label for non-text last messages instead of the raw filename.

Msgtype-to-label mapping:
- `m.image` → i18n key `lastMsgPhoto`
- `m.audio` → i18n key `lastMsgVoice`
- `m.video` → i18n key `lastMsgVideo`
- `m.file` → i18n key `lastMsgFile`
- `call` → i18n key `lastMsgCall`
- `m.text` or empty msgtype → display `text` as plain string

#### Scenario: Image in chat list
- **WHEN** `lastMessage.msgtype` is `'m.image'`
- **THEN** the preview shows the localized label for Photo (not the filename)

#### Scenario: Voice message in chat list
- **WHEN** `lastMessage.msgtype` is `'m.audio'`
- **THEN** the preview shows the localized label for Voice message

#### Scenario: Video in chat list
- **WHEN** `lastMessage.msgtype` is `'m.video'`
- **THEN** the preview shows the localized label for Video

#### Scenario: File in chat list
- **WHEN** `lastMessage.msgtype` is `'m.file'`
- **THEN** the preview shows the localized label for File

#### Scenario: Call in chat list
- **WHEN** `lastMessage.msgtype` is `'call'`
- **THEN** the preview shows the localized label for Call

#### Scenario: Plain text in chat list
- **WHEN** `lastMessage.msgtype` is `'m.text'` or empty
- **THEN** the preview shows the raw message text

---

### Requirement: Localized i18n keys for service messages
`en.js` and `ru.js` SHALL include the following new keys:
- `lastMsgPhoto` — English: "Photo", Russian: "Фото"
- `lastMsgVoice` — English: "Voice message", Russian: "Голосовое сообщение"
- `lastMsgVideo` — English: "Video", Russian: "Видео"
- `lastMsgFile` — English: "File", Russian: "Файл"
- `lastMsgCall` — English: "Call", Russian: "Звонок"

#### Scenario: English labels
- **WHEN** the app locale is English
- **THEN** media previews use English labels as specified

#### Scenario: Russian labels
- **WHEN** the app locale is Russian
- **THEN** media previews use Russian labels as specified
