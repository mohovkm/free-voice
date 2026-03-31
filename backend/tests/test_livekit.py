"""Unit tests for POST /api/livekit-token (routes_livekit.py).

Dendrite HTTP calls are mocked — no real network or homeserver required.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import jwt

from helpers import config

# ── helpers ───────────────────────────────────────────────────────────────────


def _dendrite_mock(status_code: int, json_body: dict | None = None):
    """Build a mock httpx.AsyncClient context manager with a fixed response."""
    mock_response = MagicMock()
    mock_response.status_code = status_code
    mock_response.json.return_value = json_body or {}

    mock_client = AsyncMock()
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = False
    mock_client.request.return_value = mock_response
    return mock_client


# ── Authorization header validation ──────────────────────────────────────────


def test_missing_authorization_header(client, mock_dao):
    resp = client.post("/api/livekit-token", json={"room_name": "test-room"})
    assert resp.status_code == 401
    assert "Authorization" in resp.json()["detail"]


def test_authorization_header_without_bearer_prefix(client, mock_dao):
    resp = client.post(
        "/api/livekit-token",
        json={"room_name": "test-room"},
        headers={"Authorization": "Token some_token"},
    )
    assert resp.status_code == 401


# ── Dendrite token validation ─────────────────────────────────────────────────


def test_invalid_matrix_token_dendrite_returns_401(client, mock_dao):
    with patch("helpers.matrix_auth.httpx.AsyncClient", return_value=_dendrite_mock(401)):
        resp = client.post(
            "/api/livekit-token",
            json={"room_name": "test-room"},
            headers={"Authorization": "Bearer bad_token"},
        )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid Matrix token"


def test_dendrite_unreachable_returns_503(client, mock_dao):
    mock_client = AsyncMock()
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = False
    mock_client.request.side_effect = httpx.ConnectError("connection refused")

    with patch("helpers.matrix_auth.httpx.AsyncClient", return_value=mock_client):
        resp = client.post(
            "/api/livekit-token",
            json={"room_name": "test-room"},
            headers={"Authorization": "Bearer some_token"},
        )
    assert resp.status_code == 503
    assert "Dendrite unreachable" in resp.json()["detail"]


def test_dendrite_unexpected_status_returns_502(client, mock_dao):
    with patch("helpers.matrix_auth.httpx.AsyncClient", return_value=_dendrite_mock(500)):
        resp = client.post(
            "/api/livekit-token",
            json={"room_name": "test-room"},
            headers={"Authorization": "Bearer some_token"},
        )
    assert resp.status_code == 502
    assert "500" in resp.json()["detail"]


def test_dendrite_response_missing_user_id_returns_502(client, mock_dao):
    # Dendrite 200 but body has no user_id field
    with patch("helpers.matrix_auth.httpx.AsyncClient", return_value=_dendrite_mock(200, {})):
        resp = client.post(
            "/api/livekit-token",
            json={"room_name": "test-room"},
            headers={"Authorization": "Bearer some_token"},
        )
    assert resp.status_code == 502
    assert "user_id" in resp.json()["detail"]


# ── Happy path ────────────────────────────────────────────────────────────────


def test_valid_token_returns_200_with_token_and_url(client, mock_dao):
    mock = _dendrite_mock(200, {"user_id": "@alice:example.com"})
    with patch("helpers.matrix_auth.httpx.AsyncClient", return_value=mock):
        resp = client.post(
            "/api/livekit-token",
            json={"room_name": "test-room"},
            headers={"Authorization": "Bearer valid_matrix_token"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert "token" in body
    assert body["url"] == config.get().livekit_url


def test_jwt_payload_contains_correct_claims(client, mock_dao):
    mock = _dendrite_mock(200, {"user_id": "@alice:example.com"})
    with patch("helpers.matrix_auth.httpx.AsyncClient", return_value=mock):
        resp = client.post(
            "/api/livekit-token",
            json={"room_name": "my-room"},
            headers={"Authorization": "Bearer valid_matrix_token"},
        )
    assert resp.status_code == 200

    cfg = config.get()
    payload = jwt.decode(
        resp.json()["token"],
        cfg.livekit_api_secret,
        algorithms=["HS256"],
        options={"verify_exp": False},
    )

    assert payload["iss"] == cfg.livekit_api_key
    assert payload["sub"] == "@alice:example.com"
    assert payload["video"]["roomJoin"] is True
    assert payload["video"]["room"] == "my-room"
    assert payload["video"]["canPublish"] is True
    assert payload["video"]["canSubscribe"] is True


def test_matrix_token_forwarded_to_dendrite_verbatim(client, mock_dao):
    """The Bearer token from the client must be forwarded to Dendrite unchanged."""
    mock = _dendrite_mock(200, {"user_id": "@alice:example.com"})
    with patch("helpers.matrix_auth.httpx.AsyncClient", return_value=mock):
        client.post(
            "/api/livekit-token",
            json={"room_name": "test-room"},
            headers={"Authorization": "Bearer my_matrix_token"},
        )
    mock.request.assert_called_once()
    forwarded_auth = mock.request.call_args.kwargs["headers"]["Authorization"]
    assert forwarded_auth == "Bearer my_matrix_token"
