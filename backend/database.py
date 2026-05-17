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
    space       TEXT NOT NULL DEFAULT 'general',
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

CREATE TABLE IF NOT EXISTS learning_materials (
    id            TEXT PRIMARY KEY,
    owner_uid     TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    attachment_id TEXT,
    title         TEXT NOT NULL,
    kind          TEXT NOT NULL,
    mime          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    status        TEXT NOT NULL,
    summary       TEXT,
    text_excerpt  TEXT,
    created_at    REAL NOT NULL,
    updated_at    REAL NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_learning_materials_session
    ON learning_materials(owner_uid, session_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS business_actions (
    id          TEXT PRIMARY KEY,
    owner_uid   TEXT NOT NULL,
    kind        TEXT NOT NULL,
    status      TEXT NOT NULL,
    title       TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    result_json  TEXT,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_business_actions_owner_status
    ON business_actions(owner_uid, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT
);
"""


def init() -> None:
    with _conn() as c:
        c.executescript(_BASE_SCHEMA)
        _safe_alter(c, "ALTER TABLE sessions ADD COLUMN space TEXT NOT NULL DEFAULT 'general'")
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_owner_space_updated "
            "ON sessions(owner_uid, space, updated_at DESC)"
        )
        _safe_alter(c, "ALTER TABLE messages ADD COLUMN artifact_json TEXT")
        _safe_alter(
            c,
            "ALTER TABLE messages ADD COLUMN attachments_json TEXT",
        )
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS learning_materials (
                id            TEXT PRIMARY KEY,
                owner_uid     TEXT NOT NULL,
                session_id    TEXT NOT NULL,
                attachment_id TEXT,
                title         TEXT NOT NULL,
                kind          TEXT NOT NULL,
                mime          TEXT NOT NULL,
                size          INTEGER NOT NULL,
                status        TEXT NOT NULL,
                summary       TEXT,
                text_excerpt  TEXT,
                created_at    REAL NOT NULL,
                updated_at    REAL NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_learning_materials_session
                ON learning_materials(owner_uid, session_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS business_actions (
                id          TEXT PRIMARY KEY,
                owner_uid   TEXT NOT NULL,
                kind        TEXT NOT NULL,
                status      TEXT NOT NULL,
                title       TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                result_json  TEXT,
                created_at  REAL NOT NULL,
                updated_at  REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_business_actions_owner_status
                ON business_actions(owner_uid, status, updated_at DESC);
            CREATE TABLE IF NOT EXISTS learning_artifacts (
                id                       TEXT PRIMARY KEY,
                owner_uid                TEXT NOT NULL,
                session_id               TEXT NOT NULL,
                kind                     TEXT NOT NULL,
                title                    TEXT NOT NULL,
                payload_json             TEXT NOT NULL,
                source_material_ids_json TEXT,
                created_at               REAL NOT NULL,
                updated_at               REAL NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_learning_artifacts_session
                ON learning_artifacts(owner_uid, session_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS study_items (
                id                 TEXT PRIMARY KEY,
                owner_uid          TEXT NOT NULL,
                session_id         TEXT NOT NULL,
                source_material_id TEXT,
                source_title       TEXT,
                source_hint        TEXT,
                source_excerpt     TEXT,
                type               TEXT NOT NULL,
                topic              TEXT NOT NULL,
                prompt             TEXT NOT NULL,
                answer             TEXT NOT NULL,
                options_json       TEXT,
                status             TEXT NOT NULL DEFAULT 'active',
                due_at             REAL NOT NULL,
                interval_days      REAL NOT NULL DEFAULT 0,
                ease_factor        REAL NOT NULL DEFAULT 2.5,
                repetitions        INTEGER NOT NULL DEFAULT 0,
                lapses             INTEGER NOT NULL DEFAULT 0,
                created_at         REAL NOT NULL,
                updated_at         REAL NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_study_items_session_due
                ON study_items(owner_uid, session_id, status, due_at);
            CREATE INDEX IF NOT EXISTS idx_study_items_topic
                ON study_items(owner_uid, session_id, topic);
            CREATE TABLE IF NOT EXISTS review_events (
                id              TEXT PRIMARY KEY,
                owner_uid       TEXT NOT NULL,
                session_id      TEXT NOT NULL,
                study_item_id   TEXT NOT NULL,
                rating          TEXT NOT NULL,
                previous_due_at REAL,
                next_due_at     REAL NOT NULL,
                interval_days   REAL NOT NULL,
                ease_factor     REAL NOT NULL,
                repetitions     INTEGER NOT NULL,
                created_at      REAL NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                FOREIGN KEY(study_item_id) REFERENCES study_items(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_review_events_session_created
                ON review_events(owner_uid, session_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_review_events_item
                ON review_events(study_item_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS topic_mastery (
                id             TEXT PRIMARY KEY,
                owner_uid      TEXT NOT NULL,
                session_id     TEXT NOT NULL,
                topic          TEXT NOT NULL,
                state          TEXT NOT NULL,
                score          REAL NOT NULL DEFAULT 0,
                due_count      INTEGER NOT NULL DEFAULT 0,
                reviewed_count INTEGER NOT NULL DEFAULT 0,
                correct_rate   REAL NOT NULL DEFAULT 0,
                updated_at     REAL NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                UNIQUE(owner_uid, session_id, topic)
            );
            CREATE INDEX IF NOT EXISTS idx_topic_mastery_session
                ON topic_mastery(owner_uid, session_id, state, updated_at DESC);
            CREATE TABLE IF NOT EXISTS exam_plan (
                id                   TEXT PRIMARY KEY,
                owner_uid            TEXT NOT NULL,
                session_id           TEXT NOT NULL,
                exam_date            TEXT,
                daily_target         INTEGER NOT NULL DEFAULT 20,
                title                TEXT,
                created_at           REAL NOT NULL,
                updated_at           REAL NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                UNIQUE(owner_uid, session_id)
            );
            """
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


def reassign_owner(uid: str) -> None:
    """Move this local device and existing local data to a new Firebase UID."""
    old_uid = get_owner_uid()
    now = time.time()
    with _conn() as c:
        c.execute(
            "UPDATE pairing SET owner_uid = ?, paired_at = ? WHERE singleton = 1",
            (uid, now),
        )
        if old_uid and old_uid != uid:
            c.execute("UPDATE sessions SET owner_uid = ? WHERE owner_uid = ?", (uid, old_uid))
            c.execute("UPDATE messages SET owner_uid = ? WHERE owner_uid = ?", (uid, old_uid))
            c.execute("UPDATE attachments SET owner_uid = ? WHERE owner_uid = ?", (uid, old_uid))
            c.execute("UPDATE learning_materials SET owner_uid = ? WHERE owner_uid = ?", (uid, old_uid))
            c.execute("UPDATE learning_artifacts SET owner_uid = ? WHERE owner_uid = ?", (uid, old_uid))
            c.execute("UPDATE study_items SET owner_uid = ? WHERE owner_uid = ?", (uid, old_uid))
            c.execute("UPDATE review_events SET owner_uid = ? WHERE owner_uid = ?", (uid, old_uid))
            c.execute("UPDATE topic_mastery SET owner_uid = ? WHERE owner_uid = ?", (uid, old_uid))
            c.execute("UPDATE exam_plan SET owner_uid = ? WHERE owner_uid = ?", (uid, old_uid))
            c.execute("UPDATE business_actions SET owner_uid = ? WHERE owner_uid = ?", (uid, old_uid))


def reset_owner() -> None:
    with _conn() as c:
        c.execute("UPDATE pairing SET owner_uid = NULL, paired_at = NULL WHERE singleton = 1")


# ---- sessions ------------------------------------------------------------

_VALID_SPACES = {"general", "business", "coding", "learning"}


def _normalize_space(space: str | None) -> str:
    value = (space or "general").strip().lower()
    return value if value in _VALID_SPACES else "general"


def create_session(owner_uid: str, title: str, space: str | None = "general") -> dict:
    sid = str(uuid.uuid4())
    now = time.time()
    clean_title = title.strip()[:120] or "New chat"
    clean_space = _normalize_space(space)
    with _conn() as c:
        c.execute(
            "INSERT INTO sessions(id, owner_uid, title, space, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (sid, owner_uid, clean_title, clean_space, now, now),
        )
    return {
        "id": sid,
        "title": clean_title,
        "space": clean_space,
        "createdAt": now,
        "updatedAt": now,
    }


def list_sessions(owner_uid: str, limit: int = 100) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT id, title, space, created_at, updated_at FROM sessions "
            "WHERE owner_uid = ? ORDER BY updated_at DESC LIMIT ?",
            (owner_uid, limit),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "title": r["title"],
            "space": r["space"],
            "createdAt": r["created_at"],
            "updatedAt": r["updated_at"],
        }
        for r in rows
    ]


def get_session(owner_uid: str, sid: str) -> dict | None:
    with _conn() as c:
        row = c.execute(
            "SELECT id, title, space, created_at, updated_at FROM sessions "
            "WHERE id = ? AND owner_uid = ?",
            (sid, owner_uid),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "title": row["title"],
        "space": row["space"],
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


# ---- learning notebooks -------------------------------------------------


def insert_learning_material(
    owner_uid: str,
    session_id: str,
    title: str,
    kind: str,
    mime: str,
    size: int,
    status: str,
    summary: str | None,
    text_excerpt: str | None,
    attachment_id: str | None = None,
) -> dict:
    mid = str(uuid.uuid4())
    now = time.time()
    clean_title = title.strip()[:160] or "Untitled material"
    with _conn() as c:
        c.execute(
            "INSERT INTO learning_materials("
            "id, owner_uid, session_id, attachment_id, title, kind, mime, "
            "size, status, summary, text_excerpt, created_at, updated_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                mid,
                owner_uid,
                session_id,
                attachment_id,
                clean_title,
                kind,
                mime,
                size,
                status,
                summary,
                text_excerpt,
                now,
                now,
            ),
        )
        c.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ? AND owner_uid = ?",
            (now, session_id, owner_uid),
        )
    return {
        "id": mid,
        "attachmentId": attachment_id,
        "title": clean_title,
        "kind": kind,
        "mime": mime,
        "size": size,
        "status": status,
        "summary": summary or "",
        "hasText": bool(text_excerpt),
        "createdAt": now,
        "updatedAt": now,
    }


