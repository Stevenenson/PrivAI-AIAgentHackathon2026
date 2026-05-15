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


def _tool_display(name: str, args: dict[str, Any]) -> str:
    if name == "run_terminal_command":
        return str(args.get("command") or "")
    clean_args = {
        key: value
        for key, value in args.items()
        if value not in (None, "", [], {})
    }
    return f"{name}({json.dumps(clean_args, ensure_ascii=False)})"


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
    failed = bool(result.get("error")) or result.get("timed_out") or (
        is_terminal and exit_code not in (0, None)
    )
    return {
        "id": call.get("call_id") or f"tool-{step}",
        "name": tool_name,
        "status": "failed" if failed else "completed",
        "step": step,
        "maxSteps": max_steps,
        "command": result.get("command") or _tool_display(tool_name, args),
        "cwd": result.get("cwd") or str(args.get("cwd") or "."),
        "exitCode": exit_code,
        "stdout": result.get("stdout") or (
            "" if is_terminal else json.dumps(result, ensure_ascii=False, indent=2)
        ),
        "stderr": result.get("stderr") or str(result.get("error") or ""),
        "durationS": result.get("duration_s") or 0,
        "timedOut": bool(result.get("timed_out")),
        "changedFiles": result.get("changed_files") or [],
    }


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


def _verification_prompt_if_needed(
    tool_history: list[dict[str, Any]],
    nudges_sent: int,
) -> str | None:
    changed = _changed_project_files(tool_history)
    if not changed or nudges_sent >= 2:
        return None
    has_build = _has_successful_build_check(tool_history)
    is_web_project = _looks_like_web_project(tool_history, changed)
    has_dev = _has_dev_smoke_signal(tool_history) if is_web_project else True
    if has_build and (has_dev or not is_web_project):
        return None

    missing = []
    if not has_build:
        if is_web_project:
            missing.append("a successful web verification command, preferably `npm run build`")
        else:
            missing.append("a successful relevant check command such as tests, lint, typecheck, or compile")
    if is_web_project and not has_dev:
        missing.append("a bounded dev-server smoke check when the project has a dev script")
    missing_text = " and ".join(missing)
    sample_changed = ", ".join(changed[:8])
    return (
        "You changed project files but have not completed required verification yet. "
        f"Changed files include: {sample_changed}. Before giving a final answer, run "
        f"{missing_text}. Read stdout/stderr and exit codes. If anything fails, inspect "
        "the relevant files, fix the issue, and rerun the failing check. For Vite/React, "
        "make sure local imports like `./App.css` and local image assets exist. For a "
        "dev-server smoke check, run it with a short timeout; a timeout is acceptable "
        "only if the output clearly shows the server became ready."
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
            )
            text = _gemini_text_from_response(data)
            if text:
                final_text = text

            calls = _gemini_function_calls(data)
            if not calls:
                verification_prompt = _verification_prompt_if_needed(
                    tool_history,
                    verification_nudges,
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
                max_output_tokens=2048,
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
