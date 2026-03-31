# Raspberry Pi VoIP System

This repository uses OpenSpec for spec-driven development. Treat `openspec/specs/` as the only current-state documentation tree.

## Authoritative Documentation

- Current system specs: `openspec/specs/`
- Active changes: `openspec/changes/`
- Archived changes: `openspec/changes/archive/`

Primary references:

- `openspec/specs/architecture/spec.md`
- `openspec/specs/realtime-call-flow/spec.md`
- `openspec/specs/api-service/spec.md`
- `openspec/specs/web-client/spec.md`
- `openspec/specs/ansible-deployment/spec.md`
- `openspec/specs/media-stack/spec.md`
- `openspec/specs/service-guardrails/spec.md`
- `openspec/specs/testing-and-dod/spec.md`
- `openspec/specs/frontend-guardrails/spec.md`
- `openspec/specs/call-state-machine/spec.md`
- `openspec/specs/ansible-variables/spec.md`

## Required Workflow

- Read the relevant spec in `openspec/specs/` before changing code.
- Update the affected spec in the same change whenever implementation changes documented behavior.
- Use `openspec new change "<name>"` to propose new work.
- Do not use `openspec/changes/archive/` for current behavior unless the task explicitly asks for historical context.

## Operational Rules

- Never access the database directly; use FastAPI endpoints.
- Never replace directory `synchronize` flows with file-by-file copy loops.
- Treat `AGENTS.md` as the single repository-local agent guidance file; do not duplicate it in tool-specific variants.

## Key Commands

- Setup: `make setup`
- Ping host: `make ping`
- Deploy: `ansible-playbook ansible/playbooks/<name>.yml -i ansible/inventory/hosts.yml`
- Validate all: `make validate`
- Lint: `make lint`
- Format: `make format`
- API tests: `cd backend && uv run pytest`
- Client checks: `cd client && npm run check && npm run test:unit`
- API restart: `systemctl restart voip-api`

## Session Continuity

- Promote permanent behavior and rules into `openspec/specs/`.
- Archive completed changes via `openspec archive`.
- Do not append long-running memory logs to `AGENTS.md`; keep this file as workflow guidance only.