def list_learning_materials(
    owner_uid: str,
    session_id: str,
    include_text: bool = False,
) -> list[dict]:
    columns = (
        "id, attachment_id, title, kind, mime, size, status, summary, "
        "text_excerpt, created_at, updated_at"
    )
    with _conn() as c:
        rows = c.execute(
            f"SELECT {columns} FROM learning_materials "
            "WHERE owner_uid = ? AND session_id = ? "
            "ORDER BY created_at ASC",
            (owner_uid, session_id),
        ).fetchall()
    return [_row_to_learning_material(row, include_text=include_text) for row in rows]


def delete_learning_material(owner_uid: str, session_id: str, mid: str) -> bool:
    with _conn() as c:
        cur = c.execute(
            "DELETE FROM learning_materials "
            "WHERE owner_uid = ? AND session_id = ? AND id = ?",
            (owner_uid, session_id, mid),
        )
        if cur.rowcount:
            c.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ? AND owner_uid = ?",
                (time.time(), session_id, owner_uid),
            )
        return cur.rowcount == 1


def _row_to_learning_material(row: sqlite3.Row, include_text: bool = False) -> dict:
    item = {
        "id": row["id"],
        "attachmentId": row["attachment_id"],
        "title": row["title"],
        "kind": row["kind"],
        "mime": row["mime"],
        "size": row["size"],
        "status": row["status"],
        "summary": row["summary"] or "",
        "hasText": bool(row["text_excerpt"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    if include_text:
        item["textExcerpt"] = row["text_excerpt"] or ""
    return item


# ---- business actions ---------------------------------------------------


def create_business_action(
    owner_uid: str,
    kind: str,
    title: str,
    payload: dict,
) -> dict:
    aid = str(uuid.uuid4())
    now = time.time()
    with _conn() as c:
        c.execute(
            "INSERT INTO business_actions("
            "id, owner_uid, kind, status, title, payload_json, result_json, "
            "created_at, updated_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                aid,
                owner_uid,
                kind,
                "pending",
                title.strip()[:180] or kind,
                json.dumps(payload),
                None,
                now,
                now,
            ),
        )
    return {
        "id": aid,
        "kind": kind,
        "status": "pending",
        "title": title.strip()[:180] or kind,
        "payload": payload,
        "result": None,
        "createdAt": now,
        "updatedAt": now,
    }


def list_business_actions(
    owner_uid: str,
    status: str | None = None,
    limit: int = 50,
) -> list[dict]:
    with _conn() as c:
        if status:
            rows = c.execute(
                "SELECT * FROM business_actions "
                "WHERE owner_uid = ? AND status = ? "
                "ORDER BY updated_at DESC LIMIT ?",
                (owner_uid, status, limit),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM business_actions WHERE owner_uid = ? "
                "ORDER BY updated_at DESC LIMIT ?",
                (owner_uid, limit),
            ).fetchall()
    return [_row_to_business_action(row) for row in rows]


def get_business_action(owner_uid: str, aid: str) -> dict | None:
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM business_actions WHERE owner_uid = ? AND id = ?",
            (owner_uid, aid),
        ).fetchone()
    return _row_to_business_action(row) if row else None


def update_business_action(
    owner_uid: str,
    aid: str,
    status: str,
    result: dict | None = None,
) -> dict | None:
    now = time.time()
    with _conn() as c:
        cur = c.execute(
            "UPDATE business_actions SET status = ?, result_json = ?, updated_at = ? "
            "WHERE owner_uid = ? AND id = ?",
            (
                status,
                json.dumps(result) if result is not None else None,
                now,
                owner_uid,
                aid,
            ),
        )
        if cur.rowcount != 1:
            return None
    return get_business_action(owner_uid, aid)


def _row_to_business_action(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "status": row["status"],
        "title": row["title"],
        "payload": _json(row["payload_json"]) or {},
        "result": _json(row["result_json"]) or None,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


# ---- Study OS ------------------------------------------------------------


def create_learning_artifact(
    owner_uid: str,
    session_id: str,
    kind: str,
    title: str,
    payload: dict,
    source_material_ids: list[str] | None = None,
) -> dict:
    aid = str(uuid.uuid4())
    now = time.time()
    clean_title = title.strip()[:180] or "Learning artifact"
    with _conn() as c:
        c.execute(
            "INSERT INTO learning_artifacts("
            "id, owner_uid, session_id, kind, title, payload_json, "
            "source_material_ids_json, created_at, updated_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                aid,
                owner_uid,
                session_id,
                kind.strip()[:40] or "guide",
                clean_title,
                json.dumps(payload),
                json.dumps(source_material_ids or []),
                now,
                now,
            ),
        )
        c.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ? AND owner_uid = ?",
            (now, session_id, owner_uid),
        )
    return {
        "id": aid,
        "kind": kind.strip()[:40] or "guide",
        "title": clean_title,
        "payload": payload,
        "sourceMaterialIds": source_material_ids or [],
        "createdAt": now,
        "updatedAt": now,
    }


