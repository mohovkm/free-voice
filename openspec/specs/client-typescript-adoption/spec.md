# Client TypeScript Adoption

## Purpose

Defines the client-specific TypeScript migration expectations for the SvelteKit web application under `client/`.

## Requirements

### Requirement: TypeScript Workspace Baseline

The client workspace SHALL provide TypeScript-aware project configuration and validation commands for mixed Svelte and TypeScript source.

#### Scenario: Initializing or maintaining the client TypeScript workspace

- **WHEN** a contributor adds or updates TypeScript-bearing client code, Svelte `lang="ts"` scripts, or related tooling
- **THEN** the client workspace SHALL define TypeScript-aware configuration for editor support, type-checking, build integration, and test execution
- **THEN** the client workspace SHALL keep the established validation entry points available for maintainers

### Requirement: Shared Typed Client Contracts

The client migration SHALL introduce shared TypeScript contracts for reused client-side entities before those shapes are relied on across multiple layers.

#### Scenario: Shared domain shape is consumed across client layers

- **WHEN** routes, services, stores, and components share the same non-trivial client data shape
- **THEN** the client SHALL define and reuse an explicit typed contract for that shape instead of duplicating implicit object structures

### Requirement: Migration Validation Reporting

Client TypeScript migration work SHALL report the validation surface that was executed and the boundaries that remain weakly verified.

#### Scenario: Reporting a migration slice result

- **WHEN** a contributor completes a client TypeScript migration slice
- **THEN** the contributor SHALL report which type-aware validation, unit-test, and relevant browser-level checks were run
- **THEN** the contributor SHALL distinguish confirmed passes from environment-limited or intentionally deferred validation

### Requirement: Transitional Compatibility Controls

Temporary compatibility controls MAY exist during migration, but they SHALL be removed after the full dependent client graph has been migrated and validated.

#### Scenario: Temporary compatibility shim exists during migration

- **WHEN** a mixed JavaScript and TypeScript module graph requires a temporary shim, adapter, or compatibility configuration to keep the client working
- **THEN** that compatibility control SHALL remain explicitly scoped to the migration window
- **THEN** it SHALL be removed once all dependent modules have been migrated and validated

### Requirement: Migration-Time Decomposition

The client migration SHALL use TypeScript conversion work to improve oversized or mixed-responsibility modules rather than preserving problematic structure unchanged.

#### Scenario: Migrating an oversized or mixed-responsibility module

- **WHEN** a contributor migrates a large client module that mixes routing, storage, SDK, browser, or UI-facing responsibilities
- **THEN** the contributor SHALL extract smaller typed helpers, services, stores, or child components where practical
- **THEN** the migration MUST NOT be considered complete if the file remains oversized solely because the syntax changed to TypeScript
