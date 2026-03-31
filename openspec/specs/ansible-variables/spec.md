# Ansible Variables

## Purpose

Defines the current configuration split used by playbooks and roles, ensuring clear ownership of operator config, shared constants, and secrets.

## Requirements

### Requirement: Variable Source Ownership

Each variable source MUST have a single clear purpose and ownership boundary.

#### Scenario: Choosing where to define a variable

- **WHEN** a contributor adds or modifies a configuration variable
- **THEN** `config.yml` SHALL be used for operator-managed deployment configuration
- **THEN** `group_vars/all.yml` SHALL be used for shared non-secret constants that do not vary by operator secret state
- **THEN** `group_vars/vault.yml` SHALL be used for encrypted secrets exposed as `vault_*` variables
- **THEN** the same value MUST NOT be duplicated across these layers without a clear ownership reason

### Requirement: Variable Access Rules

Playbooks and roles MUST access variables through the correct source based on their nature.

#### Scenario: Referencing configuration values

- **WHEN** a playbook or role references a configuration value
- **THEN** `config.*` SHALL be used for operator-provided environment values
- **THEN** `vault_*` variables SHALL be used for secrets only
- **THEN** `group_vars/all.yml` values SHALL be used for stable shared constants

### Requirement: Playbook Variable Loading Contract

Every playbook MUST load all three variable sources.

#### Scenario: Defining playbook vars_files

- **WHEN** a playbook is created or modified
- **THEN** it SHALL load the following:

```yaml
vars_files:
  - ../config.yml
  - ../group_vars/all.yml
  - ../group_vars/vault.yml
```

### Requirement: Derived Value Composition

Configuration values MUST be derived from their canonical source rather than copied as literals.

#### Scenario: Composing domain-derived values

- **WHEN** a domain name is needed in configuration
- **THEN** it SHALL be derived from `config.duckdns_subdomain`
- **THEN** TLS paths SHALL be built from the same domain source of truth

#### Scenario: Using service paths and usernames

- **WHEN** service paths or usernames are needed
- **THEN** they SHALL come from shared constants, not copied literals

### Requirement: Change Control

Variable ownership changes MUST be documented alongside the code change.

#### Scenario: Changing configuration key ownership

- **WHEN** a configuration key changes ownership
- **THEN** both the playbook usage and this document SHALL be updated in the same change

#### Scenario: Renaming secrets

- **WHEN** a secret name is changed
- **THEN** secret names SHALL remain stable unless rotation or scope requires a documented change
