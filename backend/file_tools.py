"""Workspace file tools for the agent.

These let the model read, write, patch, list, and grep files without going
through shell heredocs. Each call stays inside the workspace root.
"""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .config import settings
from .terminal import resolve_cwd, workspace_root


_BINARY_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff",
    ".pdf", ".zip", ".gz", ".tar", ".7z", ".rar", ".mp3", ".mp4", ".mov",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".pyc", ".so", ".dylib", ".dll", ".exe", ".bin", ".o", ".a",
}
_MAX_READ_BYTES = 200_000
_MAX_WRITE_BYTES = 1_000_000
_MAX_LIST_ENTRIES = 400
_MAX_GREP_MATCHES = 200


READ_FILE_TOOL = {
    "type": "function",
    "name": "read_file",
    "description": (
        "Read a UTF-8 text file from the workspace. Returns the file contents. "
        "Prefer this over `cat` for source files. Refuses binary files."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path relative to the workspace root, e.g. `src/App.tsx`.",
            },
            "start_line": {
                "type": "integer",
                "description": "Optional 1-based start line. Omit to read from beginning.",
                "minimum": 1,
            },
            "end_line": {
                "type": "integer",
                "description": "Optional 1-based end line (inclusive). Omit to read to end.",
                "minimum": 1,
            },
        },
        "required": ["path", "start_line", "end_line"],
        "additionalProperties": False,
    },
    "strict": True,
}

WRITE_FILE_TOOL = {
    "type": "function",
    "name": "write_file",
    "description": (
        "Create or overwrite a UTF-8 text file in the workspace with the given "
        "content. Creates parent directories as needed. Use for any new or "
        "fully-rewritten source file. For small targeted edits prefer apply_patch."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path relative to the workspace root.",
            },
            "content": {
                "type": "string",
                "description": "Full file contents to write. UTF-8 text only.",
            },
        },
        "required": ["path", "content"],
        "additionalProperties": False,
    },
    "strict": True,
}

APPLY_PATCH_TOOL = {
    "type": "function",
    "name": "apply_patch",
    "description": (
        "Apply a small targeted edit to an existing text file by replacing one "
        "exact string with another. `old_string` must appear exactly once in "
        "the file. Use this for surgical edits; use write_file for full rewrites."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path relative to the workspace root.",
            },
            "old_string": {
                "type": "string",
                "description": "Exact text to replace. Must occur exactly once.",
            },
            "new_string": {
                "type": "string",
                "description": "Replacement text.",
            },
        },
        "required": ["path", "old_string", "new_string"],
        "additionalProperties": False,
    },
    "strict": True,
}

LIST_DIR_TOOL = {
    "type": "function",
    "name": "list_dir",
    "description": (
        "List entries in a workspace directory. Skips noisy directories "
        "(node_modules, .git, dist, etc). Use to inspect project layout."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Directory relative to the workspace root. Use `.` for the root.",
            },
        },
        "required": ["path"],
        "additionalProperties": False,
    },
    "strict": True,
}

GREP_WORKSPACE_TOOL = {
    "type": "function",
    "name": "grep_workspace",
    "description": (
        "Search the workspace for a regex pattern. Returns matching paths with "
        "line numbers and a snippet. Use this to find symbols, references, or "
        "configuration entries before editing."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Regex (POSIX extended) to search for.",
            },
            "path": {
                "type": "string",
                "description": "Optional sub-path to limit the search. Use `.` for workspace root.",
            },
            "glob": {
                "type": "string",
                "description": "Optional file glob filter, e.g. `*.tsx` or `package.json`.",
            },
        },
        "required": ["pattern", "path", "glob"],
        "additionalProperties": False,
    },
    "strict": True,
}

FILE_TOOLS = [
    READ_FILE_TOOL,
    WRITE_FILE_TOOL,
    APPLY_PATCH_TOOL,
    LIST_DIR_TOOL,
    GREP_WORKSPACE_TOOL,
]

_SKIP_DIRS = {
    ".cache", ".git", ".idea", ".next", ".pytest_cache", ".turbo", ".venv",
    "__pycache__", "build", "coverage", "dist", "dist-backend", "node_modules",
    "out", "target", "vendor",
}


@dataclass
class _ToolResult:
    ok: bool
    data: dict

    def json(self) -> str:
        payload = {"ok": self.ok, **self.data}
        return json.dumps(payload, ensure_ascii=False)


