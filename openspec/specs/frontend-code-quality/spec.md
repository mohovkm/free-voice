# Frontend Code Quality

## Purpose

Defines the code quality standards for the Svelte/SvelteKit web client that every contributor and review agent SHALL enforce to keep the codebase readable, maintainable, robust, and small.
## Requirements
### Requirement: File Size Limits

Every source file SHALL remain small enough to understand in a single reading session.

- Svelte components: MUST NOT exceed 150 lines (template + script + style combined).
- JS/TS service or store modules: MUST NOT exceed 300 lines.
- Test files: MUST NOT exceed 400 lines.

When a file approaches the limit, it SHALL be split by extracting helpers, sub-components, or separate modules.

#### Scenario: Component exceeds line limit

- **WHEN** a Svelte component exceeds 150 lines
- **THEN** the reviewer SHALL flag it and require extraction of logic into services/stores or child components

#### Scenario: Service module exceeds line limit

- **WHEN** a JS/TS module exceeds 300 lines
- **THEN** the reviewer SHALL flag it and require splitting into focused sub-modules

### Requirement: Single Responsibility

Every file SHALL have one clear responsibility. A module that does two unrelated things MUST be split.

- Components: render UI from props/stores. No fetching, no business logic.
- Services: orchestrate side effects (network, storage, SDK calls).
- Stores: hold reactive state and expose derived values.
- Utilities: pure functions with no side effects.

#### Scenario: Component fetches data directly

- **WHEN** a component contains a `fetch()` call or direct API/SDK interaction
- **THEN** the reviewer SHALL require moving it to a service

#### Scenario: Store contains side effects

- **WHEN** a store module performs network calls or writes to storage
- **THEN** the reviewer SHALL require moving the side effect into a service that updates the store

### Requirement: Naming Conventions

Names SHALL be self-documenting. Abbreviations MUST NOT be used unless they are universally understood in the domain (e.g. `DM`, `SIP`, `RTC`).

- Files: `kebab-case.js`, `PascalCase.svelte`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Stores: noun describing the state (`conversations`, `unread`, `auth`)
- Boolean variables: prefixed with `is`, `has`, `can`, `should`
- Event handlers: prefixed with `handle` (in components) or `on` (in props)

#### Scenario: Ambiguous variable name

- **WHEN** a variable name is a single letter, generic (`data`, `info`, `temp`, `val`), or an unexplained abbreviation
- **THEN** the reviewer SHALL require a descriptive name

#### Scenario: Boolean without prefix

- **WHEN** a boolean variable lacks an `is`/`has`/`can`/`should` prefix
- **THEN** the reviewer SHALL require renaming

### Requirement: Function Design

Functions SHALL be short, pure where possible, and do one thing.

- MUST NOT exceed 25 lines of logic (excluding JSDoc and blank lines).
- MUST have at most 3 parameters. Use an options object for more.
- MUST return early for guard clauses instead of nesting.
- Pure functions MUST NOT mutate arguments or access external mutable state.
- Side-effecting functions SHALL be clearly named (`save*`, `send*`, `fetch*`, `update*`).

#### Scenario: Function exceeds 25 lines

- **WHEN** a function body exceeds 25 lines of logic
- **THEN** the reviewer SHALL require extracting sub-steps into named helpers

#### Scenario: Deeply nested conditionals

- **WHEN** a function has more than 2 levels of nesting
- **THEN** the reviewer SHALL require early returns or extraction of branches into helpers

### Requirement: Error Handling

All fallible operations SHALL have explicit error handling. Silent failures MUST NOT exist.

- `try/catch` blocks MUST NOT be empty.
- Caught errors MUST be logged or surfaced to the user.
- Network and SDK calls MUST handle failure with a user-visible state (error message, retry affordance, or graceful degradation).
- Optional chaining (`?.`) MUST NOT be used to silently swallow unexpected nulls — if a value can be null, the null case SHALL be handled explicitly.

