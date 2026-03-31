"""Tests for call link endpoints."""


def test_create_link(client, authed_dao, auth_header):
    resp = client.post("/api/links", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert data["room_name"].startswith("link_")
    assert data["active"] is True


def test_list_links(client, authed_dao, auth_header):
    authed_dao["fetch_all"].return_value = [
        {
            "id": "l1",
            "slug": "abc",
            "room_name": "link_abc",
            "max_members": 2,
            "active": 1,
            "created_at": "2026-03-05 20:00:00",
        },
    ]
    resp = client.get("/api/links", headers=auth_header)
    assert resp.status_code == 200
    assert resp.json()[0]["slug"] == "abc"


def test_deactivate_link(client, authed_dao, auth_header):
    authed_dao["execute"].return_value = 1
    resp = client.delete("/api/links/abc", headers=auth_header)
    assert resp.status_code == 200


def test_deactivate_link_not_found(client, authed_dao, auth_header):
    resp = client.delete("/api/links/nope", headers=auth_header)
    assert resp.status_code == 404


def test_guest_join_returns_501(client, mock_dao):
    """Guest calling via SIP links is not available in Matrix mode."""
    resp = client.post("/api/links/abc/join", json={"display_name": "Guest"})
    assert resp.status_code == 501


def test_guest_join_inactive_link(client, mock_dao):
    resp = client.post("/api/links/nope/join", json={"display_name": "Guest"})
    assert resp.status_code == 501  # 501 before link lookup — feature disabled


def test_guest_join_no_auth_required(client, mock_dao):
    resp = client.post("/api/links/abc/join", json={"display_name": "Anon"})
    assert resp.status_code == 501


def test_create_link_no_auth(client, mock_dao):
    resp = client.post("/api/links")
    assert resp.status_code == 422
