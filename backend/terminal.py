"""Workspace-aware terminal execution for agent mode."""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from .config import settings


class TerminalError(Exception):
    pass


@dataclass
class TerminalResult:
    command: str
    cwd: str
    exit_code: int | None
    stdout: str
    stderr: str
    duration_s: float
    changed_files: list[str]
    timed_out: bool = False
    stdout_truncated: bool = False
    stderr_truncated: bool = False


TERMINAL_TOOL = {
    "type": "function",
    "name": "run_terminal_command",
    "description": (
        "Run a non-interactive shell command in the user's current workspace. "
        "Use this to inspect files, search code, create or edit project files, "
        "scaffold apps, run tests, install project dependencies when asked, or "
        "start build checks. Prefer read-only commands before editing. Keep "
        "work inside the workspace root. Do not run destructive commands unless "
        "the user explicitly requested them."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": (
                    "Non-empty shell command to run, for example `pwd` or "
                    "`npm test`. Never call this tool with an empty command."
                ),
            },
            "cwd": {
                "type": "string",
                "description": (
                    "Working directory relative to the workspace root. Use `.` "
                    "for the workspace root."
                ),
            },
            "timeout_s": {
                "type": "integer",
                "description": "Timeout in seconds, from 1 to 120. Use 60 normally.",
                "minimum": 1,
                "maximum": 120,
            },
        },
        "required": ["command", "cwd", "timeout_s"],
        "additionalProperties": False,
    },
    "strict": True,
}


_DANGEROUS_PATTERNS = (
    r"\brm\s+-[^\n;]*r[^\n;]*f\s+/(?:\s|$)",
    r"\bsudo\b",
    r"\bsu\s+-?\b",
    r"\bmkfs(?:\.[a-z0-9]+)?\b",
    r"\bdiskutil\s+erase",
    r"\bdd\s+.*\bof=/dev/",
    r"\bshutdown\b",
    r"\breboot\b",
    r":\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;",
)

_READ_ONLY_COMMAND_PATTERNS = (
    r"^pwd$",
    r"^ls(?:\s|$)",
    r"^find(?:\s|$)",
    r"^rg(?:\s|$)",
    r"^grep(?:\s|$)",
    r"^cat(?:\s|$)",
    r"^head(?:\s|$)",
    r"^tail(?:\s|$)",
    r"^wc(?:\s|$)",
    r"^du\s+-[a-zA-Z]*s[a-zA-Z]*(?:\s|$)",
    r"^sed\s+-n(?:\s|$)",
    r"^git\s+status(?:\s|$)",
    r"^git\s+diff(?:\s|$)",
    r"^git\s+log(?:\s|$)",
    r"^git\s+show(?:\s|$)",
    r"^git\s+branch\s+--show-current$",
)

_WRITE_HINTS = re.compile(
    r"(?:^|\s)(?:npm\s+(?:install|create)|pnpm\s+(?:add|create)|yarn\s+add|"
    r"mkdir|touch|cp|mv|rm|python|node|tee|apply_patch|git\s+add|git\s+commit|"
    r"git\s+push|brew|curl|chmod|chown)(?:\s|$)|[<>]|&&|\|\||;|\|",
    re.IGNORECASE,
)

_SNAPSHOT_SKIP_DIRS = {
    ".cache",
    ".git",
    ".next",
    ".pytest_cache",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "dist-backend",
    "node_modules",
}

_SNAPSHOT_SKIP_SUFFIXES = {
    ".log",
    ".pyc",
    ".tsbuildinfo",
}


def workspace_root_or_none() -> Path | None:
    raw = (settings.workspace_root or "").strip()
    if not raw:
        return None
    path = Path(raw).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        return None
    return path


def workspace_root() -> Path:
    root = workspace_root_or_none()
    if root is None:
        raise TerminalError(
            "No workspace selected. Open a folder in Coding before asking the "
            "agent to read, edit, or run project commands."
        )
    return root


def resolve_cwd(cwd: str | None = None) -> Path:
    root = workspace_root()
    raw = Path((cwd or ".").strip() or ".").expanduser()
    candidate = raw.resolve() if raw.is_absolute() else (root / raw).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as e:
        raise TerminalError(
            f"cwd must stay inside workspace root {root}"
        ) from e
    if not candidate.exists():
        raise TerminalError(f"cwd does not exist: {candidate}")
    if not candidate.is_dir():
        raise TerminalError(f"cwd is not a directory: {candidate}")
    return candidate


def _check_command(command: str) -> str:
    command = command.strip()
    if not command:
        raise TerminalError("command is required")
    if "\x00" in command:
        raise TerminalError("command contains a NUL byte")
    if not settings.terminal_allow_dangerous:
        low = command.lower()
        for pattern in _DANGEROUS_PATTERNS:
            if re.search(pattern, low):
                raise TerminalError(
                    "command blocked by local safety rules; set "
                    "TERMINAL_ALLOW_DANGEROUS=true to override"
                )
    return command


