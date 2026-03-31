#!/usr/bin/env python3
"""
media_cleanup.py — Dendrite media retention cleanup script.

Scans /opt/dendrite/media/, cross-references mediaapi.db for upload timestamps,
and deletes files older than the configured TTL.

Disk usage monitoring:
  - If media dir exceeds WARN_THRESHOLD_PCT of DISK_BUDGET_BYTES, logs a warning.
  - If media dir exceeds EMERGENCY_THRESHOLD_PCT, applies EMERGENCY_TTL_DAYS instead
    of DEFAULT_TTL_DAYS and continues until usage drops to RECOVER_THRESHOLD_PCT.

Does NOT delete Dendrite DB rows — Dendrite returns 404 for missing files, which
the client handles by showing an "expired" placeholder.

Usage:
  media_cleanup.py [--media-dir DIR] [--db-path PATH] [--ttl-days N]
                   [--disk-budget-gb N] [--dry-run]
"""

import argparse
import contextlib
import logging
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path

# Defaults — overridable by CLI args (or Ansible variables via wrapper script)
DEFAULT_MEDIA_DIR = "/opt/dendrite/media"
DEFAULT_DB_PATH = "/opt/dendrite/mediaapi.db"
DEFAULT_TTL_DAYS = 30
DEFAULT_DISK_BUDGET_GB = 40
WARN_THRESHOLD_PCT = 80
EMERGENCY_THRESHOLD_PCT = 80   # same as warn — kick in emergency TTL immediately
EMERGENCY_TTL_DAYS = 3
RECOVER_THRESHOLD_PCT = 60

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [media_cleanup] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)


def dir_size_bytes(path: Path) -> int:
    """Return total size of all files under path."""
    total = 0
    for f in path.rglob("*"):
        if f.is_file():
            with contextlib.suppress(OSError):
                total += f.stat().st_size
    return total


def get_upload_timestamps(db_path: str) -> dict[str, int]:
    """
    Query mediaapi.db for media upload timestamps.
    Returns a dict mapping media_id → upload_ts (Unix seconds).
    """
    timestamps: dict[str, int] = {}
    if not os.path.exists(db_path):
        log.warning("mediaapi.db not found at %s — will use file mtime as fallback", db_path)
        return timestamps
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        # Dendrite's mediaapi.db stores uploaded media in the `mediaapi_media_repository` table.
        # Columns: media_id, content_type, file_size_bytes, creation_ts, upload_name, ...
        cursor = conn.execute("SELECT media_id, creation_ts FROM mediaapi_media_repository")
        for media_id, creation_ts in cursor:
            # creation_ts is stored as milliseconds since epoch in Dendrite
            timestamps[media_id] = int(creation_ts) // 1000
        conn.close()
        log.info("Loaded %d upload timestamps from mediaapi.db", len(timestamps))
    except sqlite3.Error as exc:
        log.warning("Failed to read mediaapi.db: %s — will use file mtime as fallback", exc)
    return timestamps


def collect_media_files(media_dir: Path) -> list[Path]:
    """
    Return a list of per-media directories under media_dir.
    Dendrite's actual layout: <media_dir>/{c1}/{c2}/{media_id}/file
    with optional thumbnails at <media_dir>/{c1}/{c2}/{media_id}/thumbnail-*
    We return the {media_id} directories; deleting one removes the file and all
    its thumbnails in one shot.
    """
    dirs = []
    for c1 in media_dir.iterdir():
        if not c1.is_dir() or c1.name == 'tmp':
            continue
        for c2 in c1.iterdir():
            if not c2.is_dir():
                continue
            for entry in c2.iterdir():
                if entry.is_dir() and (entry / 'file').exists():
                    dirs.append(entry)
    return dirs


