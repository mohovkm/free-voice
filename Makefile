# Raspberry Pi VoIP System - Makefile

.PHONY: help setup ping lint format format-check validate clean \
	install-prep install-network install-security install-duckdns install-nginx \
	install-api install-client install-database install-dendrite install-livekit

ANSIBLE_CONFIG_PATH := ansible/ansible.cfg
ANSIBLE_INVENTORY := ansible/inventory/hosts.yml
ANSIBLE := ANSIBLE_CONFIG=$(ANSIBLE_CONFIG_PATH) ansible -i $(ANSIBLE_INVENTORY)
ANSIBLE_PLAYBOOK := ANSIBLE_CONFIG=$(ANSIBLE_CONFIG_PATH) ansible-playbook -i $(ANSIBLE_INVENTORY)

help:
	@echo "Raspberry Pi VoIP System - Make targets:"
	@echo ""
	@echo "  setup            - Install Ansible Galaxy requirements"
	@echo "  ping             - Test Ansible connectivity to the raspberrypi host"
	@echo "  lint             - Run client linting and backend Ruff checks"
	@echo "  format           - Format client and backend code"
	@echo "  format-check     - Check formatting without writing changes"
	@echo "  validate         - Run client validation, backend Ruff, and pytest"
	@echo "  install-prep     - Run system preparation playbook"
	@echo "  install-network  - Run network configuration playbook"
	@echo "  install-security - Run security and firewall playbook"
	@echo "  install-duckdns  - Run DuckDNS and TLS playbook"
	@echo "  install-nginx    - Deploy nginx role"
	@echo "  install-api      - Deploy FastAPI role"
	@echo "  install-client   - Deploy web client role"
	@echo "  install-database - Deploy database role"
	@echo "  install-dendrite - Deploy Dendrite role"
	@echo "  install-livekit  - Deploy LiveKit role"
	@echo "  clean            - Remove local retry files and generated reports"

setup:
	ANSIBLE_CONFIG=$(ANSIBLE_CONFIG_PATH) ansible-galaxy install -r ansible/requirements.yml

lint:
	cd client && npm run lint
	cd backend && uv run ruff check src tests

format:
	cd client && npm run format
	cd backend && uv run ruff format src tests
	cd backend && uv run ruff check --fix src tests

format-check:
	cd client && npm run format:check
	cd backend && uv run ruff format --check src tests

validate:
	cd client && npm run validate
	cd backend && uv run ruff check src tests
	cd backend && uv run pytest

ping:
	@if [ ! -f config.yml ]; then \
		echo "Error: config.yml not found. Copy config.yml.example to config.yml first."; \
		exit 1; \
	fi
	$(ANSIBLE) raspberrypi -m ping

install-prep:
	$(ANSIBLE_PLAYBOOK) ansible/playbooks/01-system-prep.yml

install-network:
	$(ANSIBLE_PLAYBOOK) ansible/playbooks/02-network.yml

install-security:
	$(ANSIBLE_PLAYBOOK) ansible/playbooks/03-security.yml

install-duckdns:
	$(ANSIBLE_PLAYBOOK) ansible/playbooks/04-duckdns-ssl.yml

install-nginx:
	$(ANSIBLE_PLAYBOOK) ansible/playbooks/05-nginx.yml

install-api:
	$(ANSIBLE_PLAYBOOK) ansible/playbooks/07-api.yml

install-client:
	$(ANSIBLE_PLAYBOOK) ansible/playbooks/06-client.yml

install-database:
	$(ANSIBLE_PLAYBOOK) ansible/playbooks/08-database.yml

install-dendrite:
	$(ANSIBLE_PLAYBOOK) ansible/playbooks/09-dendrite.yml

install-livekit:
	$(ANSIBLE_PLAYBOOK) ansible/playbooks/10-livekit.yml

clean:
	find . -type f -name "*.retry" -delete
	rm -rf client/coverage
	rm -rf client/playwright-report-real
	rm -rf /tmp/ansible_facts
	@echo "Cleaned temporary files"
