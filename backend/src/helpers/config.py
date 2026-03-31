"""Application configuration — singleton dict, initialized once at startup."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    # Database
    db_host: str
    db_name: str
    db_user: str
    db_password: str
    db_pool_min: int
    db_pool_max: int

    # JWT
    jwt_secret: str
    jwt_algorithm: str
    access_token_expire_minutes: int
    refresh_token_expire_days: int

    # TURN
    turn_secret: str
    turn_host: str
    turn_ttl: int

    # VAPID (push notifications)
    vapid_private_key: str
    vapid_public_key: str
    vapid_claims_email: str
    sygnal_url: str
    sygnal_app_id: str

    # Node identity (for invitation links)
    node_domain: str
    public_base_url: str

    # LiveKit SFU
    livekit_api_key: str
    livekit_api_secret: str
    livekit_url: str

    # Dendrite Matrix homeserver (local URL for token validation)
    dendrite_url: str
    dendrite_create_account_bin: str
    dendrite_config_path: str
    dendrite_registration_secret: str

    # Email (SMTP)
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    smtp_from: str
    smtp_starttls: bool
    smtp_ssl: bool
    email_debug: bool
    email_verify_ttl_hours: int
    password_reset_ttl_hours: int
    allow_registration: bool


_state = {}


def _env_bool(key: str, default: str = "0") -> bool:
    return os.environ.get(key, default).strip().lower() in {"1", "true", "yes", "on"}


def _read_vapid_key() -> str:
    """Read VAPID private key from file (avoids systemd env multiline issues).
    pywebpush expects raw base64url EC scalar, not PEM — convert if needed."""
    key_file = os.environ.get("VAPID_KEY_FILE", "")
    if key_file and os.path.exists(key_file):
        with open(key_file) as f:
            raw = f.read().strip()
    else:
        raw = os.environ.get("VAPID_PRIVATE_KEY", "")
    if raw.startswith("-----"):
        import base64

        from cryptography.hazmat.primitives.serialization import load_pem_private_key

        key = load_pem_private_key(raw.encode(), password=None)
        scalar = key.private_numbers().private_value.to_bytes(32, "big")
        return base64.urlsafe_b64encode(scalar).rstrip(b"=").decode()
    return raw


def init() -> None:
    node_domain = os.environ["NODE_DOMAIN"]
    _state["instance"] = Config(
        db_host=os.environ.get("DB_HOST", "localhost"),
        db_name=os.environ["DB_NAME"],
        db_user=os.environ["DB_USER"],
        db_password=os.environ["DB_PASSWORD"],
        db_pool_min=1,
        db_pool_max=5,
        jwt_secret=os.environ["JWT_SECRET"],
        jwt_algorithm="HS256",
        access_token_expire_minutes=15,
        refresh_token_expire_days=7,
        turn_secret=os.environ["TURN_SECRET"],
        turn_host=os.environ.get("TURN_HOST", os.environ.get("NODE_DOMAIN", "")),
        turn_ttl=int(os.environ.get("TURN_TTL", "3600")),
        vapid_private_key=_read_vapid_key(),
        vapid_public_key=os.environ.get("VAPID_PUBLIC_KEY", ""),
        vapid_claims_email=os.environ.get("VAPID_EMAIL", "mailto:admin@freevoice.local"),
        sygnal_url=os.environ.get("SYGNAL_URL", "http://127.0.0.1:5000/_matrix/push/v1/notify"),
        sygnal_app_id=os.environ.get("SYGNAL_APP_ID", "org.freevoice.web"),
        node_domain=node_domain,
        public_base_url=os.environ.get("PUBLIC_BASE_URL", f"https://{node_domain}").rstrip("/"),
        smtp_host=os.environ.get("SMTP_HOST", ""),
        smtp_port=int(os.environ.get("SMTP_PORT", "587")),
        smtp_user=os.environ.get("SMTP_USER", ""),
        smtp_password=os.environ.get("SMTP_PASSWORD", ""),
        smtp_from=os.environ.get("SMTP_FROM", f"noreply@{node_domain}"),
        smtp_starttls=_env_bool("SMTP_STARTTLS", "1"),
        smtp_ssl=_env_bool("SMTP_SSL", "0"),
        email_debug=_env_bool("EMAIL_DEBUG", "0"),
        email_verify_ttl_hours=int(os.environ.get("EMAIL_VERIFY_TTL_HOURS", "24")),
        password_reset_ttl_hours=int(os.environ.get("PASSWORD_RESET_TTL_HOURS", "2")),
        allow_registration=_env_bool("ALLOW_REGISTRATION", "1"),
        livekit_api_key=os.environ.get("LIVEKIT_API_KEY", ""),
        livekit_api_secret=os.environ.get("LIVEKIT_API_SECRET", ""),
        livekit_url=os.environ.get("LIVEKIT_URL", ""),
        dendrite_url=os.environ.get("DENDRITE_URL", "http://127.0.0.1:8008"),
        dendrite_create_account_bin=os.environ.get(
            "DENDRITE_CREATE_ACCOUNT_BIN", "/opt/dendrite/create-account"
        ),
        dendrite_config_path=os.environ.get("DENDRITE_CONFIG_PATH", "/opt/dendrite/dendrite.yaml"),
        dendrite_registration_secret=os.environ.get("DENDRITE_REGISTRATION_SECRET", ""),
    )


def get() -> Config:
    if "instance" not in _state:
        raise RuntimeError("Config not initialized — call config.init() first")
    return _state["instance"]
