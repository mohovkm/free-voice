"""
Tests for ansible/roles/dendrite/files/media_cleanup.py

Uses mock filesystem (tmp_path) and an in-memory SQLite DB to verify:
- Files older than TTL are deleted
- Files newer than TTL are preserved
- mtime fallback works when media_id is not in DB
- Disk usage monitoring kicks in correct TTL (emergency vs. default)
- --dry-run does not delete files
"""

import importlib.util
import os
import sqlite3
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Load the cleanup script as a module (it lives in ansible/roles/dendrite/files/)
# ---------------------------------------------------------------------------

SCRIPT_PATH = (
    Path(__file__).parent.parent.parent / "ansible" / "roles" / "dendrite" / "files" / "media_cleanup.py"
)


def load_cleanup_module():
    spec = importlib.util.spec_from_file_location("media_cleanup", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cleanup = load_cleanup_module()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_media_db(db_path: Path, entries: list[tuple[str, int]]) -> None:
    """Create a minimal mediaapi.db with the given (media_id, creation_ts_ms) rows."""
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "CREATE TABLE mediaapi_media_repository "
        "(media_id TEXT PRIMARY KEY, content_type TEXT, file_size_bytes INTEGER, "
        "creation_ts INTEGER, upload_name TEXT)"
    )
    conn.executemany(
        "INSERT INTO mediaapi_media_repository (media_id, creation_ts) VALUES (?, ?)",
        entries,
    )
    conn.commit()
    conn.close()


def make_media_entry(media_dir: Path, media_id: str, size_bytes: int = 1024) -> Path:
    """Create a media entry in Dendrite's actual layout: {media_dir}/{c1}/{c2}/{media_id}/file"""
    c1 = media_id[0] if media_id else "a"
    c2 = media_id[1] if len(media_id) > 1 else "a"
    entry_dir = media_dir / c1 / c2 / media_id
    entry_dir.mkdir(parents=True, exist_ok=True)
    (entry_dir / "file").write_bytes(b"x" * size_bytes)
    return entry_dir


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGetUploadTimestamps:
    def test_returns_timestamps_from_db(self, tmp_path):
        db = tmp_path / "mediaapi.db"
        now_ms = int(time.time() * 1000)
        make_media_db(db, [("abc123", now_ms), ("def456", now_ms - 10_000)])

        ts = cleanup.get_upload_timestamps(str(db))

        assert "abc123" in ts
        assert ts["abc123"] == now_ms // 1000
        assert ts["def456"] == (now_ms - 10_000) // 1000

    def test_returns_empty_when_db_missing(self, tmp_path):
        ts = cleanup.get_upload_timestamps(str(tmp_path / "missing.db"))
        assert ts == {}

    def test_returns_empty_on_missing_table(self, tmp_path):
        db = tmp_path / "empty.db"
        sqlite3.connect(str(db)).close()
        ts = cleanup.get_upload_timestamps(str(db))
        assert ts == {}


class TestCollectMediaFiles:
    def test_returns_entries_in_real_layout(self, tmp_path):
        make_media_entry(tmp_path, "file1abc")
        make_media_entry(tmp_path, "file2xyz")

        entries = cleanup.collect_media_files(tmp_path)
        names = {e.name for e in entries}
        assert names == {"file1abc", "file2xyz"}

    def test_ignores_dirs_without_file_child(self, tmp_path):
        # A directory that has no 'file' inside should be ignored
        (tmp_path / "a" / "b" / "no-file-here").mkdir(parents=True)
        (tmp_path / "a" / "b" / "no-file-here" / "thumbnail-32x32").write_bytes(b"t")

        assert cleanup.collect_media_files(tmp_path) == []

    def test_ignores_tmp_dir(self, tmp_path):
        # tmp/ at the top level must be skipped
        make_media_entry(tmp_path, "real_media")
        tmp_sub = tmp_path / "tmp" / "x" / "upload123"
        tmp_sub.mkdir(parents=True)
        (tmp_sub / "file").write_bytes(b"partial upload")

        entries = cleanup.collect_media_files(tmp_path)
        assert {e.name for e in entries} == {"real_media"}

    def test_returns_empty_for_empty_dir(self, tmp_path):
        assert cleanup.collect_media_files(tmp_path) == []


class TestRunCleanup:
    def test_deletes_old_entries(self, tmp_path):
        db = tmp_path / "mediaapi.db"
        now = int(time.time())
        old_ts_ms = (now - 40 * 86400) * 1000   # 40 days ago
        new_ts_ms = (now - 5 * 86400) * 1000    # 5 days ago

        make_media_db(db, [("old_media", old_ts_ms), ("new_media", new_ts_ms)])
        old_entry = make_media_entry(tmp_path, "old_media")
        new_entry = make_media_entry(tmp_path, "new_media")

        cleanup.run_cleanup(
            media_dir=str(tmp_path),
            db_path=str(db),
            ttl_days=30,
            disk_budget_bytes=int(40e9),
            dry_run=False,
        )

        assert not old_entry.exists()
        assert new_entry.exists()

    def test_dry_run_does_not_delete(self, tmp_path):
        db = tmp_path / "mediaapi.db"
        now = int(time.time())
        old_ts_ms = (now - 40 * 86400) * 1000
        make_media_db(db, [("old_media", old_ts_ms)])
        entry = make_media_entry(tmp_path, "old_media")

        cleanup.run_cleanup(
            media_dir=str(tmp_path),
            db_path=str(db),
            ttl_days=30,
            disk_budget_bytes=int(40e9),
            dry_run=True,
        )

        assert entry.exists()

    def test_mtime_fallback_when_not_in_db(self, tmp_path):
        db = tmp_path / "mediaapi.db"
        make_media_db(db, [])  # empty DB

        entry = make_media_entry(tmp_path, "old_via_mtime")
        # Set mtime of the 'file' inside to 40 days ago
        inner = entry / "file"
        old_ts = time.time() - 40 * 86400
        os.utime(inner, (old_ts, old_ts))

        cleanup.run_cleanup(
            media_dir=str(tmp_path),
            db_path=str(db),
            ttl_days=30,
            disk_budget_bytes=int(40e9),
            dry_run=False,
        )

        assert not entry.exists()

    def test_emergency_ttl_when_over_threshold(self, tmp_path, monkeypatch):
        db = tmp_path / "mediaapi.db"
        now = int(time.time())
        # File is 5 days old — safe under 30-day TTL, but deleted under 3-day emergency TTL
        ts_ms = (now - 5 * 86400) * 1000
        make_media_db(db, [("medium_media", ts_ms)])
        entry = make_media_entry(tmp_path, "medium_media", size_bytes=1024)

        # Budget: 100 bytes; usage: 90 bytes → 90% > 80% threshold
        monkeypatch.setattr(cleanup, "dir_size_bytes", lambda _: 90)

        cleanup.run_cleanup(
            media_dir=str(tmp_path),
            db_path=str(db),
            ttl_days=30,
            disk_budget_bytes=100,
            dry_run=False,
        )

        assert not entry.exists()
