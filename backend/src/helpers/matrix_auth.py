"""Matrix homeserver helpers for auth, provisioning, and token validation."""

import httpx

from . import config


class MatrixAuthError(Exception):
    """Homeserver request failed or returned an unsupported response."""

    def __init__(self, detail: str, status_code: int = 502):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class MatrixUserExistsError(MatrixAuthError):
    """Provisioning attempted to create an already-existing user."""


def full_user_id(localpart: str) -> str:
    return f"@{localpart}:{config.get().node_domain}"


async def _request(
    method: str, path: str, *, json_body: dict | None = None, token: str | None = None
) -> dict:
    cfg = config.get()
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.request(
                method,
                f"{cfg.dendrite_url}{path}",
                headers=headers,
                json=json_body,
            )
    except httpx.RequestError as exc:
        raise MatrixAuthError(f"Dendrite unreachable: {exc}", status_code=503) from exc

    body = response.json() if response.content else {}
    if response.status_code >= 400:
        detail = (
            body.get("error") or body.get("errcode") or f"Dendrite returned {response.status_code}"
        )
        if body.get("errcode") == "M_USER_IN_USE":
            raise MatrixUserExistsError(detail, status_code=409)
        if response.status_code in {401, 403}:
            fallback = (
                "Invalid Matrix token"
                if path.endswith("/account/whoami")
                else "Invalid Matrix credentials"
            )
            raise MatrixAuthError(body.get("error") or fallback, status_code=401)
        raise MatrixAuthError(detail, status_code=502)
    return body


async def whoami(token: str) -> str:
    body = await _request("GET", "/_matrix/client/v3/account/whoami", token=token)
    user_id = body.get("user_id")
    if not user_id:
        raise MatrixAuthError("Dendrite response missing user_id")
    return user_id


async def login(identifier: str, password: str) -> dict:
    body = await _request(
        "POST",
        "/_matrix/client/v3/login",
        json_body={
            "type": "m.login.password",
            "user": identifier,
            "password": password,
            "initial_device_display_name": "FREE VOICE",
        },
    )
    if not body.get("access_token") or not body.get("user_id") or not body.get("device_id"):
        raise MatrixAuthError("Dendrite login response missing session fields")
    return body


async def register(localpart: str, password: str) -> dict:
    payload = {"username": localpart, "password": password}
    cfg = config.get()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{cfg.dendrite_url}/_matrix/client/v3/register", json=payload
            )
    except httpx.RequestError as exc:
        raise MatrixAuthError(f"Dendrite unreachable: {exc}", status_code=503) from exc

    body = response.json() if response.content else {}
    if response.status_code == 401 and body.get("session"):
        body = await _request(
            "POST",
            "/_matrix/client/v3/register",
            json_body={
                "username": localpart,
                "password": password,
                "auth": {"type": "m.login.dummy", "session": body["session"]},
            },
        )
    elif response.status_code >= 400:
        detail = (
            body.get("error") or body.get("errcode") or f"Dendrite returned {response.status_code}"
        )
        if body.get("errcode") == "M_USER_IN_USE":
            raise MatrixUserExistsError(detail, status_code=409)
        raise MatrixAuthError(detail, status_code=502)

    if not body.get("access_token") or not body.get("user_id") or not body.get("device_id"):
        raise MatrixAuthError("Dendrite register response missing session fields")
    return body


async def set_display_name(user_id: str, token: str, display_name: str) -> None:
    await _request(
        "PUT",
        f"/_matrix/client/v3/profile/{user_id}/displayname",
        json_body={"displayname": display_name},
        token=token,
    )


async def _bootstrap_admin_account(admin_localpart: str, admin_password: str) -> None:
    """Create the service admin account via the Synapse-compat HMAC shared-secret flow.

    Uses /_synapse/admin/v1/register (GET nonce + POST MAC).  Safe to call when the
    account already exists — M_USER_IN_USE is silently ignored.
    """
    import hashlib as _hashlib
    import hmac as _hmac

    cfg = config.get()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{cfg.dendrite_url}/_synapse/admin/v1/register")
        if resp.status_code != 200:
            raise MatrixAuthError(
                f"Failed to fetch admin registration nonce: {resp.status_code}", status_code=502
            )
        nonce = resp.json().get("nonce", "")

        joined = "\x00".join([nonce, admin_localpart, admin_password, "admin"])
        mac = _hmac.new(
            cfg.dendrite_registration_secret.encode(),
            joined.encode(),
            _hashlib.sha1,
        ).hexdigest()

        reg_resp = await client.post(
            f"{cfg.dendrite_url}/_synapse/admin/v1/register",
            json={
                "nonce": nonce,
                "username": admin_localpart,
                "password": admin_password,
                "admin": True,
                "mac": mac,
            },
        )
        body = reg_resp.json() if reg_resp.content else {}
        if reg_resp.status_code not in (200, 201) and body.get("errcode") != "M_USER_IN_USE":
            raise MatrixAuthError(f"Admin account bootstrap failed: {body}", status_code=502)


