"""Small local preview process manager for agent-created apps."""
from __future__ import annotations

import asyncio
import json
import socket
import subprocess
from pathlib import Path

from . import terminal

_preview_proc: asyncio.subprocess.Process | None = None
_preview_info: dict | None = None


class PreviewError(Exception):
    pass


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _package_scripts(path: Path) -> dict:
    package = path / "package.json"
    if not package.exists():
        return {}
    try:
        data = json.loads(package.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    scripts = data.get("scripts")
    return scripts if isinstance(scripts, dict) else {}


async def _stop_existing() -> None:
    global _preview_proc, _preview_info
    if _preview_proc and _preview_proc.returncode is None:
        _preview_proc.terminate()
        try:
            await asyncio.wait_for(_preview_proc.wait(), 3)
        except asyncio.TimeoutError:
            _preview_proc.kill()
            await _preview_proc.wait()
    _preview_proc = None
    _preview_info = None


START_PROJECT_PREVIEW_TOOL = {
    "type": "function",
    "name": "start_project_preview",
    "description": (
        "Start or reuse Privai's managed local preview server for a web app "
        "inside the selected coding workspace. Use this after a web app build "
        "passes instead of running a long-lived raw `npm run dev` command. "
        "Pass the project folder that contains package.json or index.html."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "cwd": {
                "type": "string",
                "description": (
                    "Project directory relative to the workspace root. Use `.` "
                    "when package.json or index.html is at the workspace root."
                ),
            },
        },
        "required": ["cwd"],
        "additionalProperties": False,
    },
    "strict": True,
}

PREVIEW_TOOLS = [START_PROJECT_PREVIEW_TOOL]


async def _wait_for_url(url: str, timeout_s: float = 20) -> bool:
    import httpx

    deadline = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < deadline:
        try:
            async with httpx.AsyncClient(timeout=1) as client:
                response = await client.get(url)
            if response.status_code < 500:
                return True
        except Exception:
            await asyncio.sleep(0.25)
    return False


def _resolve_project(cwd: str | None) -> Path:
    path = terminal.resolve_cwd(cwd or ".")
    if (path / "package.json").exists() or (path / "index.html").exists():
        return path
    for parent in [path, *path.parents]:
        try:
            parent.relative_to(terminal.workspace_root())
        except ValueError:
            break
        if (parent / "package.json").exists() or (parent / "index.html").exists():
            return parent
    raise PreviewError("no package.json or index.html found for preview")


async def start_preview(cwd: str | None = ".") -> dict:
    global _preview_proc, _preview_info
    project = _resolve_project(cwd)
    if _preview_info and _preview_proc and _preview_proc.returncode is None:
        if Path(_preview_info["path"]) == project:
            if not _preview_info.get("ready") and _preview_info.get("url"):
                _preview_info["ready"] = await _wait_for_url(
                    str(_preview_info["url"]),
                    timeout_s=5,
                )
            return _preview_info
        await _stop_existing()

    port = _free_port()
    scripts = _package_scripts(project)
    if "dev" in scripts:
        command = ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", str(port)]
    elif "preview" in scripts:
        command = ["npm", "run", "preview", "--", "--host", "127.0.0.1", "--port", str(port)]
    elif (project / "index.html").exists():
        command = ["python3", "-m", "http.server", str(port), "--bind", "127.0.0.1"]
    else:
        raise PreviewError("no dev/preview script or index.html found")

    _preview_proc = await asyncio.create_subprocess_exec(
        *command,
        cwd=str(project),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    ready = await _wait_for_url(url)
    _preview_info = {
        "cwd": str(project.relative_to(terminal.workspace_root()) or "."),
        "path": str(project),
        "url": url,
        "command": " ".join(command),
        "ready": ready,
    }
    return _preview_info


async def execute_tool(name: str, args: dict) -> str:
    if name != "start_project_preview":
        return json.dumps({"error": f"unknown preview tool: {name}"}, ensure_ascii=False)
    cwd = str(args.get("cwd") or ".")
    try:
        info = await start_preview(cwd)
    except Exception as e:
        return json.dumps(
            {
                "error": str(e),
                "cwd": cwd,
                "ready": False,
            },
            ensure_ascii=False,
        )
    if not info.get("ready"):
        return json.dumps(
            {
                **info,
                "error": (
                    "preview server started but did not become ready before "
                    "the readiness timeout"
                ),
            },
            ensure_ascii=False,
        )
    return json.dumps(info, ensure_ascii=False)


async def stop_preview() -> dict:
    await _stop_existing()
    return {"ok": True}


def preview_status() -> dict:
    if not _preview_info or not _preview_proc or _preview_proc.returncode is not None:
        return {"running": False}
    return {"running": True, **_preview_info}