def _resolve_path(path: str, must_exist: bool = True) -> Path:
    raw = (path or "").strip()
    if not raw:
        raise ValueError("path is required")
    root = workspace_root()
    candidate = Path(raw).expanduser()
    candidate = candidate if candidate.is_absolute() else (root / candidate)
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as e:
        raise ValueError(f"path must stay inside workspace root {root}") from e
    if must_exist and not resolved.exists():
        raise ValueError(f"path does not exist: {resolved.relative_to(root)}")
    return resolved


def _is_binary(path: Path) -> bool:
    if path.suffix.lower() in _BINARY_SUFFIXES:
        return True
    try:
        chunk = path.read_bytes()[:4096]
    except OSError:
        return True
    return b"\x00" in chunk


def _read_file(args: dict) -> _ToolResult:
    path = _resolve_path(str(args.get("path") or ""))
    if not path.is_file():
        return _ToolResult(False, {"error": "not a file"})
    if path.stat().st_size > _MAX_READ_BYTES and not args.get("start_line"):
        return _ToolResult(False, {
            "error": (
                f"file is larger than {_MAX_READ_BYTES} bytes; pass start_line "
                "and end_line to read a slice"
            ),
        })
    if _is_binary(path):
        return _ToolResult(False, {"error": "binary file; refusing to read as text"})
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return _ToolResult(False, {"error": str(e)})

    start = args.get("start_line")
    end = args.get("end_line")
    if start or end:
        lines = text.splitlines(keepends=True)
        start_idx = max(0, int(start or 1) - 1)
        end_idx = min(len(lines), int(end or len(lines)))
        text = "".join(lines[start_idx:end_idx])

    root = workspace_root()
    return _ToolResult(True, {
        "path": str(path.relative_to(root)),
        "content": text,
        "lines": text.count("\n") + (1 if text and not text.endswith("\n") else 0),
        "bytes": len(text.encode("utf-8")),
    })


def _write_file(args: dict) -> _ToolResult:
    content = args.get("content")
    if content is None:
        return _ToolResult(False, {"error": "content is required"})
    if not isinstance(content, str):
        content = str(content)
    if len(content.encode("utf-8")) > _MAX_WRITE_BYTES:
        return _ToolResult(False, {
            "error": f"content exceeds {_MAX_WRITE_BYTES} bytes; split into smaller files",
        })
    path = _resolve_path(str(args.get("path") or ""), must_exist=False)
    if path.exists() and path.is_dir():
        return _ToolResult(False, {"error": "path is a directory"})
    created = not path.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_text(content, encoding="utf-8")
    except OSError as e:
        return _ToolResult(False, {"error": str(e)})
    root = workspace_root()
    rel = str(path.relative_to(root))
    return _ToolResult(True, {
        "path": rel,
        "created": created,
        "bytes": len(content.encode("utf-8")),
        "lines": content.count("\n") + (1 if content and not content.endswith("\n") else 0),
        "changed_files": [rel],
    })


def _apply_patch(args: dict) -> _ToolResult:
    old = args.get("old_string")
    new = args.get("new_string")
    if old is None or new is None:
        return _ToolResult(False, {"error": "old_string and new_string are required"})
    if not isinstance(old, str) or not isinstance(new, str):
        return _ToolResult(False, {"error": "old_string and new_string must be strings"})
    if old == new:
        return _ToolResult(False, {"error": "old_string and new_string are identical"})
    if not old:
        return _ToolResult(False, {"error": "old_string must not be empty"})

    path = _resolve_path(str(args.get("path") or ""))
    if not path.is_file():
        return _ToolResult(False, {"error": "not a file"})
    if _is_binary(path):
        return _ToolResult(False, {"error": "binary file; refusing to patch"})

    try:
        original = path.read_text(encoding="utf-8")
    except OSError as e:
        return _ToolResult(False, {"error": str(e)})

    occurrences = original.count(old)
    if occurrences == 0:
        return _ToolResult(False, {
            "error": "old_string not found in file; read the file again and retry",
        })
    if occurrences > 1:
        return _ToolResult(False, {
            "error": (
                f"old_string occurs {occurrences} times; expand it with more "
                "surrounding context so it is unique"
            ),
        })

    updated = original.replace(old, new, 1)
    try:
        path.write_text(updated, encoding="utf-8")
    except OSError as e:
        return _ToolResult(False, {"error": str(e)})

    root = workspace_root()
    rel = str(path.relative_to(root))
    return _ToolResult(True, {
        "path": rel,
        "replacements": 1,
        "delta_bytes": len(updated.encode("utf-8")) - len(original.encode("utf-8")),
        "changed_files": [rel],
    })


