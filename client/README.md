# Client Workspace

This workspace owns the messenger UI.

- `src/`: Svelte application code
- `tests/unit/`: Vitest coverage
- `tests/e2e/local/`: local Playwright coverage
- `tests/e2e/real/`: deployed-stack Playwright coverage

Why Svelte:

- the app is heavily stateful but UI-first, and Svelte keeps components small without a lot of framework ceremony
- store-driven flows such as auth, unread state, Matrix timeline state, and call state stay explicit instead of being hidden behind large abstractions
- the current codebase leans on direct component composition and small files; Svelte fits that style better than a heavier client framework

High-level client structure:

- `src/routes/`: SvelteKit route tree
- `src/lib/components/`: reusable UI building blocks
- `src/lib/services/`: transport, call, push, media-cache, and backend integration logic
- `src/lib/stores/`: app state for auth, i18n, Matrix timeline, call, presence, and unread counters
- `src/lib/types/`: transport and UI contracts

Main UI components:

- `ConversationItem.svelte`: row renderer for the chats list
- `ChatBubble.svelte`: message bubble renderer for text, call, and media entries
- `ChatInput.svelte`: composer with text, attachments, recording, and send actions
- `ChatHeader.svelte`: room/contact header actions
- `AudioPlayer.svelte` and `VideoPlayer.svelte`: custom media playback surfaces
- `CallView.svelte` and `CallControls.svelte`: active call UI and controls
- `Sidebar.svelte` and `BottomNav.svelte`: desktop/mobile navigation shells
- `Avatar.svelte`, `UnreadBadge.svelte`, `TypingDots.svelte`, `SystemMessage.svelte`: shared primitives

How routing works:

- this is a SvelteKit SPA-style app with grouped route trees
- `routes/(auth)/...` holds unauthenticated flows:
  - login
  - register
  - forgot/reset password
  - verify
- `routes/(app)/...` holds the authenticated product shell:
  - chats at `/`
  - contacts at `/contacts`
  - links at `/links`
  - settings at `/settings`
  - about and guide pages
  - Matrix room view at `/room/[id]`
- `routes/call/[slug]/+page.svelte` is the guest call entry surface
- incoming and in-app call surfaces live under `routes/(app)/call/...`

Matrix and call stack rationale:

- `matrix-js-sdk` is used for the messaging and identity layer because the product needs room sync, event timelines, membership state, unread counts, receipts, presence, media upload/download, and Matrix auth semantics
- the app does not use a single high-level SDK for calls because the call flow is product-specific and split across:
  - Matrix signaling and room state
  - the app-owned call state machine in `src/lib/services/callSession.ts`
  - WebRTC media lifecycle and browser permissions
  - LiveKit integration for the current real-time call path
- keeping calls in `callSession.ts` gives the project one explicit state-machine owner for ringing, connecting, reconnecting, hangup reasons, and media-element wiring
- this separation is intentional: Matrix SDK is strong for messaging transport, but call UX, browser media handling, and migration constraints are app-specific here

Current backend usage from the client:

- the client is Matrix-first now
- the active backend module is `src/lib/services/backends/matrix.ts`
- `src/lib/services/playwrightBackend.ts` exists only for deterministic local E2E
- `src/lib/services/callSession.ts` remains the single authority for call lifecycle orchestration

Use:

```bash
cd client
npm run check
npm run test:unit
npm run test:e2e
npm run test:e2e:real
```

Useful validation slices:

```bash
cd client
npm run check
npm run test:unit
npx playwright test --config tests/e2e/playwright.config.ts
npx playwright test --config tests/e2e/playwright.real.config.ts
```

Authoritative behavior lives in [openspec/specs/web-client/spec.md](../openspec/specs/web-client/spec.md).
