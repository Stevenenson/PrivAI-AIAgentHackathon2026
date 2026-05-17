"""Async LLM client for the Gemini API provider."""
from __future__ import annotations

import json
import asyncio
import logging
import random
from collections.abc import Awaitable, Callable
from copy import deepcopy
from typing import Any

import httpx

from . import runtime
from .config import settings

ToolExecutor = Callable[[str, dict[str, Any]], Awaitable[str]]
ToolEventHandler = Callable[[dict[str, Any]], Awaitable[None]]
ToolApprovalHandler = Callable[[dict[str, Any]], Awaitable[bool]]

log = logging.getLogger(__name__)
_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}


class GeminiAPIError(RuntimeError):
    def __init__(
        self,
        status_code: int,
        detail: str,
        retry_after_s: float | None = None,
    ):
        self.status_code = status_code
        self.detail = detail
        self.retry_after_s = retry_after_s
        super().__init__(f"Gemini API error {status_code}: {detail}")


def _image_part(image: Any) -> dict[str, Any]:
    if isinstance(image, dict):
        mime = image.get("mime") or "image/jpeg"
        data = image.get("data") or image.get("base64") or ""
    else:
        mime = "image/jpeg"
        data = str(image)
    return {"inlineData": {"mimeType": mime, "data": data}}


def _gemini_contents(messages: list[dict]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    system_parts: list[dict[str, str]] = []
    contents: list[dict[str, Any]] = []

    for message in messages:
        role = str(message.get("role") or "user")
        content = str(message.get("content") or "")

        if role in {"system", "developer"}:
            if content:
                system_parts.append({"text": content})
            continue

        gemini_role = "model" if role in {"assistant", "model"} else "user"
        parts: list[dict[str, Any]] = []
        if content:
            parts.append({"text": content})

        images = message.get("images") or []
        if images and gemini_role == "user":
            parts.extend(_image_part(image) for image in images)

        if parts:
            contents.append({"role": gemini_role, "parts": parts})

    system_instruction = {"parts": system_parts} if system_parts else None
    if not contents:
        contents.append({"role": "user", "parts": [{"text": ""}]})
    return system_instruction, contents


def _gemini_text_from_response(data: dict[str, Any]) -> str:
    parts: list[str] = []
    for candidate in data.get("candidates") or []:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            text = part.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts).strip()


def _first_candidate_content(data: dict[str, Any]) -> dict[str, Any] | None:
    candidates = data.get("candidates") or []
    if not candidates:
        return None
    content = candidates[0].get("content")
    return content if isinstance(content, dict) else None


def _gemini_function_calls(data: dict[str, Any]) -> list[dict[str, Any]]:
    content = _first_candidate_content(data) or {}
    calls: list[dict[str, Any]] = []
    for part in content.get("parts") or []:
        call = part.get("functionCall")
        if not isinstance(call, dict):
            continue
        args = call.get("args")
        calls.append({
            "call_id": call.get("id") or call.get("callId") or "",
            "name": call.get("name") or "",
            "arguments": args if isinstance(args, dict) else {},
        })
    return calls


def _function_response_part(
    call: dict[str, Any],
    result_json: str,
) -> dict[str, Any]:
    try:
        response: Any = json.loads(result_json)
    except json.JSONDecodeError:
        response = {"result": result_json}

    payload: dict[str, Any] = {
        "name": call.get("name") or "",
        "response": response if isinstance(response, dict) else {"result": response},
    }
    if call.get("call_id"):
        payload["id"] = call["call_id"]
    return {"functionResponse": payload}


