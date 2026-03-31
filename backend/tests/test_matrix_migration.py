"""Tests for password reset and Matrix migration compatibility routes."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch


def test_password_reset_request_is_non_enumerating_for_unknown_email(client, mock_dao):
    resp = client.post("/api/auth/password-reset/request", json={"email": "ghost@test.com"})
    assert resp.status_code == 200
    assert resp.json()["detail"] == "If the account exists, a password reset email was sent"
    assert resp.json()["debug_reset_link"] is None


def test_password_reset_request_issues_token_for_verified_user(client, mock_dao):
    mock_dao["fetch_one"].return_value = {
        "id": "user-1",
        "email": "user@test.com",
        "email_verified_at": datetime.now(UTC),
    }
    with patch(
        "helpers.control._send_password_reset_email", new_callable=AsyncMock, return_value=True
    ) as send_email:
        resp = client.post("/api/auth/password-reset/request", json={"email": "user@test.com"})
    assert resp.status_code == 200
    assert resp.json()["reset_sent"] is True
    assert resp.json()["debug_reset_link"].startswith("https://")
    send_email.assert_awaited_once()
    assert mock_dao["execute"].call_args.args[0] == "user_set_password_reset"


def test_password_reset_confirm_rejects_invalid_token(client, mock_dao):
    resp = client.post(
        "/api/auth/password-reset/confirm", json={"token": "bad", "new_password": "newpass123"}
    )
    assert resp.status_code == 404


def test_password_reset_confirm_rejects_expired_token(client, mock_dao):
    mock_dao["fetch_one"].return_value = {
        "id": "user-1",
        "email": "user@test.com",
        "display_name": "User",
        "password_reset_expires_at": datetime.now(UTC) - timedelta(hours=1),
        "email_verified_at": datetime.now(UTC),
    }
    resp = client.post(
        "/api/auth/password-reset/confirm", json={"token": "tok", "new_password": "newpass123"}
    )
    assert resp.status_code == 410


def test_password_reset_confirm_migrates_user_to_matrix(client, mock_dao):
    user_row = {
        "id": "user-1",
        "email": "user@test.com",
        "display_name": "User",
        "password_reset_expires_at": datetime.now(UTC) + timedelta(hours=1),
        "email_verified_at": datetime.now(UTC),
        "matrix_localpart": None,
        "matrix_user_id": None,
    }

    async def fetch_one_side_effect(query_name, params=()):
        if query_name == "user_by_password_reset_token":
            return user_row
        if query_name == "user_by_matrix_localpart":
            return None
        if query_name == "user_by_id":
            return {**user_row, "matrix_user_id": "@user:user.test", "matrix_localpart": "user"}
        return None

    mock_dao["fetch_one"].side_effect = fetch_one_side_effect
    with patch(
        "helpers.control.matrix_auth.ensure_account",
        new_callable=AsyncMock,
        return_value={"user_id": "@user:test.local", "access_token": "tok", "device_id": "DEV1"},
    ) as ensure_account:
        resp = client.post(
            "/api/auth/password-reset/confirm", json={"token": "tok", "new_password": "newpass123"}
        )

    assert resp.status_code == 200
    ensure_account.assert_awaited_once_with("user", "newpass123", "User")
    assert any(
        call.args[0] == "user_set_matrix_identity" for call in mock_dao["execute"].call_args_list
    )


def test_matrix_login_returns_reset_required_for_unmigrated_user(client, mock_dao):
    mock_dao["fetch_one"].return_value = {
        "id": "user-1",
        "email": "user@test.com",
        "email_verified_at": datetime.now(UTC),
        "matrix_user_id": None,
    }
    resp = client.post(
        "/api/auth/matrix-login", json={"email": "user@test.com", "password": "pass123"}
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "reset_required"


def test_matrix_login_returns_matrix_session_for_migrated_user(client, mock_dao):
    mock_dao["fetch_one"].return_value = {
        "id": "user-1",
        "email": "user@test.com",
        "email_verified_at": datetime.now(UTC),
        "matrix_user_id": "@user:test.local",
    }
    with patch(
        "helpers.control.matrix_auth.login",
        new_callable=AsyncMock,
        return_value={"access_token": "tok", "user_id": "@user:test.local", "device_id": "DEV1"},
    ):
        resp = client.post(
            "/api/auth/matrix-login", json={"email": "user@test.com", "password": "newpass123"}
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["access_token"] == "tok"
    assert body["user_id"] == "@user:test.local"


def test_matrix_bootstrap_contacts_requires_migrated_matrix_user(client, mock_dao):
    async def fetch_one_side_effect(query_name, params=()):
        if query_name == "user_by_matrix_user_id":
            return {"id": "owner-1", "matrix_user_id": "@owner:test.local"}
        return None

    mock_dao["fetch_one"].side_effect = fetch_one_side_effect
    mock_dao["fetch_all"].return_value = [
        {"email": "peer@test.com", "display_name": "Peer", "matrix_user_id": "@peer:test.local"},
    ]

    with patch(
        "helpers.control.matrix_auth.whoami", new_callable=AsyncMock, return_value="@owner:test.local"
    ):
        resp = client.get(
            "/api/matrix/bootstrap/contacts", headers={"Authorization": "Bearer matrix_tok"}
        )

    assert resp.status_code == 200
    assert resp.json() == [
        {"email": "peer@test.com", "display_name": "Peer", "matrix_user_id": "@peer:test.local"}
    ]
