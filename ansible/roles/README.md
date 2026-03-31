# Ansible Roles

Each role owns one deployment boundary in the stack and wraps a top-level workspace where applicable.

- `ansible/roles/api/`: deploys the source synchronized from `backend/src/`
- `ansible/roles/client/`: builds from `client/` and deploys the static artifact
- other roles under `ansible/roles/`: infrastructure and supporting services

Keep role logic, templates, handlers, and static assets inside the owning role rather than spreading deployment behavior across unrelated directories.
