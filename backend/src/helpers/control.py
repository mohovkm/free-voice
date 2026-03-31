"""Business logic — auth, registration, JWT, contacts, links, push."""

import asyncio
import hashlib
import logging
import re
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

import bcrypt
import jwt
from fastapi import Header, HTTPException

from . import config
from . import dao
from . import mailer
from . import matrix_auth

logger = logging.getLogger(__name__)

_background_tasks: set[asyncio.Task] = set()


class EmailNotVerifiedError(Exception):
    """Raised when a user attempts to authenticate without verifying email."""


class PasswordResetRequiredError(Exception):
    """Raised when a legacy user must reset password before Matrix login."""


# TTL cache for user existence checks (user_id -> expiry timestamp)
_user_cache: dict[str, float] = {}
_USER_CACHE_TTL = 60  # seconds


# --- Password ---


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


# --- JWT ---


def _create_token(sub: str, expires_delta: timedelta, typ: str = "access") -> str:
    cfg = config.get()
    exp = datetime.now(UTC) + expires_delta
    return jwt.encode(
        {"sub": sub, "exp": exp, "typ": typ}, cfg.jwt_secret, algorithm=cfg.jwt_algorithm
    )


def create_access_token(user_id: str) -> str:
    cfg = config.get()
    return _create_token(user_id, timedelta(minutes=cfg.access_token_expire_minutes), "access")


def create_refresh_token(user_id: str) -> str:
    cfg = config.get()
    return _create_token(user_id, timedelta(days=cfg.refresh_token_expire_days), "refresh")


def decode_token(token: str, expected_type: str = "access") -> str | None:
    cfg = config.get()
    try:
        payload = jwt.decode(token, cfg.jwt_secret, algorithms=[cfg.jwt_algorithm])
        if payload.get("typ") != expected_type:
            return None
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


async def get_current_user_id(authorization: str = Header()) -> str:
    """FastAPI dependency — validate JWT + verify user exists (cached 1min)."""
    token = authorization.removeprefix("Bearer ").strip()
    user_id = decode_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    now = time.monotonic()
    if _user_cache.get(user_id, 0) > now:
        return user_id
    user = await dao.fetch_one("user_by_id", (user_id,))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    _user_cache[user_id] = now + _USER_CACHE_TTL
    return user_id


# --- TURN helper ---

# --- Auth ---


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _public_link(path: str) -> str:
    cfg = config.get()
    return f"{cfg.public_base_url}{path}"


async def _send_verification_email(email: str, token: str) -> bool:
    cfg = config.get()
    link = _public_link(f"/verify?token={quote(token)}")
    subject = "Verify your FREE VOICE email"
    body = (
        "Welcome to FREE VOICE!\n\n"
        "Please verify your email by opening the link below. "
        f"It expires in {cfg.email_verify_ttl_hours} hours.\n"
        "If you don't see it, check your spam folder.\n\n"
        f"{link}\n\n"
        "If you did not create this account, you can ignore this email."
    )
    try:
        await mailer.send_email(email, subject, body)
        return True
    except Exception:
        logger.exception("Failed to send verification email to %s", email)
        return False


async def _send_password_reset_email(email: str, token: str) -> bool:
    cfg = config.get()
    link = _public_link(f"/reset-password?token={quote(token)}")
    subject = "Reset your FREE VOICE password"
    body = (
        "We received a request to reset your FREE VOICE password.\n\n"
        "Open the link below to choose a new password. "
        f"It expires in {cfg.password_reset_ttl_hours} hours.\n\n"
        f"{link}\n\n"
        "If you did not request this reset, you can ignore this email."
    )
    try:
        await mailer.send_email(email, subject, body)
        return True
    except Exception:
        logger.exception("Failed to send password reset email to %s", email)
        return False


async def _issue_verification(email: str, user_id: str) -> dict:
    cfg = config.get()
    token = secrets.token_urlsafe(32)
    token_hash = _hash_token(token)
    expires = datetime.now(UTC) + timedelta(hours=cfg.email_verify_ttl_hours)
    await dao.execute("user_set_verification", (token_hash, expires, user_id))
    sent = await _send_verification_email(email, token)
    return {
        "sent": sent,
        "debug_verification_link": _public_link(f"/verify?token={quote(token)}")
        if cfg.email_debug and sent
        else None,
    }


def _normalise_matrix_localpart(email: str) -> str:
    localpart = email.split("@", 1)[0].lower()
    localpart = re.sub(r"[^a-z0-9._=-]+", "-", localpart).strip("-.=")
    return localpart or "user"