def command_policy(command: str) -> dict[str, object]:
    checked = (command or "").strip()
    low = checked.lower()
    dangerous = any(re.search(pattern, low) for pattern in _DANGEROUS_PATTERNS)
    if dangerous:
        return {
            "risk": "danger",
            "readOnly": False,
            "explanation": "This command matches a local safety blocklist.",
        }
    if checked and not _WRITE_HINTS.search(checked):
        for pattern in _READ_ONLY_COMMAND_PATTERNS:
            if re.search(pattern, checked, flags=re.IGNORECASE):
                return {
                    "risk": "read",
                    "readOnly": True,
                    "explanation": "This only inspects files, project state, or command output.",
                }
    return {
        "risk": "write",
        "readOnly": False,
        "explanation": "This may create, change, install, run, or verify project files.",
    }


def _truncate(text: str, limit: int) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    keep = max(0, limit - 120)
    return (
        text[:keep]
        + f"\n\n[output truncated after {limit} characters by terminal tool]",
        True,
    )


def _command_failure_hint(
    command: str,
    stderr: str,
    changed_files: list[str],
) -> str:
    low_command = command.lower()
    low_error = stderr.lower()
    if "could not determine executable to run" not in low_error:
        return ""
    if "tailwindcss" in low_command and "init" in low_command:
        return (
            "Privai hint: do not retry `npx tailwindcss init -p`. Tailwind v4 "
            "does not expose that init command in many installs. Use plain CSS "
            "for this app, or install/configure the current Tailwind Vite plugin "
            "only if the user explicitly asked for Tailwind."
        )
    if "create vite" in low_command or "create-vite" in low_command:
        if changed_files:
            return (
                "Privai hint: the Vite scaffold command exited non-zero but "
                "created files. Inspect the new folder and package.json, then "
                "continue with npm install/build inside that folder instead of "
                "rerunning the scaffold."
            )
        return (
            "Privai hint: use a non-interactive Vite command such as "
            "`npm create vite@latest my-app -- --template react`, then inspect "
            "the generated folder."
        )
    return (
        "Privai hint: npm could not find an executable for this package. Inspect "
        "package.json and use a concrete script or installed binary instead."
    )


def _workspace_snapshot(limit: int = 20000) -> dict[str, tuple[int, int]]:
    """Small best-effort file snapshot used for the UI changed-files panel."""
    root = workspace_root()
    snapshot: dict[str, tuple[int, int]] = {}
    count = 0
    for current, dirs, files in os.walk(root):
        dirs[:] = [
            d for d in dirs
            if d not in _SNAPSHOT_SKIP_DIRS and not d.startswith(".")
        ]
        current_path = Path(current)
        for name in files:
            if name == ".DS_Store" or any(
                name.endswith(s) for s in _SNAPSHOT_SKIP_SUFFIXES
            ):
                continue
            path = current_path / name
            try:
                stat = path.stat()
                rel = str(path.relative_to(root))
            except OSError:
                continue
            snapshot[rel] = (stat.st_mtime_ns, stat.st_size)
            count += 1
            if count > limit:
                return {}
    return snapshot


def _changed_files(
    before: dict[str, tuple[int, int]],
    after: dict[str, tuple[int, int]],
    limit: int = 200,
) -> list[str]:
    if not before and not after:
        return []
    changed = [
        path for path, meta in after.items()
        if before.get(path) != meta
    ]
    deleted = [path for path in before if path not in after]
    return sorted([*changed, *deleted])[:limit]


async def run_command(
    command: str,
    cwd: str | None = ".",
    timeout_s: int | None = None,
) -> TerminalResult:
    if not settings.terminal_enabled:
        raise TerminalError("terminal tools are disabled")

    checked = _check_command(command)
    resolved = resolve_cwd(cwd)
    timeout = max(1, min(int(timeout_s or settings.terminal_timeout_s), 120))
    output_limit = settings.terminal_max_output_chars

    env = os.environ.copy()
    env.setdefault("TERM", "xterm-256color")

    before = _workspace_snapshot()
    start = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        settings.terminal_shell,
        "-lc",
        checked,
        cwd=str(resolved),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    timed_out = False
    try:
        stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        timed_out = True
        proc.kill()
        stdout_b, stderr_b = await proc.communicate()

    duration = time.monotonic() - start
    after = _workspace_snapshot()
    changed_files = _changed_files(before, after)
    stdout, stdout_truncated = _truncate(
        stdout_b.decode(errors="replace"),
        output_limit,
    )
    stderr_raw = stderr_b.decode(errors="replace")
    hint = _command_failure_hint(checked, stderr_raw, changed_files)
    if hint:
        stderr_raw = f"{stderr_raw.rstrip()}\n\n{hint}\n"
    stderr, stderr_truncated = _truncate(
        stderr_raw,
        output_limit,
    )

    return TerminalResult(
        command=checked,
        cwd=str(resolved.relative_to(workspace_root()) or "."),
        exit_code=proc.returncode,
        stdout=stdout,
        stderr=stderr,
        duration_s=round(duration, 3),
        changed_files=changed_files,
        timed_out=timed_out,
        stdout_truncated=stdout_truncated,
        stderr_truncated=stderr_truncated,
    )


def result_json(result: TerminalResult) -> str:
    return json.dumps(asdict(result), ensure_ascii=False)


def error_json(message: str, command: str | None = None) -> str:
    return json.dumps(
        {
            "error": message,
            "command": command or "",
            "cwd": ".",
            "exit_code": None,
            "stdout": "",
            "stderr": message,
            "changed_files": [],
            "timed_out": False,
        },
        ensure_ascii=False,
    )