def list_learning_artifacts(
    owner_uid: str,
    session_id: str,
    kind: str | None = None,
    limit: int = 50,
) -> list[dict]:
    with _conn() as c:
        if kind:
            rows = c.execute(
                "SELECT * FROM learning_artifacts "
                "WHERE owner_uid = ? AND session_id = ? AND kind = ? "
                "ORDER BY updated_at DESC LIMIT ?",
                (owner_uid, session_id, kind, limit),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM learning_artifacts "
                "WHERE owner_uid = ? AND session_id = ? "
                "ORDER BY updated_at DESC LIMIT ?",
                (owner_uid, session_id, limit),
            ).fetchall()
    return [_row_to_learning_artifact(row) for row in rows]


def latest_learning_artifact(
    owner_uid: str,
    session_id: str,
    kind: str,
) -> dict | None:
    items = list_learning_artifacts(owner_uid, session_id, kind, limit=1)
    return items[0] if items else None


def _row_to_learning_artifact(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "title": row["title"],
        "payload": _json(row["payload_json"]) or {},
        "sourceMaterialIds": _json(row["source_material_ids_json"]) or [],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def insert_study_items(
    owner_uid: str,
    session_id: str,
    items: list[dict],
) -> list[dict]:
    now = time.time()
    inserted: list[dict] = []
    with _conn() as c:
        for item in items:
            sid = str(uuid.uuid4())
            item_type = _normalize_study_item_type(item.get("type"))
            topic = str(item.get("topic") or "General").strip()[:120] or "General"
            prompt = str(item.get("prompt") or item.get("front") or "").strip()
            answer = str(item.get("answer") or item.get("back") or "").strip()
            if not prompt or not answer:
                continue
            options = item.get("options")
            clean_options = (
                [str(option).strip() for option in options if str(option).strip()]
                if isinstance(options, list)
                else []
            )
            c.execute(
                "INSERT INTO study_items("
                "id, owner_uid, session_id, source_material_id, source_title, "
                "source_hint, source_excerpt, type, topic, prompt, answer, "
                "options_json, status, due_at, interval_days, ease_factor, "
                "repetitions, lapses, created_at, updated_at"
                ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    sid,
                    owner_uid,
                    session_id,
                    _empty_to_none(item.get("sourceMaterialId")),
                    str(item.get("sourceTitle") or "")[:180],
                    str(item.get("sourceHint") or "")[:240],
                    str(item.get("sourceExcerpt") or "")[:1000],
                    item_type,
                    topic,
                    prompt[:2000],
                    answer[:4000],
                    json.dumps(clean_options),
                    "active",
                    now,
                    0.0,
                    2.5,
                    0,
                    0,
                    now,
                    now,
                ),
            )
            inserted.append(
                get_study_item_from_connection(c, owner_uid, session_id, sid)
            )
        if inserted:
            c.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ? AND owner_uid = ?",
                (now, session_id, owner_uid),
            )
    return [item for item in inserted if item]


