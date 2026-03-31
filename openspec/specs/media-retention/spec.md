# Media Retention

## Purpose

Defines the policies, mechanisms, and configuration for controlling media storage growth on the Pi: client-side upload size limits, server-side cleanup, client-side caching, save-to-gallery, and expired media handling.

## Requirements

### Requirement: Per-type upload size limits

The system SHALL enforce maximum file size limits per media type before uploading to the server.

| Type | Max size |
|------|----------|
| Image (`m.image`) | 10 MB |
| Audio (`m.audio`) | 5 MB |
| Video (`m.video`) | 25 MB |
| File (`m.file`) | 15 MB |

#### Scenario: User uploads a file within limit

- **WHEN** a user selects a file within the per-type limit
- **THEN** the upload SHALL proceed normally

#### Scenario: User uploads a file exceeding limit

- **WHEN** a user selects a file exceeding the per-type limit
- **THEN** the upload SHALL be rejected before any network request
- **AND** the user SHALL see an error banner stating the limit and suggesting a sharing link for larger files

### Requirement: Server-side media retention

A cleanup job SHALL run on a configurable schedule and delete media files older than the retention TTL from the Dendrite media directory.

- Default TTL: 30 days from upload
- The cleanup job MUST NOT delete Dendrite database rows — only filesystem files
- The cleanup job MUST log the number of deleted files and freed space
- Deployed as `media_cleanup.py` via the Dendrite Ansible role, run by `media-cleanup.timer`

#### Scenario: Media file older than default TTL

- **WHEN** a media file has an upload timestamp older than `media_ttl_days`
- **THEN** the cleanup job SHALL delete the file from disk on the next scheduled run

#### Scenario: Cleanup job runs

- **WHEN** the systemd timer triggers the cleanup job
- **THEN** it SHALL scan `/opt/dendrite/media/local/`, cross-reference `mediaapi.db` for timestamps, and delete eligible files

### Requirement: Disk usage monitoring

The cleanup job SHALL monitor disk usage and escalate retention aggressiveness when storage pressure is high.

- Warning threshold: media directory exceeds 80% of `media_disk_budget_gb`
- Emergency TTL: 3 days (applied when above warning threshold)
- Recovery: normal TTL resumes when usage drops below 60%

#### Scenario: Disk usage exceeds warning threshold

- **WHEN** the media directory exceeds 80% of the configured storage budget
- **THEN** the cleanup job SHALL log a warning and apply the emergency 3-day TTL

### Requirement: Client-side media cache

Downloaded media SHALL be cached in IndexedDB with LRU eviction to avoid redundant server fetches.

- Max cache size: 100 MB; evict to 80 MB (LRU by `accessedAt`)
- Cache key: `mxc://` URI; entry: `{ mxcUrl, blob, mimeType, size, accessedAt }`
- Implemented in `lib/services/mediaCache.js`

#### Scenario: Media requested and present in cache

- **WHEN** `fetchCachedMedia(mxcUrl, httpUrl)` is called for an mxc URI in the IndexedDB cache
- **THEN** a blob URL SHALL be returned without a network request and `accessedAt` SHALL be updated

#### Scenario: Media requested and not in cache

- **WHEN** `fetchCachedMedia(mxcUrl, httpUrl)` is called for an mxc URI not in cache
- **THEN** the blob SHALL be fetched from `httpUrl`, stored in IndexedDB, and a blob URL returned

#### Scenario: Cache exceeds max size

- **WHEN** a new cache entry would push total size above 100 MB
- **THEN** least-recently-accessed entries SHALL be evicted until total size is under 80 MB

### Requirement: Save-to-gallery for images

Image messages SHALL have a download button that saves the full-resolution image to the user's device.

#### Scenario: User taps download on an image

- **WHEN** the user taps the `Download` button on an image message thumbnail
- **THEN** the full-resolution image SHALL be fetched cache-first and a browser save dialog triggered

### Requirement: Expired media handling

The client SHALL handle missing media gracefully when the server returns 404 for purged files.

- `VideoPlayer` SHALL handle 404 from `mediaCache.get()` (null return) by displaying "Media expired" in muted italic text instead of playback controls.
- `MediaThumbnail` MUST NOT use a video's `mxcUrl` as an `<img>` source when `thumbnailUrl` is absent, as browsers cannot render video files as images and the load failure would incorrectly trigger the expired-media UI.

#### Scenario: Client requests purged media (image)

- **WHEN** the image thumbnail fails to load (including 404)
- **THEN** `MediaThumbnail` SHALL display "Media expired" in muted text instead of a broken image

#### Scenario: Client requests purged video

- **WHEN** `mediaCache.get()` returns `null` for a video (server 404)
- **THEN** `VideoPlayer` SHALL display "Media expired" in muted italic text instead of playback controls

#### Scenario: Video message without dedicated thumbnail

- **WHEN** a video message has no `thumbnail_url` in its `info` block
- **THEN** `VideoPlayer` SHALL auto-download the video and show inline controls — it SHALL NOT show "Media expired"

#### Scenario: Client requests purged audio

- **WHEN** `mediaCache.get()` returns `null` for an audio file (404)
- **THEN** `AudioPlayer` SHALL display "Audio expired" in muted italic text instead of playback controls

### Requirement: Retention configuration

All retention parameters SHALL be configurable via Ansible inventory variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `media_ttl_days` | `30` | Default TTL for all media files |
| `media_disk_budget_gb` | `40` | Allocated storage budget (GB) |
| `media_cleanup_schedule` | `daily` | systemd timer `OnCalendar` value |

### Requirement: Audio recorder duration limit

The system SHALL enforce a maximum recording duration of 2 minutes (120 seconds) for in-app voice recordings only.

- The `MediaRecorder` SHALL stop automatically when the recording timer reaches 120 seconds
- The UI SHALL show an inline notice "Maximum recording length reached (2 min)" when auto-stop fires
- The completed recording SHALL be sent normally after auto-stop

Audio files sent as attachments via the file picker are NOT subject to a duration limit. Only the existing per-type size limit (5 MB) applies to them.

#### Scenario: Recorder reaches 2-minute limit

- **WHEN** the user is recording and the recording reaches 120 seconds
- **THEN** the recorder SHALL stop automatically
- **AND** the UI SHALL display an inline notice indicating the maximum was reached
- **AND** the recording SHALL be available to send normally

#### Scenario: File-picker audio attachment — no duration limit

- **WHEN** the user picks an audio file of any duration from the file picker
- **THEN** the upload SHALL proceed normally without any duration check
- **AND** only the 5 MB file size limit SHALL apply