def _sanitize_schema(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, child in value.items():
            if key in {"additionalProperties", "strict"}:
                continue
            sanitized[key] = _sanitize_schema(child)
        return sanitized
    if isinstance(value, list):
        return [_sanitize_schema(item) for item in value]
    return value


def _gemini_tools(tools: list[dict]) -> list[dict[str, Any]]:
    declarations: list[dict[str, Any]] = []
    for tool in tools:
        if tool.get("type") != "function":
            continue
        declaration = {
            "name": tool.get("name") or "",
            "description": tool.get("description") or "",
            "parameters": _sanitize_schema(deepcopy(tool.get("parameters") or {})),
        }
        if declaration["name"]:
            declarations.append(declaration)
    return [{"functionDeclarations": declarations}] if declarations else []


_FILE_TOOL_NAMES = {
    "read_file",
    "write_file",
    "apply_patch",
    "list_dir",
    "grep_workspace",
}


def _tool_display(name: str, args: dict[str, Any]) -> str:
    if name == "run_terminal_command":
        return str(args.get("command") or "")
    if name == "start_project_preview":
        cwd = str(args.get("cwd") or ".")
        return f"start_project_preview(cwd={cwd})"
    if name in {"read_file", "write_file", "apply_patch"}:
        return f"{name}({args.get('path') or ''})"
    if name == "list_dir":
        return f"list_dir({args.get('path') or '.'})"
    if name == "grep_workspace":
        pattern = str(args.get("pattern") or "")
        glob = str(args.get("glob") or "")
        suffix = f" in {glob}" if glob else ""
        return f"grep_workspace({pattern}{suffix})"
    if name == "update_plan":
        steps = args.get("steps") or []
        return f"update_plan({len(steps)} steps)"
    if name == "request_user_input":
        question = str(args.get("question") or "")
        return f"ask: {question[:120]}"
    clean_args = {
        key: value
        for key, value in args.items()
        if value not in (None, "", [], {})
    }
    return f"{name}({json.dumps(clean_args, ensure_ascii=False)})"


def _file_tool_summary(name: str, result: dict[str, Any]) -> str:
    if name == "read_file":
        lines = result.get("lines")
        path = result.get("path") or ""
        suffix = f" ({lines} lines)" if lines is not None else ""
        return f"Read {path}{suffix}"
    if name == "write_file":
        path = result.get("path") or ""
        verb = "Created" if result.get("created") else "Wrote"
        return f"{verb} {path}"
    if name == "apply_patch":
        path = result.get("path") or ""
        return f"Patched {path}"
    if name == "list_dir":
        entries = result.get("entries") or []
        return f"Listed {result.get('path') or '.'} ({len(entries)} entries)"
    if name == "grep_workspace":
        matches = result.get("matches") or []
        return f"Found {len(matches)} matches for `{result.get('pattern') or ''}`"
    return ""


def _tool_finish_event(
    call: dict[str, Any],
    args: dict[str, Any],
    result_json: str,
    step: int,
    max_steps: int,
) -> dict[str, Any]:
    try:
        result = json.loads(result_json)
    except json.JSONDecodeError:
        result = {"stderr": result_json, "exit_code": None}
    exit_code = result.get("exit_code")
    tool_name = str(call.get("name") or "")
    is_terminal = tool_name == "run_terminal_command"
    is_preview = tool_name == "start_project_preview"
    is_file = tool_name in _FILE_TOOL_NAMES
    is_plan = tool_name == "update_plan"

    if is_file or is_plan:
        ok = bool(result.get("ok"))
        exit_code = 0 if ok else 1
        failed = not ok
    else:
        failed = bool(result.get("error")) or result.get("timed_out") or (
            is_terminal and exit_code not in (0, None)
        )
        if is_preview and not result.get("ready"):
            failed = True

    stdout = result.get("stdout")
    if not stdout and is_preview:
        stdout = json.dumps(
            {
                key: result.get(key)
                for key in ("url", "cwd", "path", "command", "ready")
                if result.get(key) is not None
            },
            ensure_ascii=False,
            indent=2,
        )
    if not stdout and is_file:
        summary = _file_tool_summary(tool_name, result)
        stdout = summary or json.dumps(result, ensure_ascii=False)[:1200]
    if not stdout and is_plan:
        stdout = json.dumps(
            {"steps": result.get("steps") or [], "note": result.get("note") or ""},
            ensure_ascii=False,
            indent=2,
        )

    event: dict[str, Any] = {
        "id": call.get("call_id") or f"tool-{step}",
        "name": tool_name,
        "status": "failed" if failed else "completed",
        "step": step,
        "maxSteps": max_steps,
        "command": result.get("command") or _tool_display(tool_name, args),
        "cwd": result.get("cwd") or str(args.get("cwd") or "."),
        "exitCode": exit_code,
        "stdout": stdout or (
            "" if is_terminal else json.dumps(result, ensure_ascii=False, indent=2)
        ),
        "stderr": result.get("stderr") or str(result.get("error") or ""),
        "durationS": result.get("duration_s") or 0,
        "timedOut": bool(result.get("timed_out")),
        "changedFiles": result.get("changed_files") or [],
    }
    if is_plan:
        event["plan"] = {
            "steps": result.get("steps") or [],
            "note": result.get("note") or "",
        }
    return event


def _empty_terminal_command_result(args: dict[str, Any]) -> str:
    return json.dumps(
        {
            "error": "empty command ignored",
            "command": "",
            "cwd": str(args.get("cwd") or "."),
            "exit_code": None,
            "stdout": "",
            "stderr": (
                "The terminal command was empty. Call the tool again with a "
                "specific non-empty command."
            ),
            "changed_files": [],
            "timed_out": False,
        },
        ensure_ascii=False,
    )


def _summarize_tool_result(
    event: dict[str, Any],
    result_json: str,
) -> dict[str, Any]:
    try:
        result = json.loads(result_json)
    except json.JSONDecodeError:
        result = {"stderr": result_json, "exit_code": None}
    name = str(event.get("name") or "")
    if name == "start_project_preview":
        return {
            "name": name,
            "command": event.get("command") or "start_project_preview",
            "cwd": result.get("cwd") or event.get("cwd") or ".",
            "exitCode": 0 if result.get("ready") and not result.get("error") else 1,
            "stdout": json.dumps(result, ensure_ascii=False)[:1200],
            "stderr": str(result.get("error") or "")[:1200],
            "changedFiles": [],
            "timedOut": False,
        }
    if name in _FILE_TOOL_NAMES or name == "update_plan":
        ok = bool(result.get("ok"))
        summary = _file_tool_summary(name, result) if name in _FILE_TOOL_NAMES else ""
        if not summary:
            summary = json.dumps(result, ensure_ascii=False)[:1200]
        return {
            "name": name,
            "command": event.get("command") or _tool_display(name, {}),
            "cwd": event.get("cwd") or ".",
            "exitCode": 0 if ok else 1,
            "stdout": summary,
            "stderr": str(result.get("error") or "")[:1200],
            "changedFiles": result.get("changed_files") or [],
            "timedOut": False,
        }
    return {
        "name": event.get("name") or "",
        "command": result.get("command") or event.get("command") or "",
        "cwd": result.get("cwd") or event.get("cwd") or ".",
        "exitCode": result.get("exit_code"),
        "stdout": str(result.get("stdout") or "")[:1200],
        "stderr": str(result.get("stderr") or result.get("error") or "")[:1200],
        "changedFiles": result.get("changed_files") or [],
        "timedOut": bool(result.get("timed_out")),
    }


def _local_tool_summary(tool_history: list[dict[str, Any]], max_iterations: int) -> str:
    if not tool_history:
        return (
            "I could not get a final response from the model. Nothing was run. "
            "Please try again."
        )

    lines = [
        "I ran the workspace actions, but the model did not return a final written summary.",
        "",
        "What happened:",
    ]
    start = max(1, len(tool_history) - 7)
    for idx, item in enumerate(tool_history[-8:], start=start):
        command = str(item.get("command") or item.get("name") or "tool").strip()
        exit_code = item.get("exitCode")
        stderr = str(item.get("stderr") or "").strip()
        status = "ok" if exit_code in (0, None) and not stderr else "needs review"
        lines.append(f"- Step {idx}: `{command}` finished with {status}.")
        changed = item.get("changedFiles") or []
        if changed:
            changed_text = ", ".join(str(path) for path in changed[:6])
            lines.append(f"  Changed: {changed_text}")
        if stderr:
            lines.append(f"  Error/output: {stderr[:240]}")
    if len(tool_history) >= max_iterations:
        lines.append("")
        lines.append(
            f"I also reached the configured limit of {max_iterations} tool steps, "
            "so ask me to continue if the app is not finished."
        )
    return "\n".join(lines)


_CODE_FILE_SUFFIXES = (
    ".css",
    ".html",
    ".js",
    ".jsx",
    ".json",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".vue",
    ".svelte",
    ".py",
)

_BUILD_COMMAND_MARKERS = (
    "npm run build",
    "npm run lint",
    "npm test",
    "npm run test",
    "npm run typecheck",
    "npx tsc",
    "pnpm build",
    "pnpm lint",
    "pnpm test",
    "yarn build",
    "yarn lint",
    "yarn test",
    "vite build",
    "python -m compileall",
    "python3 -m compileall",
    "python -m pytest",
    "python3 -m pytest",
    "pytest",
    "ruff check",
    "cargo test",
    "cargo check",
    "go test",
)

_DEV_COMMAND_MARKERS = (
    "npm run dev",
    "npm start",
    "pnpm dev",
    "yarn dev",
    "vite --host",
    "start_project_preview",
)

_WEB_PROJECT_HINTS = (
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "vite.config",
    "next.config",
    "src/app.",
    "src/main.",
    "src/App.",
    ".jsx",
    ".tsx",
    ".vue",
    ".svelte",
)


def _changed_project_files(tool_history: list[dict[str, Any]]) -> list[str]:
    changed: list[str] = []
    for item in tool_history:
        for path in item.get("changedFiles") or []:
            text = str(path)
            name = text.rsplit("/", 1)[-1]
            if (
                name in {"package.json", "package-lock.json", "vite.config.js", "vite.config.ts"}
                or text.startswith("src/")
                or "/src/" in text
                or text.endswith(_CODE_FILE_SUFFIXES)
            ):
                changed.append(text)
    return sorted(set(changed))


def _tool_succeeded(item: dict[str, Any]) -> bool:
    return item.get("exitCode") == 0 and not item.get("timedOut")


def _has_successful_build_check(tool_history: list[dict[str, Any]]) -> bool:
    for item in tool_history:
        command = str(item.get("command") or "").lower()
        if _tool_succeeded(item) and any(marker in command for marker in _BUILD_COMMAND_MARKERS):
            return True
    return False


def _has_dev_smoke_signal(tool_history: list[dict[str, Any]]) -> bool:
    for item in tool_history:
        command = str(item.get("command") or "").lower()
        if not any(marker in command for marker in _DEV_COMMAND_MARKERS):
            continue
        output = f"{item.get('stdout') or ''}\n{item.get('stderr') or ''}".lower()
        if item.get("exitCode") == 0 or (
            item.get("timedOut")
            and any(token in output for token in ("local:", "http://", "ready in", "compiled"))
        ):
            return True
    return False


def _looks_like_web_project(
    tool_history: list[dict[str, Any]],
    changed: list[str],
) -> bool:
    for path in changed:
        normalized = path.replace("\\", "/")
        if any(hint in normalized for hint in _WEB_PROJECT_HINTS):
            return True
    for item in tool_history:
        command = str(item.get("command") or "").lower()
        if any(token in command for token in ("npm ", "pnpm ", "yarn ", "vite", "next")):
            return True
    return False


def _recent_failed_commands(tool_history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    failures: list[dict[str, Any]] = []
    for item in tool_history[-12:]:
        command = str(item.get("command") or "")
        exit_code = item.get("exitCode")
        stderr = str(item.get("stderr") or "").strip()
        if not command:
            continue
        if exit_code not in (0, None) or (item.get("timedOut") and stderr):
            failures.append(item)
        elif stderr and any(
            marker in stderr.lower()
            for marker in ("error", "failed", "cannot find", "not found")
        ):
            failures.append(item)
    return failures


_PREMATURE_STOP_PATTERNS = (
    "reply continue",
    "say continue",
    "say 'continue'",
    "say \"continue\"",
    "respond with continue",
    "please reply with",
    "please reply",
    "reply with \"",
    "reply with '",
    "would you like me to",
    "shall i continue",
    "should i continue",
    "do you want me to continue",
    "let me know if",
    "if you'd like me to",
    "if you would like me to",
    "process was paused",
    "system paused",
    "paused my execution",
    "i was paused",
    "execution was paused",
    "tool execution limit",
    "tool limit",
    "i hit the tool limit",
    "out of steps",
    "ran out of steps",
    "rate limit",
    "before i could",
    "before i was able",
    "next steps:",
    "next step:",
    "next step for you",
    "next steps for you",
    "haven't run",
    "have not run",
    "i haven't",
    "i have not",
    "i was unable to",
    "unable to run",
    "unable to write",
    "could not write",
    "could not run",
    "what failed",
    "i'll immediately",
    "i will immediately",
    "spin up your local",
    "boot up your local",
    "not verified",
    "incomplete",
    "tool sequence ended",
    "tool sequence",
    "to finish the app",
    "to finish, you",
    "to finish you",
    "you will need to",
    "you'll need to",
    "final verification",
    "css styling",
    "status:",
    "remaining work",
    "remaining task",
    "manually run",
    "you can run",
    "please run",
    "please add",
    "please paste",
    "please write",
    "to complete this",
    "to complete the",
)


def _plan_has_unfinished_steps(tool_history: list[dict[str, Any]]) -> bool:
    last_plan: dict[str, Any] | None = None
    for item in tool_history:
        if str(item.get("name") or "") != "update_plan":
            continue
        try:
            parsed = json.loads(item.get("stdout") or "{}")
        except json.JSONDecodeError:
            continue
        steps = parsed.get("steps")
        if isinstance(steps, list) and steps:
            last_plan = parsed
    if not last_plan:
        return False
    steps = last_plan.get("steps") or []
    return any(
        str(step.get("status") or "").lower() not in {"completed", "skipped"}
        for step in steps
    )


def _premature_stop_prompt(
    final_text: str,
    tool_history: list[dict[str, Any]],
    nudges_sent: int,
    max_nudges: int,
) -> str | None:
    """Catch the model trying to defer to the user instead of working."""
    if nudges_sent >= max_nudges:
        return None
    text = (final_text or "").lower()
    pattern_hit = any(pattern in text for pattern in _PREMATURE_STOP_PATTERNS) if text else False
    unfinished_plan = _plan_has_unfinished_steps(tool_history)

    # If the plan still has open steps OR the text shows a defer/pause
    # pattern, push back — regardless of build status. A vague "shall I
    # continue?" is never valid even if a build passed.
    if not pattern_hit and not unfinished_plan:
        return None

    return (
        "STOP deferring to the user. There is no pause, no rate limit, no "
        "tool budget you must negotiate. The phrases 'process was paused', "
        "'system paused', 'before I could', 'next steps for you', and "
        "'please reply with' are FORBIDDEN — never write them. "
        "Continue the task by calling tools. Write any remaining files with "
        "`write_file` or `apply_patch`. Run the build (`npm run build` for "
        "Vite/React) and fix any errors with `read_file` + `apply_patch`. "
        "For web apps, call `start_project_preview` after the build passes. "
        "Update the plan with `update_plan` as steps complete. Only emit a "
        "final answer once every plan step is `completed` or `skipped` and "
        "verification has actually run. Continue now."
    )


def _verification_prompt_if_needed(
    tool_history: list[dict[str, Any]],
    nudges_sent: int,
    max_nudges: int,
) -> str | None:
    if nudges_sent >= max_nudges:
        return None
    changed = _changed_project_files(tool_history)
    if not changed:
        return None
    has_build = _has_successful_build_check(tool_history)
    is_web_project = _looks_like_web_project(tool_history, changed)
    has_dev = _has_dev_smoke_signal(tool_history) if is_web_project else True
    failures = _recent_failed_commands(tool_history)

    if has_build and (has_dev or not is_web_project) and not failures:
        return None

    sample_changed = ", ".join(changed[:8])

    if failures:
        last = failures[-1]
        stderr = str(last.get("stderr") or "").strip()[:600]
        command = str(last.get("command") or "").strip()
        return (
            f"Verification is incomplete (nudge {nudges_sent + 1}/{max_nudges}). "
            f"The last failing step was `{command}` with error:\n{stderr}\n\n"
            "Do not stop. Read the relevant file with `read_file`, fix the "
            "issue with `apply_patch` or `write_file`, then rerun the failing "
            "check. Keep iterating until the build passes or you have a clear "
            "blocker to report."
        )

    missing: list[str] = []
    if not has_build:
        if is_web_project:
            missing.append("a successful web verification command, preferably `npm run build`")
        else:
            missing.append(
                "a successful relevant check command such as tests, lint, typecheck, or compile"
            )
    if is_web_project and not has_dev:
        missing.append(
            "a managed local preview using `start_project_preview` when the project has a dev script"
        )
    missing_text = " and ".join(missing)
    return (
        f"You changed project files but have not finished verification "
        f"(nudge {nudges_sent + 1}/{max_nudges}). Changed files include: "
        f"{sample_changed}. Run {missing_text} now. Read stdout/stderr and "
        "exit codes. If anything fails, inspect the relevant files with "
        "`read_file`, fix with `apply_patch` or `write_file`, then rerun. "
        "Prefer `start_project_preview` over a raw long-running `npm run dev`."
    )


class LLMClient:
    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        provider: str | None = None,
    ):
        self.provider = "gemini"
        self.base_url = (base_url or settings.gemini_base_url).rstrip("/")
        self._model_override = model

    @property
    def model(self) -> str:
        return self._model_override or runtime.get_model(self.provider)

    async def generate(self, prompt: str, system: str | None = None) -> str:
        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return await self.chat(messages)

    async def chat(
        self,
        messages: list[dict],
        model: str | None = None,
        response_mime_type: str | None = None,
        max_output_tokens: int | None = None,
    ) -> str:
        system_instruction, contents = _gemini_contents(messages)
        data = await self._gemini_generate(
            contents=contents,
            system_instruction=system_instruction,
            model=model or self.model,
            response_mime_type=response_mime_type,
            max_output_tokens=max_output_tokens,
        )
        return _gemini_text_from_response(data)

    async def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        execute_tool: ToolExecutor,
        model: str | None = None,
        max_iterations: int = 6,
        on_tool_event: ToolEventHandler | None = None,
        request_tool_approval: ToolApprovalHandler | None = None,
    ) -> str:
        """Run a Gemini function-calling loop and return the final text."""
        active_model = model or self.model
        system_instruction, contents = _gemini_contents(messages)
        gemini_tools = _gemini_tools(tools)
        final_text = ""
        tool_history: list[dict[str, Any]] = []
        verification_nudges = 0

        step = 0
        for _ in range(max_iterations):
            data = await self._gemini_generate(
                contents=contents,
                system_instruction=system_instruction,
                model=active_model,
                tools=gemini_tools,
                max_output_tokens=settings.agent_step_max_output_tokens,
            )
            text = _gemini_text_from_response(data)
            if text:
                final_text = text

            calls = _gemini_function_calls(data)
            if not calls:
                premature_prompt = _premature_stop_prompt(
                    text,
                    tool_history,
                    verification_nudges,
                    max(1, settings.agent_max_verification_nudges),
                )
                if premature_prompt:
                    contents.append({
                        "role": "user",
                        "parts": [{"text": premature_prompt}],
                    })
                    final_text = ""
                    verification_nudges += 1
                    continue
                verification_prompt = _verification_prompt_if_needed(
                    tool_history,
                    verification_nudges,
                    max(1, settings.agent_max_verification_nudges),
                )
                if verification_prompt:
                    contents.append({
                        "role": "user",
                        "parts": [{"text": verification_prompt}],
                    })
                    final_text = ""
                    verification_nudges += 1
                    continue
                if final_text:
                    return final_text
                return await self._finalize_after_tools(
                    contents,
                    system_instruction,
                    active_model,
                    tool_history,
                    max_iterations,
                )

            model_content = _first_candidate_content(data)
            if model_content:
                contents.append(model_content)

            response_parts: list[dict[str, Any]] = []
            for call in calls:
                args = self._decode_tool_args(call)
                tool_name = str(call.get("name") or "")
                command = str(args.get("command") or "").strip()
                step += 1
                event = {
                    "id": call.get("call_id") or f"tool-{step}",
                    "name": tool_name,
                    "step": step,
                    "maxSteps": max_iterations,
                    "command": command or _tool_display(tool_name, args),
                    "cwd": str(args.get("cwd") or "."),
                }

                if tool_name == "run_terminal_command" and not command:
                    result = _empty_terminal_command_result(args)
                    tool_history.append(_summarize_tool_result(event, result))
                    if on_tool_event:
                        await on_tool_event(
                            _tool_finish_event(call, args, result, step, max_iterations)
                        )
                    response_parts.append(_function_response_part(call, result))
                    continue

                if request_tool_approval:
                    approved = await request_tool_approval(event)
                    if not approved:
                        result = json.dumps(
                            {
                                "error": "command rejected by user",
                                "command": event["command"],
                                "cwd": event["cwd"],
                                "exit_code": None,
                                "stdout": "",
                                "stderr": "command rejected by user",
                                "changed_files": [],
                                "timed_out": False,
                            },
                            ensure_ascii=False,
                        )
                        tool_history.append(_summarize_tool_result(event, result))
                        if on_tool_event:
                            await on_tool_event({
                                **event,
                                "status": "rejected",
                                "exitCode": None,
                                "stdout": "",
                                "stderr": "command rejected by user",
                                "durationS": 0,
                                "timedOut": False,
                                "changedFiles": [],
                            })
                        response_parts.append(_function_response_part(call, result))
                        continue

                if on_tool_event:
                    await on_tool_event({**event, "status": "running"})
                result = await execute_tool(call["name"], args)
                tool_history.append(_summarize_tool_result(event, result))
                if on_tool_event:
                    await on_tool_event(
                        _tool_finish_event(
                            call,
                            args,
                            result,
                            step,
                            max_iterations,
                        )
                    )
                response_parts.append(_function_response_part(call, result))

            if response_parts:
                contents.append({"role": "user", "parts": response_parts})

        if final_text:
            return final_text
        return await self._finalize_after_tools(
            contents,
            system_instruction,
            active_model,
            tool_history,
            max_iterations,
        )

    async def _finalize_after_tools(
        self,
        contents: list[dict[str, Any]],
        system_instruction: dict[str, Any] | None,
        model: str,
        tool_history: list[dict[str, Any]],
        max_iterations: int,
    ) -> str:
        if not tool_history:
            return _local_tool_summary(tool_history, max_iterations)

        final_contents = [
            *contents,
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "The tool calls are complete. Reply to the user with "
                            "a concise final answer. Say what changed, whether "
                            "commands passed or failed, and the next step if the "
                            "task is incomplete. Do not call any more tools."
                        )
                    }
                ],
            },
        ]
        try:
            data = await self._gemini_generate(
                contents=final_contents,
                system_instruction=system_instruction,
                model=model,
                max_output_tokens=settings.agent_step_max_output_tokens,
            )
            text = _gemini_text_from_response(data).strip()
            if text:
                return text
        except Exception as e:
            log.warning("Gemini finalization after tools failed: %s", e)
        return _local_tool_summary(tool_history, max_iterations)

    async def chat_stream(self, messages: list[dict], model: str | None = None):
        """Yield assistant content chunks from Gemini streaming generation."""
        system_instruction, contents = _gemini_contents(messages)
        payload = self._gemini_payload(
            contents=contents,
            system_instruction=system_instruction,
            model=model or self.model,
            stream=True,
        )
        async with httpx.AsyncClient(timeout=settings.llm_timeout_s) as client:
            for attempt in range(self._max_attempts()):
                try:
                    async with client.stream(
                        "POST",
                        self._model_url(model or self.model, stream=True),
                        headers=self._gemini_headers(),
                        json=payload,
                    ) as response:
                        if response.status_code >= 400:
                            body = await response.aread()
                            err = self._gemini_error(
                                response,
                                body.decode(errors="replace"),
                            )
                            if self._should_retry(err, attempt):
                                await self._sleep_before_retry(err, attempt)
                                continue
                            raise err

                        async for line in response.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            raw = line.removeprefix("data:").strip()
                            if not raw or raw == "[DONE]":
                                continue
                            try:
                                obj = json.loads(raw)
                            except json.JSONDecodeError:
                                continue
                            text = _gemini_text_from_response(obj)
                            if text:
                                yield text
                        return
                except httpx.RequestError as e:
                    if self._should_retry(e, attempt):
                        await self._sleep_before_retry(e, attempt)
                        continue
                    raise RuntimeError(f"Gemini request failed: {e}") from e

    async def health(self) -> bool:
        return bool(settings.gemini_api_key)

    def _gemini_headers(self) -> dict[str, str]:
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        return {
            "Content-Type": "application/json",
            "x-goog-api-key": settings.gemini_api_key,
        }

    def _model_url(self, model: str, stream: bool = False) -> str:
        model_name = model.removeprefix("models/")
        method = "streamGenerateContent?alt=sse" if stream else "generateContent"
        return f"{self.base_url}/models/{model_name}:{method}"

    def _gemini_payload(
        self,
        contents: list[dict[str, Any]],
        system_instruction: dict[str, Any] | None,
        model: str,
        stream: bool = False,
        tools: list[dict[str, Any]] | None = None,
        response_mime_type: str | None = None,
        max_output_tokens: int | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": max_output_tokens or settings.llm_num_predict,
            },
        }
        if response_mime_type:
            payload["generationConfig"]["responseMimeType"] = response_mime_type
        thinking = settings.gemini_thinking_level.strip()
        if thinking:
            payload["generationConfig"]["thinkingConfig"] = {
                "thinkingLevel": thinking,
            }
        if system_instruction:
            payload["systemInstruction"] = system_instruction
        if tools:
            payload["tools"] = tools
        return payload

    async def _gemini_generate(
        self,
        contents: list[dict[str, Any]],
        system_instruction: dict[str, Any] | None,
        model: str,
        tools: list[dict[str, Any]] | None = None,
        response_mime_type: str | None = None,
        max_output_tokens: int | None = None,
    ) -> dict[str, Any]:
        payload = self._gemini_payload(
            contents=contents,
            system_instruction=system_instruction,
            model=model,
            tools=tools,
            response_mime_type=response_mime_type,
            max_output_tokens=max_output_tokens,
        )
        async with httpx.AsyncClient(timeout=settings.llm_timeout_s) as client:
            for attempt in range(self._max_attempts()):
                try:
                    response = await client.post(
                        self._model_url(model),
                        headers=self._gemini_headers(),
                        json=payload,
                    )
                except httpx.RequestError as e:
                    if self._should_retry(e, attempt):
                        await self._sleep_before_retry(e, attempt)
                        continue
                    raise RuntimeError(f"Gemini request failed: {e}") from e

                if response.status_code < 400:
                    return response.json()

                err = self._gemini_error(response)
                if self._should_retry(err, attempt):
                    await self._sleep_before_retry(err, attempt)
                    continue
                raise err

        raise RuntimeError("Gemini request failed after retries")

    def _max_attempts(self) -> int:
        return max(1, settings.gemini_max_retries + 1)

    def _should_retry(self, error: Exception, attempt: int) -> bool:
        if attempt >= self._max_attempts() - 1:
            return False
        if isinstance(error, GeminiAPIError):
            return error.status_code in _RETRYABLE_STATUS_CODES
        return isinstance(error, httpx.RequestError)

    async def _sleep_before_retry(self, error: Exception, attempt: int) -> None:
        retry_after = (
            error.retry_after_s
            if isinstance(error, GeminiAPIError)
            else None
        )
        if retry_after is None:
            base = max(0.1, settings.gemini_retry_base_s)
            retry_after = min(8.0, base * (2 ** attempt)) + random.uniform(0.0, 0.35)
        delay = min(max(retry_after, 0.1), 12.0)
        log.info(
            "Gemini request failed with retryable error; retrying in %.2fs: %s",
            delay,
            error,
        )
        await asyncio.sleep(delay)

    @staticmethod
    def _gemini_error(
        response: httpx.Response,
        body_text: str | None = None,
    ) -> GeminiAPIError:
        detail = body_text if body_text is not None else response.text
        try:
            body = json.loads(detail)
            detail = (body.get("error") or {}).get("message") or detail
        except Exception:
            pass
        retry_after = response.headers.get("retry-after")
        retry_after_s: float | None = None
        if retry_after:
            try:
                retry_after_s = float(retry_after)
            except ValueError:
                retry_after_s = None
        return GeminiAPIError(response.status_code, detail, retry_after_s)

    @staticmethod
    def _decode_tool_args(call: dict[str, Any]) -> dict[str, Any]:
        args = call.get("arguments") or {}
        return args if isinstance(args, dict) else {}
