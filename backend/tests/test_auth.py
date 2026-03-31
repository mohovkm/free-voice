"""Tests for auth endpoints."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from helpers import control


def test_register_success(client, mock_dao):
    resp = client.post(
        "/api/auth/register",
        json={
            "email": "new@test.com",
            "password": "pass123",
            "display_name": "New User",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    # verification_sent may be False when SMTP is not configured (operator-managed deployments)
    assert "verification_sent" in data
    assert mock_dao["execute"].call_count >= 2  # user_insert + verification token


def test_register_duplicate_email(client, mock_dao):
    mock_dao["fetch_one"].return_value = {"id": "existing"}
    resp = client.post(
        "/api/auth/register",
        json={
            "email": "dup@test.com",
            "password": "pass123",
            "display_name": "Dup",
        },
    )
    assert resp.status_code == 409


def test_register_invalid_email(client, mock_dao):
    resp = client.post(
        "/api/auth/register",
        json={
            "email": "not-an-email",
            "password": "pass123",
            "display_name": "Bad",
        },
    )
    assert resp.status_code == 422


def test_debug_legacy_user_fixture_success(client, mock_dao):
    resp = client.post(
        "/api/auth/debug/legacy-user",
        json={
            "email": "legacy@example.com",
            "password": "pass123",
            "display_name": "Legacy User",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "legacy@example.com"
    assert data["verified"] is True
    assert any(call.args[0] == "user_mark_verified" for call in mock_dao["execute"].call_args_list)


def test_login_success(client, mock_dao):
    mock_dao["fetch_one"].return_value = {
        "id": "user-1",
        "password_hash": control._hash_password("pass123"),
        "email_verified_at": datetime.now(UTC),
    }
    resp = client.post(
        "/api/auth/login",
        json={
            "email": "user@test.com",
            "password": "pass123",
        },
    )
    assert resp.status_code == 200
    assert "access_token" in resp.json()
    assert "refresh_token" in resp.json()


def test_login_wrong_password(client, mock_dao):
    mock_dao["fetch_one"].return_value = {
        "id": "user-1",
        "password_hash": control._hash_password("correct"),
        "email_verified_at": datetime.now(UTC),
    }
    resp = client.post(
        "/api/auth/login",
        json={
            "email": "user@test.com",
            "password": "wrong",
        },
    )
    assert resp.status_code == 401


def test_login_unknown_email(client, mock_dao):
    resp = client.post(
        "/api/auth/login",
        json={
            "email": "nobody@test.com",
            "password": "pass123",
        },
    )
    assert resp.status_code == 401


def test_login_unverified_email(client, mock_dao):
    mock_dao["fetch_one"].return_value = {
        "id": "user-1",
        "password_hash": control._hash_password("pass123"),
        "email_verified_at": None,
    }
    resp = client.post(
        "/api/auth/login",
        json={
            "email": "user@test.com",
            "password": "pass123",
        },
    )
    assert resp.status_code == 403


def test_refresh_success(client, mock_dao):
    token = control.create_refresh_token("user-1")
    resp = client.post("/api/auth/refresh", json={"refresh_token": token})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_refresh_invalid_token(client, mock_dao):
    resp = client.post("/api/auth/refresh", json={"refresh_token": "garbage"})
    assert resp.status_code == 401


def test_refresh_rejects_access_token(client, mock_dao):
    """Refresh endpoint must reject access tokens."""
    access = control.create_access_token("user-1")
    resp = client.post("/api/auth/refresh", json={"refresh_token": access})
    assert resp.status_code == 401


def test_api_rejects_refresh_token(client, authed_dao):
    """Authenticated API endpoints must reject refresh tokens."""
    refresh = control.create_refresh_token("test-user-id-123")
    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {refresh}"})
    assert resp.status_code == 401


def test_me_success(client, authed_dao, auth_header):
    resp = client.get("/api/auth/me", headers=auth_header)
    assert resp.status_code == 200
    assert resp.json()["email"] == "me@test.com"


def test_me_no_auth(client, mock_dao):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 422


def test_me_invalid_token(client, mock_dao):
    resp = client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"})
    assert resp.status_code == 401


def test_me_deleted_user(client, mock_dao, auth_header):
    # fetch_one returns None by default → user not found
    resp = client.get("/api/auth/me", headers=auth_header)
    assert resp.status_code == 401


def test_verify_success(client, mock_dao):
    mock_dao["fetch_one"].return_value = {
        "id": "user-1",
        "email_verified_at": None,
        "email_verification_expires_at": datetime.now(UTC) + timedelta(hours=1),
    }
    resp = client.post("/api/auth/verify", json={"token": "tok"})
    assert resp.status_code == 200
    assert "access_token" in resp.json()
    assert "refresh_token" in resp.json()
    assert mock_dao["execute"].call_count >= 1


def test_verify_expired(client, mock_dao):
    mock_dao["fetch_one"].return_value = {
        "id": "user-1",
        "email_verified_at": None,
        "email_verification_expires_at": datetime.now(UTC) - timedelta(hours=1),
    }
    resp = client.post("/api/auth/verify", json={"token": "tok"})
    assert resp.status_code == 410


def test_resend_verification(client, mock_dao):
    mock_dao["fetch_one"].return_value = {
        "id": "user-1",
        "email_verified_at": None,
    }
    resp = client.post("/api/auth/verify/resend", json={"email": "user@test.com"})
    assert resp.status_code == 200
    data = resp.json()
    # verification_sent may be False when SMTP is not configured (operator-managed deployments)
    assert "verification_sent" in data


# --- Matrix login identifier tests ---


def test_matrix_login_accepts_plain_username(client):
    """Plain username (no @-sign) must not be rejected with 422 by the API layer.

    Regression: MatrixLoginRequest.email was EmailStr, which caused FastAPI to
    return 422 Unprocessable Entity for non-email identifiers such as 'testuser2'.
    """
    with patch("helpers.control.authenticate_matrix_user", new_callable=AsyncMock) as mock_auth:
        mock_auth.side_effect = control.matrix_auth.MatrixAuthError("Invalid credentials", 401)
        resp = client.post(
            "/api/auth/matrix-login", json={"email": "testuser2", "password": "wrongpass"}
        )
    # Must not be 422 (validation error) — backend reached control layer and returned 401
    assert resp.status_code != 422, (
        "Plain username was rejected by pydantic validation — EmailStr constraint still active"
    )
    assert resp.status_code == 401


def test_matrix_login_accepts_full_matrix_id(client):
    """Full @user:server Matrix ID must also pass validation without 422."""
    with patch("helpers.control.authenticate_matrix_user", new_callable=AsyncMock) as mock_auth:
        mock_auth.side_effect = control.matrix_auth.MatrixAuthError("Invalid credentials", 401)
        resp = client.post(
            "/api/auth/matrix-login",
            json={"email": "@testuser:test.local", "password": "wrongpass"},
        )
    assert resp.status_code != 422
    assert resp.status_code == 401


def test_matrix_login_accepts_email_identifier(client):
    """Email-format identifier continues to work after removing EmailStr constraint."""
    with patch("helpers.control.authenticate_matrix_user", new_callable=AsyncMock) as mock_auth:
        mock_auth.side_effect = control.matrix_auth.MatrixAuthError("Invalid credentials", 401)
        resp = client.post(
            "/api/auth/matrix-login", json={"email": "user@example.com", "password": "wrongpass"}
        )
    assert resp.status_code != 422
    assert resp.status_code == 401


# --- authenticate_matrix_user DB lookup routing tests ---

_VALID_MATRIX_USER = {
    "id": "user-1",
    "email_verified_at": "2024-01-01",
    "matrix_user_id": "@testuser:test.local",
    "matrix_localpart": "testuser",
}


@pytest.mark.asyncio
async def test_lookup_by_localpart_when_email_not_found():
    """Plain localpart falls back to user_by_matrix_localpart when user_by_email returns None.

    Regression: authenticate_matrix_user only queried user_by_email, so logging in
    with a plain username always returned 'invalid' even for valid accounts.
    """

    async def fake_fetch_one(query, params=()):
        if query == "user_by_email":
            return None
        if query == "user_by_matrix_localpart" and params == ("testuser",):
            return _VALID_MATRIX_USER
        return None

    with (
        patch("helpers.dao.fetch_one", side_effect=fake_fetch_one),
        patch("helpers.control.matrix_auth.login", new_callable=AsyncMock) as mock_login,
    ):
        mock_login.return_value = {
            "access_token": "tok",
            "user_id": "@testuser:test.local",
            "device_id": "dev1",
        }
        result = await control.authenticate_matrix_user("testuser", "correctpass")
    assert result["status"] == "ok"
    assert result["user_id"] == "@testuser:test.local"


@pytest.mark.asyncio
async def test_lookup_by_matrix_user_id_for_full_id():
    """Full @user:server identifier routes directly to user_by_matrix_user_id."""

    async def fake_fetch_one(query, params=()):
        if query == "user_by_matrix_user_id" and params == ("@testuser:test.local",):
            return _VALID_MATRIX_USER
        return None

    with (
        patch("helpers.dao.fetch_one", side_effect=fake_fetch_one),
        patch("helpers.control.matrix_auth.login", new_callable=AsyncMock) as mock_login,
    ):
        mock_login.return_value = {
            "access_token": "tok",
            "user_id": "@testuser:test.local",
            "device_id": "dev1",
        }
        result = await control.authenticate_matrix_user("@testuser:test.local", "correctpass")
    assert result["status"] == "ok"


@pytest.mark.asyncio
async def test_lookup_by_email_first_for_email_identifier():
    """Email identifier uses user_by_email and does NOT fall through to localpart lookup."""
    calls = []

    async def fake_fetch_one(query, params=()):
        calls.append(query)
        if query == "user_by_email":
            return _VALID_MATRIX_USER
        return None

    with (
        patch("helpers.dao.fetch_one", side_effect=fake_fetch_one),
        patch("helpers.control.matrix_auth.login", new_callable=AsyncMock) as mock_login,
    ):
        mock_login.return_value = {
            "access_token": "tok",
            "user_id": "@testuser:test.local",
            "device_id": "dev1",
        }
        result = await control.authenticate_matrix_user("user@example.com", "correctpass")
    assert result["status"] == "ok"
    assert "user_by_matrix_localpart" not in calls