#### Scenario: Empty catch block

- **WHEN** a `catch` block is empty or contains only a comment
- **THEN** the reviewer SHALL require logging or user-facing error handling

#### Scenario: Network call without error handling

- **WHEN** a `fetch`, SDK call, or async operation lacks error handling
- **THEN** the reviewer SHALL require a try/catch or `.catch()` with explicit handling

### Requirement: No Dead Code

The codebase MUST NOT contain dead code. Unused imports, unreachable branches, commented-out code blocks, and unused variables MUST be removed.

#### Scenario: Commented-out code block

- **WHEN** a file contains a commented-out code block longer than 2 lines
- **THEN** the reviewer SHALL require its removal (git history preserves it)

#### Scenario: Unused import or variable

- **WHEN** an import or variable is declared but never referenced
- **THEN** the reviewer SHALL require its removal

### Requirement: Consistent Patterns

Code MUST follow the patterns already established in the codebase rather than introducing alternatives.

- State management: use Svelte stores (`writable`, `derived`). Do not introduce a second state library.
- HTTP calls: use the existing `api.js` service. Do not use raw `fetch` in new code.
- Auth token access: use the existing `auth` store/service. Do not read tokens from storage directly.
- Routing: use SvelteKit `goto()` and `$page`. Do not use `window.location` for SPA navigation.
- Icons: use `lucide-svelte`. Do not add another icon library.
- Backend abstraction: use `activeBackend`. Do not call Matrix SDK or legacy API directly from components.

#### Scenario: New pattern introduced alongside existing one

- **WHEN** code introduces a new way to do something the codebase already has a pattern for
- **THEN** the reviewer SHALL require using the existing pattern or explicitly proposing a migration

### Requirement: Import Hygiene

Imports SHALL be organized and minimal.

- Group imports: external libraries first, then internal modules, then relative imports.
- MUST NOT import from `index.js` barrel files if a direct import is available.
- MUST NOT use dynamic `import()` unless code-splitting is the explicit goal.
- Circular imports MUST NOT exist.

#### Scenario: Circular import detected

- **WHEN** module A imports from module B and module B imports from module A
- **THEN** the reviewer SHALL require breaking the cycle by extracting shared code

### Requirement: Svelte Component Structure

Every Svelte component SHALL follow a consistent internal structure.

1. `<script>` block: imports → props → local state → reactive declarations → lifecycle → handlers
2. Template markup
3. `<style>` block

Within the script block:
- Props SHALL be declared at the top.
- Reactive statements SHALL be grouped together after state declarations.
- Event handlers SHALL be defined as named functions, not inline arrow functions in the template (unless trivially short — one expression).

#### Scenario: Inline complex handler in template

- **WHEN** a template event handler contains more than a single expression
- **THEN** the reviewer SHALL require extracting it to a named function in the script block

#### Scenario: Mixed declaration order in script block

- **WHEN** imports, props, state, and handlers are interleaved without clear grouping
- **THEN** the reviewer SHALL require reordering to follow the standard structure

### Requirement: CSS And Styling Discipline

Component styles SHALL be scoped, minimal, and token-based.

- Use Svelte scoped `<style>` by default. Global styles belong only in `app.css`.
- Use CSS custom properties (design tokens) from `app.css` for colors, spacing, radii, and typography.
- MUST NOT use `!important` unless overriding third-party styles with no alternative.
- MUST NOT duplicate token values as magic numbers.
- Prefer CSS grid/flexbox over absolute positioning.
- Media queries SHALL use the breakpoints defined in the token set.

#### Scenario: Hardcoded color or spacing value

- **WHEN** a component style uses a hardcoded color hex, rgb, or pixel spacing that exists as a design token
- **THEN** the reviewer SHALL require using the token variable instead

#### Scenario: Use of !important

- **WHEN** a style rule uses `!important`
- **THEN** the reviewer SHALL require justification or removal

