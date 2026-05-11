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
                "description": "Shell command to run, for example `pwd` or `npm test`.",
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


def workspace_root() -> Path:
    return Path(settings.workspace_root).expanduser().resolve()


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


def _truncate(text: str, limit: int) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    keep = max(0, limit - 120)
    return (
        text[:keep]
        + f"\n\n[output truncated after {limit} characters by terminal tool]",
        True,
    )


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
    stdout, stdout_truncated = _truncate(
        stdout_b.decode(errors="replace"),
        output_limit,
    )
    stderr, stderr_truncated = _truncate(
        stderr_b.decode(errors="replace"),
        output_limit,
    )

    return TerminalResult(
        command=checked,
        cwd=str(resolved.relative_to(workspace_root()) or "."),
        exit_code=proc.returncode,
        stdout=stdout,
        stderr=stderr,
        duration_s=round(duration, 3),
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
            "timed_out": False,
        },
        ensure_ascii=False,
    )
