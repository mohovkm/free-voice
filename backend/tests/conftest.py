"""Shared fixtures for API tests."""

import os
from unittest.mock import AsyncMock, patch

import pytest

# Set required env vars before any app imports
os.environ.update(
    {
        "DB_HOST": "localhost",
        "DB_NAME": "test",
        "DB_USER": "test",
        "DB_PASSWORD": "test",
        "JWT_SECRET": "test-secret-key-for-unit-tests",
        "TURN_SECRET": "test-turn",
        "AMI_USER": "test",
        "AMI_SECRET": "test",
        "NODE_DOMAIN": "test.local",
        "TURN_HOST": "test.local",
        "EMAIL_DEBUG": "1",
        "LIVEKIT_API_KEY": "testkey",
        "LIVEKIT_API_SECRET": "testsecret48byteslongenoughforhs256!",
        "LIVEKIT_URL": "wss://test.local/livekit-ws",
        "DENDRITE_URL": "http://127.0.0.1:8008",
    }
)

from helpers import config

config.init()

from fastapi.testclient import TestClient  # noqa: E402

from helpers import control  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def mock_dao():
    """Patch dao.fetch_one, fetch_all, execute, insert, execute_raw with AsyncMocks."""
    with (
        patch("helpers.dao.fetch_one", new_callable=AsyncMock) as m_one,
        patch("helpers.dao.fetch_all", new_callable=AsyncMock) as m_all,
        patch("helpers.dao.execute", new_callable=AsyncMock) as m_exec,
        patch("helpers.dao.insert", new_callable=AsyncMock) as m_ins,
        patch("helpers.dao.execute_raw", new_callable=AsyncMock) as m_raw,
    ):
        m_one.return_value = None
        m_all.return_value = []
        m_exec.return_value = 0
        m_ins.return_value = 1
        m_raw.return_value = []
        yield {
            "fetch_one": m_one,
            "fetch_all": m_all,
            "execute": m_exec,
            "insert": m_ins,
            "execute_raw": m_raw,
        }


@pytest.fixture
def auth_header():
    """Return a valid Authorization header for a test user."""
    token = control.create_access_token("test-user-id-123")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def authed_dao(mock_dao):
    """mock_dao with user existence check passing (for authenticated endpoints)."""
    _test_user = {
        "id": "test-user-id-123",
        "sip_username": "u_test",
        "sip_password": "testpass",
        "email": "me@test.com",
        "display_name": "Me",
        "tier": "free",
    }

    async def side_effect(query_name, params=()):
        if query_name == "user_by_id" and params == ("test-user-id-123",):
            return _test_user
        return None

    mock_dao["fetch_one"].side_effect = side_effect
    mock_dao["_test_user"] = _test_user
    return mock_dao


@pytest.fixture(autouse=True)
def clear_user_cache():
    """Clear the user existence cache between tests."""
    control._user_cache.clear()