def list_study_items(
    owner_uid: str,
    session_id: str,
    include_suspended: bool = False,
    limit: int = 500,
) -> list[dict]:
    status_filter = "" if include_suspended else "AND status != 'suspended'"
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM study_items "
            "WHERE owner_uid = ? AND session_id = ? "
            f"{status_filter} "
            "ORDER BY due_at ASC, created_at ASC LIMIT ?",
            (owner_uid, session_id, limit),
        ).fetchall()
    return [_row_to_study_item(row) for row in rows]


def due_study_items(
    owner_uid: str,
    session_id: str,
    now: float | None = None,
    limit: int = 50,
) -> list[dict]:
    cutoff = now if now is not None else time.time()
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM study_items "
            "WHERE owner_uid = ? AND session_id = ? AND status = 'active' "
            "AND due_at <= ? ORDER BY due_at ASC, created_at ASC LIMIT ?",
            (owner_uid, session_id, cutoff, limit),
        ).fetchall()
    return [_row_to_study_item(row) for row in rows]


def get_study_item(owner_uid: str, session_id: str, item_id: str) -> dict | None:
    with _conn() as c:
        return get_study_item_from_connection(c, owner_uid, session_id, item_id)


def get_study_item_from_connection(
    c: sqlite3.Connection,
    owner_uid: str,
    session_id: str,
    item_id: str,
) -> dict | None:
    row = c.execute(
        "SELECT * FROM study_items "
        "WHERE owner_uid = ? AND session_id = ? AND id = ?",
        (owner_uid, session_id, item_id),
    ).fetchone()
    return _row_to_study_item(row) if row else None


