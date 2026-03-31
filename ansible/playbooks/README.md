# Playbooks

This directory contains the top-level Ansible playbooks used to deploy and evolve the stack. Environment-specific values come from local `config.yml`, shared constants in `ansible/inventory/group_vars/all/vars.yml`, and encrypted secrets in `ansible/inventory/group_vars/all/vault.yml`.

Current playbooks:

- `01-system-prep.yml`: base package and host preparation
- `02-network.yml`: static network configuration
- `03-security.yml`: firewall and security hardening
- `04-duckdns-ssl.yml`: DuckDNS integration and TLS certificate setup
- `05-nginx.yml`: nginx reverse proxy and static asset serving
- `06-client.yml`: built web client deployment
- `07-api.yml`: FastAPI service deployment
- `08-database.yml`: MariaDB and related database setup
- `09-dendrite.yml`: Matrix homeserver deployment
- `10-livekit.yml`: LiveKit deployment

Run them directly with:

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook -i ansible/inventory/hosts.yml ansible/playbooks/<name>.yml
```

For the supported shortcuts, see the root [Makefile](../Makefile).
