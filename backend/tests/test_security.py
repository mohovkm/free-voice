"""Security test — verify all endpoints require auth unless explicitly public."""

from main import app

# Endpoints that are intentionally public (no auth required)
PUBLIC_ENDPOINTS = {
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/refresh"),
    ("POST", "/api/auth/verify"),
    ("POST", "/api/auth/verify/resend"),
    ("GET", "/api/push/vapid-key"),
    ("GET", "/api/push/config"),
    ("POST", "/api/push/notify"),
}

# FastAPI internal routes to skip
FRAMEWORK_PATHS = {"/openapi.json", "/docs", "/redoc"}

# Status codes that indicate auth is enforced
AUTH_REJECTION_CODES = {401, 403, 422}


def _get_all_routes():
    """Extract all API routes from the FastAPI app."""
    routes = []
    for route in app.routes:
        if not hasattr(route, "methods") or route.path in FRAMEWORK_PATHS:
            continue
        for method in route.methods:
            if method in ("HEAD", "OPTIONS"):
                continue
            routes.append((method, route.path))
    return routes


def _fill_path(path: str) -> str:
    """Replace path parameters with dummy values."""
    return (
        path.replace("{slug}", "test-slug")
        .replace("{room}", "test-room")
        .replace("{email}", "test@test.com")
    )


def test_all_protected_endpoints_reject_unauthenticated(client, mock_dao):
    """Every non-public endpoint must return 401/403/422 without auth."""
    routes = _get_all_routes()
    assert len(routes) > 0, "No routes found — app misconfigured"

    failures = []
    for method, path in routes:
        if (method, path) in PUBLIC_ENDPOINTS:
            continue

        url = _fill_path(path)
        resp = client.request(method, url)

        if resp.status_code not in AUTH_REJECTION_CODES:
            failures.append(
                f"{method} {path} returned {resp.status_code} without auth "
                f"(expected one of {AUTH_REJECTION_CODES})"
            )

    assert not failures, "Unprotected endpoints found:\n" + "\n".join(failures)


def test_public_endpoints_exist(client, mock_dao):
    """Verify all declared public endpoints are actually registered in the app."""
    registered = set(_get_all_routes())
    for method, path in PUBLIC_ENDPOINTS:
        assert (method, path) in registered, (
            f"Public endpoint {method} {path} not found in app routes"
        )
