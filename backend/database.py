"""SQLite — local only, never sent off device.

Schema is owner-scoped: every session and message carries owner_uid (the Firebase
UID of the paired user), so the same SQLite file could in principle host more
than one paired user. For the licenta demo there's exactly one.
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .config import settings

def _safe_alter(c: sqlite3.Connection, statement: str) -> None:
    try:
        c.execute(statement)
    except sqlite3.OperationalError:
        # column already exists; idempotent migration
        pass


def _ensure_parent(path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)


@contextmanager
def _conn():
    _ensure_parent(settings.db_path)
    c = sqlite3.connect(settings.db_path)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON;")
    try:
        yield c
        c.commit()
    finally:
        c.close()


_BASE_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    owner_uid   TEXT NOT NULL,
    title       TEXT NOT NULL,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_owner_updated
    ON sessions(owner_uid, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    owner_uid     TEXT NOT NULL,
    role          TEXT NOT NULL,
    content       TEXT NOT NULL,
    used_search   INTEGER DEFAULT 0,
    sources_json  TEXT,
    redactions_json TEXT,
    created_at    REAL NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_session_created
    ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS pairing (
    singleton  INTEGER PRIMARY KEY CHECK (singleton = 1),
    owner_uid  TEXT,
    paired_at  REAL
);
INSERT OR IGNORE INTO pairing(singleton, owner_uid, paired_at) VALUES (1, NULL, NULL);

CREATE TABLE IF NOT EXISTS attachments (
    id          TEXT PRIMARY KEY,
    owner_uid   TEXT NOT NULL,
    session_id  TEXT,
    name        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    path        TEXT NOT NULL,
    text_excerpt TEXT,
    created_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_session ON attachments(session_id);

CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT
);
"""


def init() -> None:
    with _conn() as c:
        c.executescript(_BASE_SCHEMA)
        _safe_alter(c, "ALTER TABLE messages ADD COLUMN artifact_json TEXT")
        _safe_alter(
            c,
            "ALTER TABLE messages ADD COLUMN attachments_json TEXT",
        )


# ---- pairing -------------------------------------------------------------


def get_owner_uid() -> str | None:
    with _conn() as c:
        row = c.execute("SELECT owner_uid FROM pairing WHERE singleton = 1").fetchone()
    return row["owner_uid"] if row and row["owner_uid"] else None


def claim_owner(uid: str) -> bool:
    """Set the owner UID if not yet set. Returns True if claimed by this call."""
    with _conn() as c:
        cur = c.execute(
            "UPDATE pairing SET owner_uid = ?, paired_at = ? "
            "WHERE singleton = 1 AND owner_uid IS NULL",
            (uid, time.time()),
        )
        return cur.rowcount == 1


def reset_owner() -> None:
    with _conn() as c:
        c.execute("UPDATE pairing SET owner_uid = NULL, paired_at = NULL WHERE singleton = 1")


# ---- sessions ------------------------------------------------------------


def create_session(owner_uid: str, title: str) -> dict:
    sid = str(uuid.uuid4())
    now = time.time()
    with _conn() as c:
        c.execute(
            "INSERT INTO sessions(id, owner_uid, title, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (sid, owner_uid, title.strip()[:120] or "New chat", now, now),
        )
    return {"id": sid, "title": title, "createdAt": now, "updatedAt": now}


def list_sessions(owner_uid: str, limit: int = 100) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT id, title, created_at, updated_at FROM sessions "
            "WHERE owner_uid = ? ORDER BY updated_at DESC LIMIT ?",
            (owner_uid, limit),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "title": r["title"],
            "createdAt": r["created_at"],
            "updatedAt": r["updated_at"],
        }
        for r in rows
    ]


def get_session(owner_uid: str, sid: str) -> dict | None:
    with _conn() as c:
        row = c.execute(
            "SELECT id, title, created_at, updated_at FROM sessions "
            "WHERE id = ? AND owner_uid = ?",
            (sid, owner_uid),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "title": row["title"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def rename_session(owner_uid: str, sid: str, title: str) -> bool:
    with _conn() as c:
        cur = c.execute(
            "UPDATE sessions SET title = ?, updated_at = ? "
            "WHERE id = ? AND owner_uid = ?",
            (title.strip()[:120] or "Untitled", time.time(), sid, owner_uid),
        )
        return cur.rowcount == 1


def delete_session(owner_uid: str, sid: str) -> bool:
    with _conn() as c:
        cur = c.execute(
            "DELETE FROM sessions WHERE id = ? AND owner_uid = ?",
            (sid, owner_uid),
        )
        return cur.rowcount == 1


def touch_session(owner_uid: str, sid: str) -> None:
    with _conn() as c:
        c.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ? AND owner_uid = ?",
            (time.time(), sid, owner_uid),
        )


# ---- messages ------------------------------------------------------------


def append_message(
    owner_uid: str,
    session_id: str,
    role: str,
    content: str,
    used_search: bool = False,
    sources: list[dict] | None = None,
    redactions: list[str] | None = None,
    artifact: dict | None = None,
    attachments: list[dict] | None = None,
) -> dict:
    mid = str(uuid.uuid4())
    now = time.time()
    with _conn() as c:
        c.execute(
            "INSERT INTO messages(id, session_id, owner_uid, role, content, "
            "used_search, sources_json, redactions_json, artifact_json, "
            "attachments_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                mid,
                session_id,
                owner_uid,
                role,
                content,
                int(bool(used_search)),
                json.dumps(sources or []),
                json.dumps(redactions or []),
                json.dumps(artifact) if artifact else None,
                json.dumps(attachments or []),
                now,
            ),
        )
        c.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ? AND owner_uid = ?",
            (now, session_id, owner_uid),
        )
    return {
        "id": mid,
        "sessionId": session_id,
        "role": role,
        "content": content,
        "usedSearch": bool(used_search),
        "sources": sources or [],
        "redactions": redactions or [],
        "artifact": artifact,
        "attachments": attachments or [],
        "createdAt": now,
    }


