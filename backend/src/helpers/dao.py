"""Database access layer — generic query executor + SQL registry."""

import aiomysql

from . import config

_state = {}

# --- SQL Registry ---
# Each entry: (sql_template, description)
# Use %s placeholders for parameters

SQL = {
    # Users
    "user_by_email": "SELECT * FROM users WHERE email = %s",
    "user_by_id": "SELECT * FROM users WHERE id = %s",
    "user_by_verification_token": "SELECT * FROM users WHERE email_verification_token_hash = %s",
    "user_by_password_reset_token": "SELECT * FROM users WHERE password_reset_token_hash = %s",
    "user_by_matrix_user_id": "SELECT * FROM users WHERE matrix_user_id = %s",
    "user_by_matrix_localpart": "SELECT * FROM users WHERE matrix_localpart = %s",
    "user_insert": (
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (%s, %s, %s, %s)"
    ),
    "user_set_verification": (
        "UPDATE users SET email_verification_token_hash = %s, "
        "email_verification_expires_at = %s, email_verification_sent_at = NOW() "
        "WHERE id = %s"
    ),
    "user_mark_verified": "UPDATE users SET email_verified_at = NOW() WHERE id = %s AND email_verified_at IS NULL",
    "user_set_password_reset": (
        "UPDATE users SET password_reset_token_hash = %s, password_reset_expires_at = %s, "
        "password_reset_sent_at = NOW() WHERE id = %s"
    ),
    "user_set_matrix_identity": (
        "UPDATE users SET matrix_user_id = %s, matrix_localpart = %s, matrix_migration_state = %s, "
        "matrix_migrated_at = NOW(), password_hash = %s, password_reset_token_hash = NULL, "
        "password_reset_expires_at = NULL WHERE id = %s"
    ),
    "user_delete": "DELETE FROM users WHERE id = %s",
    # Contacts
    "contact_upsert": (
        "INSERT INTO contacts (owner_id, contact_id, contact_email, status) VALUES (%s, %s, %s, 'pending') "
        "ON DUPLICATE KEY UPDATE status = IF(status = 'invited', 'pending', status), contact_id = VALUES(contact_id)"
    ),
    "contact_invite_insert": (
        "INSERT IGNORE INTO contacts (owner_id, contact_id, contact_email, status, invite_token, invite_expires_at) "
        "VALUES (%s, NULL, %s, 'invited', %s, %s)"
    ),
    "contact_list": (
        "SELECT u.id, u.email, u.display_name, c.status, c.node_domain "
        "FROM contacts c JOIN users u ON (c.contact_id = u.id OR (c.contact_id IS NULL AND u.email = c.contact_email)) "
        "WHERE c.owner_id = %s AND c.status IN ('accepted','pending') AND c.node_domain IS NULL ORDER BY u.display_name"
    ),
    "contact_reverse_check": (
        "SELECT status FROM contacts WHERE owner_id = %s AND contact_email = %s"
    ),
    "contact_requests_incoming": (
        "SELECT u.id, u.email, u.display_name, c.added_at "
        "FROM contacts c JOIN users u ON c.owner_id = u.id "
        "WHERE c.contact_id = %s AND c.status = 'pending' ORDER BY c.added_at DESC"
    ),
    "contact_requests_count": (
        "SELECT COUNT(*) AS cnt FROM contacts WHERE contact_id = %s AND status = 'pending'"
    ),
    "contact_accept": (
        "UPDATE contacts SET status = 'accepted' WHERE owner_id = %s AND contact_email = %s AND status = 'pending'"
    ),
    "contact_accept_reverse": (
        "INSERT INTO contacts (owner_id, contact_id, contact_email, status) VALUES (%s, %s, %s, 'accepted') "
        "ON DUPLICATE KEY UPDATE status = 'accepted', contact_id = VALUES(contact_id)"
    ),
    "contact_delete": "DELETE FROM contacts WHERE owner_id = %s AND contact_email = %s",
    "contact_by_token": (
        "SELECT c.*, u.display_name AS owner_name, u.email AS owner_email "
        "FROM contacts c JOIN users u ON c.owner_id = u.id "
        "WHERE c.invite_token = %s AND c.status = 'invited'"
    ),
    "contacts_by_invited_email": (
        "SELECT owner_id FROM contacts WHERE contact_email = %s AND status = 'invited'"
    ),
    "matrix_bootstrap_contacts": (
        "SELECT u.email, u.display_name, u.matrix_user_id "
        "FROM contacts c JOIN users u ON c.contact_id = u.id "
        "WHERE c.owner_id = %s AND c.status = 'accepted' AND c.node_domain IS NULL "
        "AND u.matrix_user_id IS NOT NULL ORDER BY u.display_name"
    ),
    # Call links
    "call_link_insert": "INSERT INTO call_links (id, owner_id, slug, room_name) VALUES (%s, %s, %s, %s)",
    "call_link_list": (
        "SELECT id, slug, room_name, max_members, active, created_at "
        "FROM call_links WHERE owner_id = %s ORDER BY created_at DESC"
    ),
    "call_link_deactivate": "UPDATE call_links SET active = 0 WHERE slug = %s AND owner_id = %s",
    # Call events
    "push_sub_upsert": (
        "INSERT INTO push_subscriptions (matrix_user_id, endpoint, p256dh, auth) "
        "VALUES (%s, %s, %s, %s) ON DUPLICATE KEY UPDATE matrix_user_id = %s, p256dh = %s, auth = %s"
    ),
    "push_sub_delete_by_user": "DELETE FROM push_subscriptions WHERE matrix_user_id = %s",
    "push_sub_delete": "DELETE FROM push_subscriptions WHERE matrix_user_id = %s AND endpoint = %s",
    "push_sub_delete_by_endpoint": "DELETE FROM push_subscriptions WHERE endpoint = %s",
    "push_sub_user_by_pushkey": "SELECT matrix_user_id FROM push_subscriptions WHERE p256dh = %s LIMIT 1",
}


