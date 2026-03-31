"""Tests for push notification endpoints."""

import os
import tempfile
from unittest.mock import AsyncMock, patch


def test_vapid_key(client):
    r = client.get("/api/push/vapid-key")
    assert r.status_code == 200
    assert "public_key" in r.json()


def test_push_config(client):
    r = client.get("/api/push/config")
    assert r.status_code == 200
    data = r.json()
    assert "vapid_public_key" in data
    assert "sygnal_url" in data
    assert "app_id" in data


def test_subscribe(client, mock_dao):
    with patch("helpers.matrix_auth.whoami", new_callable=AsyncMock, return_value="@test:test.local"):
        r = client.post(
            "/api/push/subscribe",
            json={
                "endpoint": "https://fcm.googleapis.com/fcm/send/xxx",
                "keys": {"p256dh": "abc", "auth": "def"},
            },
            headers={"Authorization": "Bearer matrix_tok"},
        )
    assert r.status_code == 200
    args = mock_dao["execute"].call_args[0]
    assert args[0] == "push_sub_upsert"


def test_subscribe_no_auth(client):
    r = client.post(
        "/api/push/subscribe",
        json={"endpoint": "https://example.com", "keys": {"p256dh": "a", "auth": "b"}},
    )
    assert r.status_code in {401, 422}


def test_unsubscribe(client, mock_dao):
    mock_dao["execute"].return_value = 1
    with patch("helpers.matrix_auth.whoami", new_callable=AsyncMock, return_value="@test:test.local"):
        r = client.request(
            "DELETE",
            "/api/push/subscribe",
            json={
                "endpoint": "https://fcm.googleapis.com/fcm/send/xxx",
                "keys": {"p256dh": "abc", "auth": "def"},
            },
            headers={"Authorization": "Bearer matrix_tok"},
        )
    assert r.status_code == 200


def test_unsubscribe_not_found(client, mock_dao):
    mock_dao["execute"].return_value = 0
    with patch("helpers.matrix_auth.whoami", new_callable=AsyncMock, return_value="@test:test.local"):
        r = client.request(
            "DELETE",
            "/api/push/subscribe",
            json={"endpoint": "https://example.com/gone", "keys": {"p256dh": "a", "auth": "b"}},
            headers={"Authorization": "Bearer matrix_tok"},
        )
    assert r.status_code == 404


# --- VAPID key file loading ---


def test_read_vapid_key_from_file():
    """_read_vapid_key reads PEM key from VAPID_KEY_FILE and converts to raw base64url."""
    from helpers import config as cfg_module

    # Real EC P-256 PEM (test key, not used in production)
    pem = (
        "-----BEGIN PRIVATE KEY-----\n"
        "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgvl1Hac1xMkmhMNjv\n"
        "VBu2pHsSoc4irEpkD6GnI5bDxkmhRANCAARc9Qa+cBoNFDstc8E3qzXDXgLAQ1Mq\n"
        "x1QXiie1JlC6bmlmOfGO/kWQ9PS3tdvQCoMszpGaLe+S9ZHakyRipSx/\n"
        "-----END PRIVATE KEY-----"
    )
    with tempfile.NamedTemporaryFile(mode="w", suffix=".key", delete=False) as f:
        f.write(pem)
        f.flush()
        with patch.dict(os.environ, {"VAPID_KEY_FILE": f.name}, clear=False):
            result = cfg_module._read_vapid_key()
    os.unlink(f.name)
    # Should be raw base64url, not PEM
    assert not result.startswith("-----")
    assert result == "vl1Hac1xMkmhMNjvVBu2pHsSoc4irEpkD6GnI5bDxkk"


def test_read_vapid_key_fallback_to_env():
    """_read_vapid_key falls back to VAPID_PRIVATE_KEY env var when no file."""
    from helpers import config as cfg_module

    env = {"VAPID_KEY_FILE": "/nonexistent/path.key", "VAPID_PRIVATE_KEY": "inline-key"}
    with patch.dict(os.environ, env, clear=False):
        result = cfg_module._read_vapid_key()
    assert result == "inline-key"


def test_read_vapid_key_missing_returns_empty():
    """_read_vapid_key returns empty string when neither file nor env var set."""
    from helpers import config as cfg_module

    env = os.environ.copy()
    env.pop("VAPID_KEY_FILE", None)
    env.pop("VAPID_PRIVATE_KEY", None)
    with patch.dict(os.environ, env, clear=True):
        result = cfg_module._read_vapid_key()
    assert result == ""


# --- Notify endpoint (push gateway) ---


