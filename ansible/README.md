# Ansible Workspace

This workspace owns deployment.

- `inventory/`: hosts and shared variables
- `playbooks/`: ordered entry points for provisioning and rollout
- `roles/`: service and infrastructure deployment boundaries
- `ansible.cfg`: local repo-scoped defaults for inventory, roles, fact cache, and vault password file

What is deployed from here:

- `nginx`: TLS termination, static client serving, reverse proxying
- `client`: builds the Svelte client from `client/` and deploys the static artifact
- `api`: deploys the FastAPI service from `backend/`, installs `uv`, syncs dependencies, and manages the `voip-api` systemd unit
- `database`: database service and schema prerequisites
- `dendrite`: Matrix homeserver and its systemd service
- `livekit`: real-time media infrastructure for calls
- `duckdns_ssl`: DNS and certificate automation
- `network`, `security`, `system_prep`: host preparation, firewalling, and baseline machine setup

How deployment is structured:

- playbooks are sequential and meant to be readable from `01-...` to `10-...`
- infrastructure layers are separated into roles so partial redeploys stay targeted
- app deploys are source-of-truth deploys:
  - client role builds from `client/`
  - api role syncs `backend/` and runs `uv sync --no-dev`
- systemd is part of the deployment contract; service roles are expected to leave the target units running

Common commands:

```bash
make ping
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook -i ansible/inventory/hosts.yml ansible/playbooks/<name>.yml
```

Deploy all playbooks in order:

```bash
for play in ansible/playbooks/0*.yml ansible/playbooks/10-*.yml; do
  ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook -i ansible/inventory/hosts.yml "$play"
done
```

Redeploy only one layer:

```bash
make install-client
make install-api
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook -i ansible/inventory/hosts.yml ansible/playbooks/09-dendrite.yml
```

Connect to the host through Ansible:

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg ansible -i ansible/inventory/hosts.yml pi -m ping
ANSIBLE_CONFIG=ansible/ansible.cfg ansible -i ansible/inventory/hosts.yml pi -m shell -a 'systemctl status voip-api --no-pager'
ANSIBLE_CONFIG=ansible/ansible.cfg ansible -i ansible/inventory/hosts.yml pi -m shell -a 'journalctl -u dendrite -n 100 --no-pager'
```

Pass a different inventory explicitly:

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook -i path/to/hosts.yml ansible/playbooks/07-api.yml
ANSIBLE_CONFIG=ansible/ansible.cfg ansible -i path/to/hosts.yml pi -m shell -a 'hostname'
```

Ansible Vault:

- keep encrypted secrets in `ansible/inventory/group_vars/all/vault.yml`
- create or edit it with:

```bash
ansible-vault create ansible/inventory/group_vars/all/vault.yml
ansible-vault edit ansible/inventory/group_vars/all/vault.yml
```

- this repo is already configured to use `ansible/.vault_pass` through `ansible/ansible.cfg`
- to avoid entering the vault password every time, put the password into `ansible/.vault_pass` locally and keep that file out of version control
- if you do not want to use the file-based approach, remove `vault_password_file` from `ansible/ansible.cfg` locally and pass `--ask-vault-pass` manually

Operational note:

- for reliable local syntax checks in restricted environments, use repo-scoped temp paths:

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg \
ANSIBLE_LOCAL_TEMP=/tmp/.ansible-local \
ANSIBLE_REMOTE_TEMP=/tmp/.ansible-remote \
ansible-playbook -i ansible/inventory/hosts.yml ansible/playbooks/07-api.yml --syntax-check
```

Read [playbooks/README.md](playbooks/README.md) for the playbook sequence.