def update_study_item(
    owner_uid: str,
    session_id: str,
    item_id: str,
    patch: dict,
) -> dict | None:
    allowed = {
        "type": ("type", _normalize_study_item_type),
        "topic": ("topic", lambda v: str(v or "General").strip()[:120] or "General"),
        "prompt": ("prompt", lambda v: str(v or "").strip()[:2000]),
        "answer": ("answer", lambda v: str(v or "").strip()[:4000]),
        "options": ("options_json", lambda v: json.dumps(v if isinstance(v, list) else [])),
        "sourceHint": ("source_hint", lambda v: str(v or "")[:240]),
        "sourceExcerpt": ("source_excerpt", lambda v: str(v or "")[:1000]),
        "status": (
            "status",
            lambda v: str(v or "active").strip()
            if str(v or "active").strip() in {"active", "suspended"}
            else "active",
        ),
    }
    assignments: list[str] = []
    values: list[Any] = []
    for key, (column, cleaner) in allowed.items():
        if key in patch:
            assignments.append(f"{column} = ?")
            values.append(cleaner(patch[key]))
    if not assignments:
        return get_study_item(owner_uid, session_id, item_id)
    values.extend([time.time(), owner_uid, session_id, item_id])
    with _conn() as c:
        cur = c.execute(
            "UPDATE study_items SET "
            + ", ".join(assignments)
            + ", updated_at = ? WHERE owner_uid = ? AND session_id = ? AND id = ?",
            values,
        )
        if cur.rowcount != 1:
            return None
    return get_study_item(owner_uid, session_id, item_id)