async def _choose_matrix_localpart(email: str) -> str:
    base = _normalise_matrix_localpart(email)
    existing = await dao.fetch_one("user_by_matrix_localpart", (base,))
    if not existing or existing.get("email") == email:
        return base

    suffix = hashlib.sha1(email.encode()).hexdigest()[:8]
    candidate = f"{base}-{suffix}"
    existing = await dao.fetch_one("user_by_matrix_localpart", (candidate,))
    if not existing or existing.get("email") == email:
        return candidate

    for idx in range(2, 10):
        candidate = f"{base}-{suffix[:6]}-{idx}"
        existing = await dao.fetch_one("user_by_matrix_localpart", (candidate,))
        if not existing or existing.get("email") == email:
            return candidate
    raise RuntimeError("Unable to assign Matrix localpart")


async def _issue_password_reset(email: str, user_id: str) -> dict:
    cfg = config.get()
    token = secrets.token_urlsafe(32)
    token_hash = _hash_token(token)
    expires = datetime.now(UTC) + timedelta(hours=cfg.password_reset_ttl_hours)
    await dao.execute("user_set_password_reset", (token_hash, expires, user_id))
    sent = await _send_password_reset_email(email, token)
    return {
        "sent": sent,
        "debug_reset_link": _public_link(f"/reset-password?token={quote(token)}")
        if cfg.email_debug and sent
        else None,
    }


async def _migrate_user_to_matrix(user: dict, password: str) -> dict:
    localpart = user.get("matrix_localpart") or await _choose_matrix_localpart(user["email"])
    session = await matrix_auth.ensure_account(localpart, password, user["display_name"])
    await dao.execute(
        "user_set_matrix_identity",
        (
            session["user_id"],
            localpart,
            "active",
            _hash_password(password),
            user["id"],
        ),
    )
    refreshed = await dao.fetch_one("user_by_id", (user["id"],))
    return refreshed or {
        **user,
        "matrix_user_id": session["user_id"],
        "matrix_localpart": localpart,
    }


async def register_user(email: str, password: str, display_name: str) -> dict:
    existing = await dao.fetch_one("user_by_email", (email,))
    if existing:
        raise ValueError("Email already registered")
    user_id = str(uuid.uuid4())
    await dao.execute("user_insert", (user_id, email, _hash_password(password), display_name))
    await _convert_invitations_on_register(email, user_id)
    verification = await _issue_verification(email, user_id)
    return {
        "id": user_id,
        "email": email,
        "display_name": display_name,
        "verification_sent": verification["sent"],
        "debug_verification_link": verification["debug_verification_link"],
    }


async def create_debug_legacy_user(email: str, password: str, display_name: str) -> dict:
    cfg = config.get()
    if not cfg.email_debug:
        raise PermissionError("Debug auth fixtures disabled")
    existing = await dao.fetch_one("user_by_email", (email,))
    if existing:
        raise ValueError("Email already registered")

    user_id = str(uuid.uuid4())
    await dao.execute("user_insert", (user_id, email, _hash_password(password), display_name))
    await dao.execute("user_mark_verified", (user_id,))
    return {"id": user_id, "email": email, "display_name": display_name, "verified": True}


async def authenticate_user(email: str, password: str) -> dict | None:
    user = await dao.fetch_one("user_by_email", (email,))
    if not user or not user.get("password_hash"):
        return None
    if not _verify_password(password, user["password_hash"]):
        return None
    if not user.get("email_verified_at"):
        raise EmailNotVerifiedError("Email not verified")
    return user


async def request_password_reset(email: str) -> dict:
    user = await dao.fetch_one("user_by_email", (email,))
    if not user or not user.get("email_verified_at"):
        return {"sent": False, "debug_reset_link": None}
    return await _issue_password_reset(email, user["id"])


async def confirm_password_reset(token: str, new_password: str) -> dict:
    token_hash = _hash_token(token)
    user = await dao.fetch_one("user_by_password_reset_token", (token_hash,))
    if not user:
        raise LookupError("Invalid reset link")
    expires = user.get("password_reset_expires_at")
    now = datetime.now(UTC).replace(tzinfo=None)
    if not expires or expires.replace(tzinfo=None) < now:
        raise ValueError("Reset link expired")
    if not user.get("email_verified_at"):
        raise PermissionError("Email not verified")
    return await _migrate_user_to_matrix(user, new_password)