def clear_messages(owner_uid: str, session_id: str) -> int:
    with _conn() as c:
        cur = c.execute(
            "DELETE FROM messages WHERE session_id = ? AND owner_uid = ?",
            (session_id, owner_uid),
        )
        c.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ? AND owner_uid = ?",
            (time.time(), session_id, owner_uid),
        )
        return cur.rowcount


def message_stats(owner_uid: str, session_id: str) -> dict:
    """Cheap byte/char tally so the web app can draw a context meter
    without us shipping a tokenizer. Char count is the API contract;
    web converts it to an approximate token count."""
    with _conn() as c:
        row = c.execute(
            "SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)), 0) AS chars "
            "FROM messages "
            "WHERE session_id = ? AND owner_uid = ?",
            (session_id, owner_uid),
        ).fetchone()
    return {"messages": row["n"], "chars": row["chars"]}


def list_messages(owner_uid: str, session_id: str, limit: int = 500) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT m.id, m.role, m.content, m.used_search, m.sources_json, "
            "m.redactions_json, m.artifact_json, m.attachments_json, m.created_at "
            "FROM messages m "
            "JOIN sessions s ON s.id = m.session_id "
            "WHERE m.session_id = ? AND s.owner_uid = ? "
            "ORDER BY m.created_at ASC LIMIT ?",
            (session_id, owner_uid, limit),
        ).fetchall()
    return [_row_to_message(r) for r in rows]


def _row_to_message(r: sqlite3.Row) -> dict:
    artifact = _json(r["artifact_json"]) if "artifact_json" in r.keys() else None
    attachments = (
        _json(r["attachments_json"])
        if "attachments_json" in r.keys()
        else None
    )
    return {
        "id": r["id"],
        "role": r["role"],
        "content": r["content"],
        "usedSearch": bool(r["used_search"]),
        "sources": _json(r["sources_json"]) or [],
        "redactions": _json(r["redactions_json"]) or [],
        "artifact": artifact,
        "attachments": attachments or [],
        "createdAt": r["created_at"],
    }


def _json(s: Any) -> Any:
    if not s:
        return None
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return None


# ---- attachments --------------------------------------------------------


def insert_attachment(
    owner_uid: str,
    session_id: str | None,
    name: str,
    mime: str,
    size: int,
    path: str,
    text_excerpt: str | None,
) -> dict:
    aid = str(uuid.uuid4())
    now = time.time()
    with _conn() as c:
        c.execute(
            "INSERT INTO attachments(id, owner_uid, session_id, name, mime, "
            "size, path, text_excerpt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (aid, owner_uid, session_id, name, mime, size, path, text_excerpt, now),
        )
    return {
        "id": aid,
        "name": name,
        "mime": mime,
        "size": size,
        "hasText": bool(text_excerpt),
        "createdAt": now,
    }


def list_attachments(owner_uid: str, ids: list[str]) -> list[dict]:
    if not ids:
        return []
    placeholders = ",".join(["?"] * len(ids))
    with _conn() as c:
        rows = c.execute(
            f"SELECT id, owner_uid, session_id, name, mime, size, path, "
            f"text_excerpt FROM attachments WHERE owner_uid = ? "
            f"AND id IN ({placeholders})",
            (owner_uid, *ids),
        ).fetchall()
    return [dict(r) for r in rows]


def get_attachment(owner_uid: str, aid: str) -> dict | None:
    with _conn() as c:
        row = c.execute(
            "SELECT id, owner_uid, session_id, name, mime, size, path, "
            "text_excerpt, created_at FROM attachments "
            "WHERE owner_uid = ? AND id = ?",
            (owner_uid, aid),
        ).fetchone()
    return dict(row) if row else None


def delete_attachment(owner_uid: str, aid: str) -> bool:
    with _conn() as c:
        cur = c.execute(
            "DELETE FROM attachments WHERE owner_uid = ? AND id = ?",
            (owner_uid, aid),
        )
        return cur.rowcount == 1


# ---- runtime kv settings ------------------------------------------------


def get_kv(key: str) -> str | None:
    with _conn() as c:
        row = c.execute("SELECT v FROM kv WHERE k = ?", (key,)).fetchone()
    return row["v"] if row else None


def set_kv(key: str, value: str | None) -> None:
    with _conn() as c:
        if value is None:
            c.execute("DELETE FROM kv WHERE k = ?", (key,))
        else:
            c.execute(
                "INSERT INTO kv(k, v) VALUES(?, ?) "
                "ON CONFLICT(k) DO UPDATE SET v = excluded.v",
                (key, value),
            )