def delete_study_item(owner_uid: str, session_id: str, item_id: str) -> bool:
    with _conn() as c:
        cur = c.execute(
            "DELETE FROM study_items "
            "WHERE owner_uid = ? AND session_id = ? AND id = ?",
            (owner_uid, session_id, item_id),
        )
        if cur.rowcount:
            c.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ? AND owner_uid = ?",
                (time.time(), session_id, owner_uid),
            )
        return cur.rowcount == 1


def record_review_event(
    owner_uid: str,
    session_id: str,
    item_id: str,
    rating: str,
    schedule: dict,
) -> dict | None:
    event_id = str(uuid.uuid4())
    now = time.time()
    with _conn() as c:
        item = get_study_item_from_connection(c, owner_uid, session_id, item_id)
        if not item:
            return None
        c.execute(
            "UPDATE study_items SET due_at = ?, interval_days = ?, "
            "ease_factor = ?, repetitions = ?, lapses = ?, updated_at = ? "
            "WHERE owner_uid = ? AND session_id = ? AND id = ?",
            (
                float(schedule["dueAt"]),
                float(schedule["intervalDays"]),
                float(schedule["easeFactor"]),
                int(schedule["repetitions"]),
                int(schedule["lapses"]),
                now,
                owner_uid,
                session_id,
                item_id,
            ),
        )
        c.execute(
            "INSERT INTO review_events("
            "id, owner_uid, session_id, study_item_id, rating, previous_due_at, "
            "next_due_at, interval_days, ease_factor, repetitions, created_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                event_id,
                owner_uid,
                session_id,
                item_id,
                rating,
                item["dueAt"],
                float(schedule["dueAt"]),
                float(schedule["intervalDays"]),
                float(schedule["easeFactor"]),
                int(schedule["repetitions"]),
                now,
            ),
        )
        c.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ? AND owner_uid = ?",
            (now, session_id, owner_uid),
        )
    return {
        "id": event_id,
        "studyItemId": item_id,
        "rating": rating,
        "previousDueAt": item["dueAt"],
        "nextDueAt": float(schedule["dueAt"]),
        "intervalDays": float(schedule["intervalDays"]),
        "easeFactor": float(schedule["easeFactor"]),
        "repetitions": int(schedule["repetitions"]),
        "createdAt": now,
    }


def list_review_events(
    owner_uid: str,
    session_id: str,
    limit: int = 200,
) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM review_events "
            "WHERE owner_uid = ? AND session_id = ? "
            "ORDER BY created_at DESC LIMIT ?",
            (owner_uid, session_id, limit),
        ).fetchall()
    return [_row_to_review_event(row) for row in rows]