async def _get_admin_token() -> str:
    """Return a valid Matrix access token for the service admin account.

    Derives a stable admin password from the registration_shared_secret so no
    extra vault variable is required.  Bootstraps the account on first use.
    """
    import hashlib as _hashlib
    import hmac as _hmac

    cfg = config.get()
    admin_localpart = "freevoice-api-admin"
    admin_password = _hmac.new(
        cfg.dendrite_registration_secret.encode(),
        b"freevoice-api-admin-v1",
        _hashlib.sha256,
    ).hexdigest()
    admin_user_id = full_user_id(admin_localpart)

    try:
        session = await login(admin_user_id, admin_password)
        return session["access_token"]
    except MatrixAuthError as exc:
        if exc.status_code != 401:
            raise
    # Account does not exist yet — bootstrap it, then log in.
    await _bootstrap_admin_account(admin_localpart, admin_password)
    session = await login(admin_user_id, admin_password)
    return session["access_token"]


async def sync_password_with_cli(localpart: str, password: str) -> None:
    """Reset a Dendrite user's password via the admin API.

    Replaces the removed create-account CLI tool (dropped in Dendrite 0.13).
    Uses /_dendrite/admin/resetPassword/{userID} with a service-admin Bearer token.
    """
    cfg = config.get()
    admin_token = await _get_admin_token()
    user_id = full_user_id(localpart)
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{cfg.dendrite_url}/_dendrite/admin/resetPassword/{user_id}",
            json={"password": password, "logout_devices": False},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        if not resp.is_success:
            body = resp.json() if resp.content else {}
            raise MatrixAuthError(f"Dendrite password reset failed: {body}", status_code=502)


async def _register_via_shared_secret(localpart: str, password: str) -> dict:
    """Register a regular (non-admin) user via the shared-secret HMAC path.

    Works even when registration_disabled=true because the shared-secret endpoint
    is an admin-only channel, not the public registration flow.
    Raises MatrixUserExistsError if the account already exists.
    """
    import hashlib as _hashlib
    import hmac as _hmac

    cfg = config.get()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{cfg.dendrite_url}/_synapse/admin/v1/register")
        if resp.status_code != 200:
            raise MatrixAuthError(
                f"Failed to fetch registration nonce: {resp.status_code}", status_code=502
            )
        nonce = resp.json().get("nonce", "")

        joined = "\x00".join([nonce, localpart, password, "notadmin"])
        mac = _hmac.new(
            cfg.dendrite_registration_secret.encode(),
            joined.encode(),
            _hashlib.sha1,
        ).hexdigest()

        reg_resp = await client.post(
            f"{cfg.dendrite_url}/_synapse/admin/v1/register",
            json={"nonce": nonce, "username": localpart, "password": password, "admin": False, "mac": mac},
        )
        body = reg_resp.json() if reg_resp.content else {}
        if reg_resp.status_code not in (200, 201):
            if body.get("errcode") == "M_USER_IN_USE":
                raise MatrixUserExistsError(body.get("error", "User exists"), status_code=409)
            raise MatrixAuthError(f"Registration failed: {body}", status_code=502)
        return body


async def ensure_account(localpart: str, password: str, display_name: str) -> dict:
    user_id = full_user_id(localpart)
    try:
        session = await _register_via_shared_secret(localpart, password)
    except MatrixUserExistsError:
        try:
            session = await login(user_id, password)
        except MatrixAuthError as exc:
            if exc.status_code != 401:
                raise
            await sync_password_with_cli(localpart, password)
            session = await login(user_id, password)
    await set_display_name(session["user_id"], session["access_token"], display_name)
    return session