async def authenticate_matrix_user(email: str, password: str) -> dict:
    # Identifier may be an email, a full Matrix user ID (@user:server), or a plain localpart.
    identifier = email.strip()
    if identifier.startswith("@") and ":" in identifier:
        user = await dao.fetch_one("user_by_matrix_user_id", (identifier,))
    else:
        user = await dao.fetch_one("user_by_email", (identifier,))
        if not user:
            user = await dao.fetch_one("user_by_matrix_localpart", (identifier,))
    if not user:
        return {"status": "invalid"}
    if not user.get("email_verified_at"):
        raise EmailNotVerifiedError("Email not verified")
    if not user.get("matrix_user_id"):
        raise PasswordResetRequiredError("Password reset required")

    session = await matrix_auth.login(user["matrix_user_id"], password)
    return {
        "status": "ok",
        "access_token": session["access_token"],
        "user_id": session["user_id"],
        "device_id": session["device_id"],
        "homeserver": config.get().public_base_url,  # public nginx URL — browser must not see internal dendrite_url
    }


async def resend_verification(email: str) -> dict:
    user = await dao.fetch_one("user_by_email", (email,))
    if not user or user.get("email_verified_at"):
        return {"sent": False, "debug_verification_link": None}
    return await _issue_verification(email, user["id"])


async def verify_email(token: str) -> dict:
    token_hash = _hash_token(token)
    user = await dao.fetch_one("user_by_verification_token", (token_hash,))
    if not user:
        raise LookupError("Invalid verification link")
    expires = user.get("email_verification_expires_at")
    now = datetime.now(UTC).replace(tzinfo=None)
    if not expires or expires.replace(tzinfo=None) < now:
        raise ValueError("Verification link expired")
    if not user.get("email_verified_at"):
        await dao.execute("user_mark_verified", (user["id"],))
    return user


async def get_user_profile(user_id: str) -> dict | None:
    return await dao.fetch_one("user_by_id", (user_id,))


async def get_current_matrix_user(authorization: str = Header()) -> dict:
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    try:
        matrix_user_id = await matrix_auth.whoami(token)
    except matrix_auth.MatrixAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    user = await dao.fetch_one("user_by_matrix_user_id", (matrix_user_id,))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def get_optional_matrix_user(authorization: str = Header()) -> dict | None:
    """Validate a Matrix Bearer token and return the legacy DB user, or None if the user
    has no legacy DB record.  Raises 401 only for invalid/expired tokens, not for
    authenticated users that simply have no legacy row."""
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    try:
        matrix_user_id = await matrix_auth.whoami(token)
    except matrix_auth.MatrixAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return await dao.fetch_one("user_by_matrix_user_id", (matrix_user_id,))


async def delete_account(user_id: str) -> None:
    user = await dao.fetch_one("user_by_id", (user_id,))
    if not user:
        raise LookupError("User not found")
    await dao.execute("user_delete", (user_id,))


# --- Contacts ---


async def add_contact(owner_id: str, email: str) -> dict:
    """Request contact with a local user, or create an invitation for an unknown email."""
    user = await dao.fetch_one("user_by_email", (email,))
    if user and user["id"] == owner_id:
        raise ValueError("Cannot add yourself as contact")
    if user:
        # Check if target already has requester as accepted contact → auto-accept both sides
        me = await dao.fetch_one("user_by_id", (owner_id,))
        reverse = await dao.fetch_one("contact_reverse_check", (user["id"], me["email"]))
        if reverse and reverse["status"] == "accepted":
            # Auto-accept: insert/update both directions as accepted
            await dao.execute("contact_accept_reverse", (owner_id, user["id"], user["email"]))
            await dao.execute("contact_accept_reverse", (user["id"], owner_id, me["email"]))
            return {
                "status": "accepted",
                "email": user["email"],
                "display_name": user["display_name"],
                "invite_link": None,
                "notify_user_id": None,
            }
        await dao.execute("contact_upsert", (owner_id, user["id"], user["email"]))
        return {
            "status": "pending",
            "email": user["email"],
            "display_name": user["display_name"],
            "invite_link": None,
            "notify_user_id": user["id"],
        }
    # Unknown email — create invitation
    token = secrets.token_urlsafe(32)
    expires = datetime.now(UTC) + timedelta(days=30)
    await dao.execute("contact_invite_insert", (owner_id, email, token, expires))
    node = config.get().node_domain
    return {
        "status": "invited",
        "email": email,
        "display_name": None,
        "invite_link": f"https://{node}/invite/{token}",
        "notify_user_id": None,
    }


async def list_matrix_bootstrap_contacts(owner_id: str) -> list[dict]:
    rows = await dao.fetch_all("matrix_bootstrap_contacts", (owner_id,))
    return [
        {
            "email": row["email"],
            "display_name": row["display_name"],
            "matrix_user_id": row["matrix_user_id"],
        }
        for row in rows
    ]