def upsert_topic_mastery(
    owner_uid: str,
    session_id: str,
    topic: str,
    state: str,
    score: float,
    due_count: int,
    reviewed_count: int,
    correct_rate: float,
) -> dict:
    mid = str(uuid.uuid4())
    now = time.time()
    clean_topic = topic.strip()[:120] or "General"
    with _conn() as c:
        c.execute(
            "INSERT INTO topic_mastery("
            "id, owner_uid, session_id, topic, state, score, due_count, "
            "reviewed_count, correct_rate, updated_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(owner_uid, session_id, topic) DO UPDATE SET "
            "state = excluded.state, score = excluded.score, "
            "due_count = excluded.due_count, reviewed_count = excluded.reviewed_count, "
            "correct_rate = excluded.correct_rate, updated_at = excluded.updated_at",
            (
                mid,
                owner_uid,
                session_id,
                clean_topic,
                state,
                score,
                due_count,
                reviewed_count,
                correct_rate,
                now,
            ),
        )
    return {
        "topic": clean_topic,
        "state": state,
        "score": score,
        "dueCount": due_count,
        "reviewedCount": reviewed_count,
        "correctRate": correct_rate,
        "updatedAt": now,
    }


def list_topic_mastery(owner_uid: str, session_id: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM topic_mastery "
            "WHERE owner_uid = ? AND session_id = ? "
            "ORDER BY score ASC, updated_at DESC",
            (owner_uid, session_id),
        ).fetchall()
    return [
        {
            "topic": row["topic"],
            "state": row["state"],
            "score": row["score"],
            "dueCount": row["due_count"],
            "reviewedCount": row["reviewed_count"],
            "correctRate": row["correct_rate"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def get_exam_plan(owner_uid: str, session_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM exam_plan WHERE owner_uid = ? AND session_id = ?",
            (owner_uid, session_id),
        ).fetchone()
    return _row_to_exam_plan(row) if row else None


def set_exam_plan(
    owner_uid: str,
    session_id: str,
    exam_date: str | None,
    daily_target: int,
    title: str | None = None,
) -> dict:
    plan_id = str(uuid.uuid4())
    now = time.time()
    with _conn() as c:
        c.execute(
            "INSERT INTO exam_plan("
            "id, owner_uid, session_id, exam_date, daily_target, title, "
            "created_at, updated_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(owner_uid, session_id) DO UPDATE SET "
            "exam_date = excluded.exam_date, daily_target = excluded.daily_target, "
            "title = excluded.title, updated_at = excluded.updated_at",
            (
                plan_id,
                owner_uid,
                session_id,
                exam_date,
                max(1, min(int(daily_target or 20), 500)),
                (title or "").strip()[:160] or None,
                now,
                now,
            ),
        )
    return get_exam_plan(owner_uid, session_id) or {
        "examDate": exam_date,
        "dailyTarget": daily_target,
        "title": title or "",
        "createdAt": now,
        "updatedAt": now,
    }


def _row_to_exam_plan(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "examDate": row["exam_date"],
        "dailyTarget": row["daily_target"],
        "title": row["title"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _row_to_study_item(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "sourceMaterialId": row["source_material_id"],
        "sourceTitle": row["source_title"] or "",
        "sourceHint": row["source_hint"] or "",
        "sourceExcerpt": row["source_excerpt"] or "",
        "type": row["type"],
        "topic": row["topic"],
        "prompt": row["prompt"],
        "answer": row["answer"],
        "options": _json(row["options_json"]) or [],
        "status": row["status"],
        "dueAt": row["due_at"],
        "intervalDays": row["interval_days"],
        "easeFactor": row["ease_factor"],
        "repetitions": row["repetitions"],
        "lapses": row["lapses"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _row_to_review_event(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "studyItemId": row["study_item_id"],
        "rating": row["rating"],
        "previousDueAt": row["previous_due_at"],
        "nextDueAt": row["next_due_at"],
        "intervalDays": row["interval_days"],
        "easeFactor": row["ease_factor"],
        "repetitions": row["repetitions"],
        "createdAt": row["created_at"],
    }


def _normalize_study_item_type(raw: Any) -> str:
    value = str(raw or "qa").strip().lower()
    return value if value in {"qa", "cloze", "multiple_choice", "free_response"} else "qa"


def _empty_to_none(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


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