### Requirement: Comments And Documentation

Code SHALL be self-documenting through clear naming. Comments SHALL explain *why*, not *what*.

- MUST NOT have comments that restate the code (`// increment counter` above `counter++`).
- Complex business rules, workarounds, and non-obvious constraints SHALL have a brief comment explaining the reason.
- Public service functions and store contracts SHALL have a JSDoc summary.
- TODO/FIXME comments MUST include a ticket reference or date.

#### Scenario: Comment restates the code

- **WHEN** a comment merely describes what the next line does
- **THEN** the reviewer SHALL require removing it or replacing it with a *why* explanation

#### Scenario: TODO without reference

- **WHEN** a TODO or FIXME comment lacks a ticket reference or date
- **THEN** the reviewer SHALL require adding one or resolving the TODO

### Requirement: Defensive Coding

Code SHALL be defensive against unexpected input and state.

- Public-facing functions MUST validate their inputs at the boundary.
- Switch statements on known enums/unions MUST have a default case that throws or logs.
- Array access by index MUST guard against out-of-bounds.
- Object property access on external data (API responses, SDK events) MUST use optional chaining or explicit checks.

#### Scenario: Switch without default case

- **WHEN** a switch statement on a known set of values lacks a default case
- **THEN** the reviewer SHALL require adding a default that throws or logs an unexpected-value warning

#### Scenario: Unguarded API response access

- **WHEN** code accesses nested properties on an API response or SDK event without null checks
- **THEN** the reviewer SHALL require defensive access patterns

### Requirement: Review Checklist Integration

When reviewing frontend code, the reviewer SHALL check against this spec, the [frontend-guardrails spec](../frontend-guardrails/spec.md), and the [code-review-agent spec](../code-review-agent/spec.md). All three specs apply simultaneously. This spec covers general code quality; frontend-guardrails covers Svelte/PWA-specific rules; code-review-agent covers Matrix event architecture.

#### Scenario: Frontend code review

- **WHEN** a reviewer evaluates any frontend code change
- **THEN** they SHALL check the change against all three frontend specs
- **THEN** violations from any spec SHALL be flagged at the appropriate severity level

### Requirement: TypeScript-First Frontend Boundaries
Frontend source code SHALL prefer explicit TypeScript contracts at public module boundaries.

#### Scenario: Writing or migrating a service or store module
- **WHEN** a contributor creates or migrates a client service, store, or utility module
- **THEN** exported functions, public store contracts, and reusable helpers SHALL declare explicit TypeScript input and output types
- **THEN** unbounded `any` usage MUST NOT be introduced when a narrower type, union, or generic can express the contract

#### Scenario: Writing or migrating a Svelte component
- **WHEN** a contributor migrates a shared Svelte component or route page script to TypeScript
- **THEN** props, dispatched event payloads, and non-trivial local state SHALL use explicit TypeScript typing in the component script block

### Requirement: Migration-Time Decomposition
TypeScript migration work SHALL be used to bring client files back within the repository's frontend size and responsibility guardrails.

#### Scenario: Migrating an oversized component or module
- **WHEN** a contributor touches a client component or JS/TS module that exceeds the documented line limits during TypeScript migration
- **THEN** the contributor SHALL extract focused helpers, services, stores, or child components so the migrated structure aligns with the frontend code-quality spec
- **THEN** the contributor MUST NOT preserve an oversized file unchanged solely by converting its syntax to TypeScript

#### Scenario: Migrating browser or SDK heavy modules
- **WHEN** a contributor migrates a client module that mixes browser APIs, SDK objects, cache/storage concerns, and UI-facing normalization
- **THEN** the migration SHALL separate pure data normalization, side-effect orchestration, and browser-specific logic into smaller typed units where practical
- **THEN** hardening work at unstable runtime boundaries SHALL be considered part of the migration, not a separate optional cleanup