def test_notify_skips_sender_device(client, mock_dao):
    """Notify should not push to the sender's own device."""
    mock_dao["fetch_all"].return_value = [{"matrix_user_id": "@alice:test.local"}]
    with (
        patch("routes.push.webpush") as mock_webpush,
        patch("routes.push.config.get") as mock_cfg,
        patch("routes.push._resolve_display_name", new_callable=AsyncMock, return_value="Alice"),
    ):
        mock_cfg.return_value.vapid_private_key = "test-key"
        mock_cfg.return_value.vapid_claims_email = "mailto:test@test.local"
        r = client.post(
            "/api/push/notify",
            json={
                "notification": {
                    "sender": "@alice:test.local",
                    "type": "m.room.message",
                    "content": {"body": "hello"},
                    "room_id": "!room:test.local",
                    "devices": [
                        {
                            "pushkey": "alice-pushkey",
                            "data": {"endpoint": "https://push.example.com/alice", "auth": "a1"},
                        }
                    ],
                }
            },
        )
    assert r.status_code == 200
    mock_webpush.assert_not_called()


def test_notify_delivers_to_non_sender(client, mock_dao):
    """Notify should push to devices that don't belong to the sender."""
    mock_dao["fetch_all"].return_value = [{"matrix_user_id": "@bob:test.local"}]
    with (
        patch("routes.push.webpush") as mock_webpush,
        patch("routes.push.config.get") as mock_cfg,
        patch("routes.push._resolve_display_name", new_callable=AsyncMock, return_value="Alice"),
    ):
        mock_cfg.return_value.vapid_private_key = "test-key"
        mock_cfg.return_value.vapid_claims_email = "mailto:test@test.local"
        r = client.post(
            "/api/push/notify",
            json={
                "notification": {
                    "sender": "@alice:test.local",
                    "type": "m.room.message",
                    "content": {"body": "hello"},
                    "room_id": "!room:test.local",
                    "devices": [
                        {
                            "pushkey": "bob-pushkey",
                            "data": {"endpoint": "https://push.example.com/bob", "auth": "b1"},
                        }
                    ],
                }
            },
        )
    assert r.status_code == 200
    mock_webpush.assert_called_once()


def test_notify_call_payload_includes_room_id(client, mock_dao):
    """Call invite push payload should include room_id and video flag."""
    mock_dao["fetch_all"].return_value = [{"matrix_user_id": "@bob:test.local"}]
    captured_payload = {}
    def fake_webpush(**kwargs):
        import json
        captured_payload.update(json.loads(kwargs["data"]))
    with (
        patch("routes.push.webpush", side_effect=fake_webpush),
        patch("routes.push.config.get") as mock_cfg,
        patch("routes.push._resolve_display_name", new_callable=AsyncMock, return_value="Alice"),
    ):
        mock_cfg.return_value.vapid_private_key = "test-key"
        mock_cfg.return_value.vapid_claims_email = "mailto:test@test.local"
        r = client.post(
            "/api/push/notify",
            json={
                "notification": {
                    "sender": "@alice:test.local",
                    "type": "m.call.invite",
                    "content": {"offer": {"sdp": "m=video"}},
                    "room_id": "!call:test.local",
                    "devices": [
                        {
                            "pushkey": "bob-pushkey",
                            "data": {"endpoint": "https://push.example.com/bob", "auth": "b1"},
                        }
                    ],
                }
            },
        )
    assert r.status_code == 200
    assert captured_payload["type"] == "call"
    assert captured_payload["room_id"] == "!call:test.local"
    assert captured_payload["video"] is True


def test_notify_deletes_stale_410_subscription(client, mock_dao):
    """On 410 Gone, the stale subscription should be deleted."""
    mock_dao["fetch_all"].return_value = [{"matrix_user_id": "@bob:test.local"}]
    with (
        patch("routes.push.webpush", side_effect=Exception("Push failed: 410 Gone")),
        patch("routes.push.config.get") as mock_cfg,
        patch("routes.push._resolve_display_name", new_callable=AsyncMock, return_value="Alice"),
    ):
        mock_cfg.return_value.vapid_private_key = "test-key"
        mock_cfg.return_value.vapid_claims_email = "mailto:test@test.local"
        r = client.post(
            "/api/push/notify",
            json={
                "notification": {
                    "sender": "@alice:test.local",
                    "type": "m.room.message",
                    "content": {"body": "hi"},
                    "room_id": "!room:test.local",
                    "devices": [
                        {
                            "pushkey": "bob-pushkey",
                            "data": {"endpoint": "https://push.example.com/stale", "auth": "b1"},
                        }
                    ],
                }
            },
        )
    assert r.status_code == 200
    delete_calls = [
        c for c in mock_dao["execute"].call_args_list
        if c[0][0] == "push_sub_delete_by_endpoint"
    ]
    assert len(delete_calls) == 1
    assert delete_calls[0][0][1] == ("https://push.example.com/stale",)