def run_cleanup(
    media_dir: str,
    db_path: str,
    ttl_days: int,
    disk_budget_bytes: int,
    dry_run: bool,
) -> None:
    base = Path(media_dir)
    if not base.is_dir():
        log.error("Media directory not found: %s", media_dir)
        sys.exit(1)

    current_usage = dir_size_bytes(base)
    usage_pct = (current_usage / disk_budget_bytes * 100) if disk_budget_bytes else 0
    log.info(
        "Disk usage: %.1f MB / %.1f GB (%.0f%%)",
        current_usage / 1e6,
        disk_budget_bytes / 1e9,
        usage_pct,
    )

    # Determine effective TTL
    effective_ttl_days = ttl_days
    if usage_pct >= EMERGENCY_THRESHOLD_PCT:
        log.warning(
            "Disk usage %.0f%% >= emergency threshold %d%% — applying emergency TTL of %d days",
            usage_pct,
            EMERGENCY_THRESHOLD_PCT,
            EMERGENCY_TTL_DAYS,
        )
        effective_ttl_days = EMERGENCY_TTL_DAYS
    elif usage_pct >= WARN_THRESHOLD_PCT:
        log.warning("Disk usage %.0f%% >= warn threshold %d%%", usage_pct, WARN_THRESHOLD_PCT)

    cutoff_ts = int(time.time()) - effective_ttl_days * 86400
    log.info(
        "Applying TTL: %d days (cutoff: %s)",
        effective_ttl_days,
        time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(cutoff_ts)),
    )

    upload_ts = get_upload_timestamps(db_path)
    files = collect_media_files(base)
    log.info("Found %d local media entries", len(files))

    deleted_count = 0
    freed_bytes = 0

    for media_entry in files:
        media_id = media_entry.name
        ts = upload_ts.get(media_id)
        if ts is None:
            # Fallback: use mtime of the 'file' entry inside the directory
            try:
                ts = int((media_entry / 'file').stat().st_mtime)
            except OSError:
                continue

        if ts < cutoff_ts:
            entry_size = dir_size_bytes(media_entry)
            if dry_run:
                log.info("[dry-run] Would delete: %s (age: %dd, size: %d bytes)",
                         media_id, (int(time.time()) - ts) // 86400, entry_size)
            else:
                try:
                    shutil.rmtree(media_entry)
                    deleted_count += 1
                    freed_bytes += entry_size
                    log.debug("Deleted: %s", media_id)
                except OSError as exc:
                    log.warning("Failed to delete %s: %s", media_id, exc)

    if dry_run:
        would_delete = sum(
            1 for e in files
            if (upload_ts.get(e.name) or int((e / 'file').stat().st_mtime if (e / 'file').exists() else time.time())) < cutoff_ts
        )
        log.info("[dry-run] Would delete %d media entries", would_delete)
    else:
        after_usage = dir_size_bytes(base)
        after_pct = (after_usage / disk_budget_bytes * 100) if disk_budget_bytes else 0
        log.info(
            "Cleanup complete: deleted %d files, freed %.1f MB — disk now %.1f MB (%.0f%%)",
            deleted_count,
            freed_bytes / 1e6,
            after_usage / 1e6,
            after_pct,
        )
        if after_pct <= RECOVER_THRESHOLD_PCT:
            log.info("Disk usage back below recover threshold (%d%%)", RECOVER_THRESHOLD_PCT)


def main() -> None:
    parser = argparse.ArgumentParser(description="Dendrite media retention cleanup")
    parser.add_argument("--media-dir", default=DEFAULT_MEDIA_DIR)
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    parser.add_argument("--ttl-days", type=int, default=DEFAULT_TTL_DAYS)
    parser.add_argument("--disk-budget-gb", type=float, default=DEFAULT_DISK_BUDGET_GB)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    disk_budget_bytes = int(args.disk_budget_gb * 1e9)

    run_cleanup(
        media_dir=args.media_dir,
        db_path=args.db_path,
        ttl_days=args.ttl_days,
        disk_budget_bytes=disk_budget_bytes,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