async def list_contact_requests(user_id: str) -> list[dict]:
    rows = await dao.fetch_all("contact_requests_incoming", (user_id,))
    return [
        {
            "id": r["id"],
            "email": r["email"],
            "display_name": r["display_name"],
            "added_at": str(r["added_at"]),
        }
        for r in rows
    ]


async def contact_requests_count(user_id: str) -> int:
    row = await dao.fetch_one("contact_requests_count", (user_id,))
    return row["cnt"] if row else 0


async def accept_contact_request(user_id: str, requester_email: str) -> dict:
    """Accept incoming request: mark requester→me as accepted, create reverse row."""
    requester = await dao.fetch_one("user_by_email", (requester_email,))
    if not requester:
        raise LookupError("User not found")
    me = await dao.fetch_one("user_by_id", (user_id,))
    # Mark the incoming request (requester→me) as accepted
    updated = await dao.execute("contact_accept", (requester["id"], me["email"]))
    if not updated:
        raise LookupError("No pending request from this user")
    # Create reverse row (me → requester) as accepted
    await dao.execute("contact_accept_reverse", (user_id, requester["id"], requester["email"]))
    return {
        "notify_user_id": requester["id"],
        "by_email": me["email"],
        "by_name": me["display_name"],
    }


async def reject_contact_request(user_id: str, requester_email: str) -> None:
    requester = await dao.fetch_one("user_by_email", (requester_email,))
    if not requester:
        raise LookupError("User not found")
    await dao.execute("contact_delete", (requester["id"], await _email_of(user_id)))


async def delete_contact(owner_id: str, email: str) -> bool:
    return await dao.execute("contact_delete", (owner_id, email)) > 0


async def get_invite(token: str) -> dict:
    row = await dao.fetch_one("contact_by_token", (token,))
    if not row:
        raise LookupError("Invalid or expired invitation")
    if row["invite_expires_at"] and row["invite_expires_at"].replace(tzinfo=None) < datetime.now(
        UTC
    ).replace(tzinfo=None):
        raise ValueError("Invitation expired")
    return {
        "owner_name": row["owner_name"],
        "owner_email": row["owner_email"],
        "node_domain": config.get().node_domain,
    }


async def _convert_invitations_on_register(email: str, new_user_id: str) -> None:
    """After registration, convert any 'invited' rows for this email to 'pending'."""
    rows = await dao.fetch_all("contacts_by_invited_email", (email,))
    for row in rows:
        await dao.execute("contact_upsert", (row["owner_id"], new_user_id, email))


async def _email_of(user_id: str) -> str:
    user = await dao.fetch_one("user_by_id", (user_id,))
    return user["email"] if user else ""


# --- Call links ---


async def create_call_link(owner_id: str) -> dict:
    link_id = str(uuid.uuid4())
    slug = secrets.token_urlsafe(8)
    room_name = f"link_{slug}"
    await dao.execute("call_link_insert", (link_id, owner_id, slug, room_name))
    return {
        "id": link_id,
        "slug": slug,
        "room_name": room_name,
        "max_members": 2,
        "active": True,
        "created_at": "",
    }


async def list_call_links(owner_id: str) -> list[dict]:
    links = await dao.fetch_all("call_link_list", (owner_id,))
    for link in links:
        if link.get("created_at"):
            link["created_at"] = str(link["created_at"])
    return links


async def deactivate_call_link(slug: str, owner_id: str) -> bool:
    return await dao.execute("call_link_deactivate", (slug, owner_id)) > 0


async def guest_join(slug: str, display_name: str) -> dict:
    raise NotImplementedError("Guest calling via SIP links is not available in Matrix mode")


async def cleanup_expired_guests(max_age_seconds: int = 7200) -> int:
    return 0


# --- Push notifications ---


async def subscribe_push(user_id: str, endpoint: str, p256dh: str, auth: str) -> None:
    # Remove all previous subscriptions for this user before inserting the new one.
    # Prevents stale endpoint rows accumulating when the browser creates a new push subscription.
    await dao.execute("push_sub_delete_by_user", (user_id,))
    await dao.execute("push_sub_upsert", (user_id, endpoint, p256dh, auth, user_id, p256dh, auth))


async def unsubscribe_push(user_id: str, endpoint: str) -> bool:
    return await dao.execute("push_sub_delete", (user_id, endpoint)) > 0


async def unsubscribe_push_by_endpoint(endpoint: str) -> None:
    await dao.execute("push_sub_delete_by_endpoint", (endpoint,))


async def get_push_user_by_pushkey(pushkey: str) -> str | None:
    rows = await dao.fetch_all("push_sub_user_by_pushkey", (pushkey,))
    return rows[0]["matrix_user_id"] if rows else None