def _list_dir(args: dict) -> _ToolResult:
    target = _resolve_path(str(args.get("path") or "."))
    if not target.is_dir():
        return _ToolResult(False, {"error": "not a directory"})
    root = workspace_root()
    entries: list[dict] = []
    try:
        children = sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    except OSError as e:
        return _ToolResult(False, {"error": str(e)})
    for child in children:
        if child.name in _SKIP_DIRS or child.name == ".DS_Store":
            continue
        kind = "dir" if child.is_dir() else "file"
        try:
            size = child.stat().st_size if kind == "file" else None
        except OSError:
            size = None
        entries.append({
            "name": child.name,
            "kind": kind,
            "size": size,
            "path": str(child.relative_to(root)),
        })
        if len(entries) >= _MAX_LIST_ENTRIES:
            break
    return _ToolResult(True, {
        "path": str(target.relative_to(root) or "."),
        "entries": entries,
        "truncated": len(entries) >= _MAX_LIST_ENTRIES,
    })


def _grep_workspace(args: dict) -> _ToolResult:
    pattern = str(args.get("pattern") or "").strip()
    if not pattern:
        return _ToolResult(False, {"error": "pattern is required"})
    try:
        re.compile(pattern)
    except re.error as e:
        return _ToolResult(False, {"error": f"invalid regex: {e}"})

    sub = str(args.get("path") or ".") or "."
    base = resolve_cwd(sub)
    glob = str(args.get("glob") or "").strip()

    cmd: list[str] = []
    if _command_available("rg"):
        cmd = [
            "rg", "--no-heading", "--with-filename", "--line-number",
            "--color", "never", "--max-count", "50",
        ]
        for skip in _SKIP_DIRS:
            cmd.extend(["--glob", f"!{skip}"])
        if glob:
            cmd.extend(["--glob", glob])
        cmd.extend(["-e", pattern, "."])
    else:
        include = f"--include={glob}" if glob else None
        cmd = ["grep", "-RIn"]
        for skip in _SKIP_DIRS:
            cmd.append(f"--exclude-dir={skip}")
        if include:
            cmd.append(include)
        cmd.extend(["-E", pattern, "."])

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(base),
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (subprocess.SubprocessError, FileNotFoundError) as e:
        return _ToolResult(False, {"error": str(e)})

    matches: list[dict] = []
    for raw in (proc.stdout or "").splitlines():
        parts = raw.split(":", 2)
        if len(parts) < 3:
            continue
        file_part, line_no, snippet = parts
        try:
            line_int = int(line_no)
        except ValueError:
            continue
        rel = str(
            (base / file_part).resolve().relative_to(workspace_root())
        ) if file_part.startswith("./") or not file_part.startswith("/") else file_part
        matches.append({
            "path": rel.lstrip("./"),
            "line": line_int,
            "match": snippet.strip()[:240],
        })
        if len(matches) >= _MAX_GREP_MATCHES:
            break

    return _ToolResult(True, {
        "pattern": pattern,
        "matches": matches,
        "truncated": len(matches) >= _MAX_GREP_MATCHES,
        "stderr": (proc.stderr or "").strip()[:600],
    })


def _command_available(name: str) -> bool:
    try:
        result = subprocess.run(
            ["which", name],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return False
    return result.returncode == 0 and bool(result.stdout.strip())


_HANDLERS = {
    "read_file": _read_file,
    "write_file": _write_file,
    "apply_patch": _apply_patch,
    "list_dir": _list_dir,
    "grep_workspace": _grep_workspace,
}


def is_file_tool(name: str) -> bool:
    return name in _HANDLERS


async def execute_tool(name: str, args: dict) -> str:
    if not settings.terminal_enabled:
        return _ToolResult(False, {"error": "workspace tools are disabled"}).json()
    handler = _HANDLERS.get(name)
    if handler is None:
        return _ToolResult(False, {"error": f"unknown file tool: {name}"}).json()
    try:
        return handler(args or {}).json()
    except ValueError as e:
        return _ToolResult(False, {"error": str(e)}).json()
    except Exception as e:  # pragma: no cover - defensive
        return _ToolResult(False, {"error": f"{type(e).__name__}: {e}"}).json()
