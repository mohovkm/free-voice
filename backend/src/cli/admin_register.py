#!/usr/bin/env python3
"""
Admin CLI: register a new user and print a password-reset link.

The user is created with email_verified=true and no matrix_user_id, so on
first login they are immediately prompted to set their password (which also
provisions their Matrix account).

Usage:
    python3 /opt/voip-api/admin_register.py <email> ["Display Name"]
    python3 /opt/voip-api/admin_register.py --reset <email>

--reset   Re-issues a password-reset link for an existing user (e.g. a legacy
          user migrated from the old DB who has not yet set a password).
          Works for both unmigrated (matrix_user_id=NULL) and fully active accounts.

Display name is optional — defaults to the local part of the email (e.g. "alice"
for alice@example.com).  The user can update it after first login.

Examples:
    python3 /opt/voip-api/admin_register.py alice@example.com
    python3 /opt/voip-api/admin_register.py alice@example.com "Alice Smith"
    python3 /opt/voip-api/admin_register.py --reset alice@example.com
"""

import asyncio
import hashlib
import os
import secrets
import sys
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

# Allow running from the same directory as the API modules
sys.path.insert(0, "/opt/voip-api")


def _load_env_file(path: str = "/etc/voip-api/env") -> None:
    """Load KEY=VALUE pairs from the API env file into os.environ (if not already set)."""
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                if key and key not in os.environ:
                    os.environ[key] = value.strip()
    except OSError:
        pass  # env file not present (e.g. local dev) — caller must supply env


_load_env_file()

from helpers import config
from helpers import dao


def _issue_reset_token(cfg, user_id: str) -> str:
    """Store a fresh password-reset token and return the plaintext token."""
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires = datetime.now(UTC) + timedelta(hours=cfg.password_reset_ttl_hours)
    return token, token_hash, expires


async def cmd_register(email: str, display_name: str | None) -> None:
    if not display_name:
        display_name = email.split("@")[0]
    config.init()
    await dao.init_pool()
    try:
        cfg = config.get()

        existing = await dao.fetch_one("user_by_email", (email,))
        if existing:
            print(f"ERROR: {email} is already registered. Use --reset to re-issue a link.", file=sys.stderr)
            sys.exit(1)

        user_id = str(uuid.uuid4())
        # Temporary random password — user will never log in with it because
        # matrix_user_id is not set, which forces reset_required on first login.
        temp_password_hash = secrets.token_hex(32)

        await dao.execute(
            "user_insert",
            (user_id, email, temp_password_hash, display_name),
        )
        # Mark verified immediately — no email verification step for admin-created accounts.
        await dao.execute("user_mark_verified", (user_id,))

        # Issue a password reset token so the admin can send the link directly.
        token, token_hash, expires = _issue_reset_token(cfg, user_id)
        await dao.execute("user_set_password_reset", (token_hash, expires, user_id))

        link = f"{cfg.public_base_url}/reset-password?token={quote(token)}"
        print(f"Created: {email} ({display_name})")
        print(f"Send this link to the user (expires in {cfg.password_reset_ttl_hours}h):")
        print(f"  {link}")
    finally:
        await dao.close_pool()


async def cmd_reset(email: str) -> None:
    config.init()
    await dao.init_pool()
    try:
        cfg = config.get()

        user = await dao.fetch_one("user_by_email", (email,))
        if not user:
            print(f"ERROR: {email} not found", file=sys.stderr)
            sys.exit(1)
        if not user.get("email_verified_at"):
            # Mark verified so the reset link works — old-DB users may not have this set
            await dao.execute("user_mark_verified", (user["id"],))

        token, token_hash, expires = _issue_reset_token(cfg, user["id"])
        await dao.execute("user_set_password_reset", (token_hash, expires, user["id"]))

        link = f"{cfg.public_base_url}/reset-password?token={quote(token)}"
        status = "unmigrated" if not user.get("matrix_user_id") else "active"
        print(f"Reset issued for: {email} (status: {status})")
        print(f"Send this link to the user (expires in {cfg.password_reset_ttl_hours}h):")
        print(f"  {link}")
    finally:
        await dao.close_pool()


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--reset":
        if len(args) != 2:
            print(f"Usage: {sys.argv[0]} --reset <email>", file=sys.stderr)
            sys.exit(1)
        asyncio.run(cmd_reset(args[1]))
    else:
        if len(args) < 1 or len(args) > 2:
            print(f'Usage: {sys.argv[0]} <email> ["Display Name"]', file=sys.stderr)
            sys.exit(1)
        asyncio.run(cmd_register(args[0], args[1] if len(args) == 2 else None))
