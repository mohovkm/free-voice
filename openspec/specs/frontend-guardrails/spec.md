# Frontend UI And PWA Guardrails

## Purpose

Defines the repository's guardrails for Svelte, SvelteKit, PWA behavior, and modern UI composition to maintain consistency and quality across the web client.

## Requirements

### Requirement: Svelte And SvelteKit Lifecycle Rules

Svelte lifecycle hooks MUST be used correctly to avoid server/client mismatches and cleanup leaks.

#### Scenario: Using onMount

- **WHEN** a contributor uses `onMount` in a Svelte component
- **THEN** it SHALL be used only for client-only work that requires the DOM, browser APIs, or runtime session state
- **THEN** the contributor MUST NOT rely on `onMount` for server-rendered behavior, as it does not run on the server
- **THEN** if `onMount` returns a cleanup function, the callback SHALL remain synchronous

#### Scenario: Writing Svelte 5 code

- **WHEN** a contributor writes Svelte 5 code
- **THEN** they SHALL prefer `$effect` and `$effect.pre` over deprecated component-wide update hooks

#### Scenario: Structuring route pages

- **WHEN** a contributor creates or modifies route pages
- **THEN** route pages SHALL be kept thin
- **THEN** reusable behavior SHALL be moved into services, stores, or shared components

### Requirement: Service Worker And PWA Caching

The service worker MUST use SvelteKit-provided cache management and follow the established fetch strategy.

#### Scenario: Managing the service worker

- **WHEN** a contributor modifies the service worker at `client/src/service-worker.ts`
- **THEN** they SHALL use `$service-worker` `build`, `files`, and `version` for cache management rather than hardcoding asset lists
- **THEN** cache naming SHALL be deployment-specific by using the provided app version
- **THEN** per-user authenticated API responses or sync streams MUST NOT be blindly cached

#### Scenario: Applying fetch strategy

- **WHEN** the service worker handles fetch requests
- **THEN** the following strategy SHALL be maintained unless the task explicitly changes offline behavior:
  - `/api/*`: network-first
  - `/_app/*`: cache-first
  - navigations: SPA fallback

### Requirement: PWA Manifest Coherence

The PWA manifest MUST remain coherent with actual app branding.

#### Scenario: Changing install surface or icons

- **WHEN** install surface or icon assets change
- **THEN** `client/static/manifest.json` SHALL be updated in the same change
- **THEN** `name`, `short_name`, `display`, `theme_color`, `background_color`, and icon metadata SHALL remain coherent with the actual app branding

### Requirement: Design Token Usage

UI styling MUST use design tokens from the shared token set rather than hardcoded values.

#### Scenario: Adding new visual values

- **WHEN** a contributor needs a new color, radius, or repeated spacing value
- **THEN** they SHALL extend the token set in `client/src/app.css` before hardcoding new values
- **THEN** they SHALL respect theme variables for dark and light mode
- **THEN** they SHALL preserve reduced-motion behavior
- **THEN** they SHALL preserve safe-area support for mobile surfaces

### Requirement: Shared Component Reuse

Contributors MUST reuse existing shared components before creating new variants.

#### Scenario: Implementing a UI pattern

- **WHEN** a contributor implements a UI interaction
- **THEN** they SHALL check and reuse existing shared components first:
  - Navigation and shell: `Avatar.svelte`, `BottomNav.svelte`, `Sidebar.svelte`, `UnreadBadge.svelte`
  - Messaging: `ConversationItem.svelte`, `ChatHeader.svelte`, `ChatBubble.svelte`, `ChatInput.svelte`
  - Calling: `CallView.svelte`, `CallControls.svelte`

#### Scenario: Creating a new shared component

- **WHEN** a new interaction pattern is reused in two or more routes or is part of the domain language of the app
- **THEN** a shared component SHALL be created under `client/src/lib/components/`

### Requirement: Semantic And Accessibility Rules

All interactive UI MUST be semantically correct and accessible.

#### Scenario: Building interactive controls

- **WHEN** a contributor builds interactive UI elements
- **THEN** links SHALL be used for navigation and buttons for actions
- **THEN** interactive controls and forms SHALL be labeled explicitly
- **THEN** keyboard access, focus visibility, and screen-reader meaning SHALL be preserved
- **THEN** role- and label-friendly structures SHALL be preferred so both accessibility tooling and Playwright locators remain stable

### Requirement: Modern UI Consistency

New UI MUST preserve the existing visual language and handle all interaction states.

#### Scenario: Adding new UI

- **WHEN** a contributor adds new UI to the application
- **THEN** they SHALL preserve the existing communication-app visual language instead of introducing an unrelated design system
- **THEN** they SHALL prefer clear information hierarchy, compact mobile-safe layouts, and touch-friendly controls
- **THEN** they SHALL use `lucide-svelte` for new icons unless there is a compelling reason not to
- **THEN** they MUST NOT add a full third-party component framework unless the repository explicitly adopts one
- **THEN** new UI SHALL handle loading, empty, error, and offline-adjacent states intentionally