# --- Pool lifecycle ---


async def init_pool() -> None:
    cfg = config.get()
    _state["pool"] = await aiomysql.create_pool(
        host=cfg.db_host,
        db=cfg.db_name,
        user=cfg.db_user,
        password=cfg.db_password,
        minsize=cfg.db_pool_min,
        maxsize=cfg.db_pool_max,
        autocommit=True,
        charset="utf8mb4",
        use_unicode=True,
    )


async def close_pool() -> None:
    if "pool" in _state:
        _state["pool"].close()
        await _state["pool"].wait_closed()
        del _state["pool"]


def _pool() -> aiomysql.Pool:
    if "pool" not in _state:
        raise RuntimeError("DB pool not initialized — call dao.init_pool() first")
    return _state["pool"]


# --- Generic query functions ---


async def fetch_one(query_name: str, params: tuple = ()) -> dict | None:
    """Execute a named query, return single row as dict or None."""
    async with _pool().acquire() as conn, conn.cursor(aiomysql.DictCursor) as cur:
        await cur.execute(SQL[query_name], params)
        return await cur.fetchone()


async def fetch_all(query_name: str, params: tuple = ()) -> list[dict]:
    """Execute a named query, return all rows as list of dicts."""
    async with _pool().acquire() as conn, conn.cursor(aiomysql.DictCursor) as cur:
        await cur.execute(SQL[query_name], params)
        return await cur.fetchall()


async def execute(query_name: str, params: tuple = ()) -> int:
    """Execute a named query, return affected row count."""
    async with _pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(SQL[query_name], params)
        return cur.rowcount


async def insert(query_name: str, params: tuple = ()) -> int:
    """Execute a named INSERT query, return last inserted auto-increment ID."""
    async with _pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(SQL[query_name], params)
        return cur.lastrowid


async def execute_raw(sql: str, params: tuple = ()) -> list[tuple]:
    """Execute raw SQL (for dynamic queries like online_check). Returns raw rows."""
    async with _pool().acquire() as conn, conn.cursor() as cur:
        await cur.execute(sql, params)
        return await cur.fetchall()
