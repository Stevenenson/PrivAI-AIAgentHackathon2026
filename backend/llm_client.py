"""Async LLM client with OpenAI as the default provider and Ollama as fallback."""
from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from . import runtime
from .config import settings

ToolExecutor = Callable[[str, dict[str, Any]], Awaitable[str]]


def _llm_options() -> dict:
    return {
        "num_ctx": settings.llm_num_ctx,
        "num_predict": settings.llm_num_predict,
    }


def _with_thinking(payload: dict) -> dict:
    # Qwen reasoning models can stream only `message.thinking` for a long time.
    # The UI displays final answers, not private chain-of-thought, so keep
    # Ollama thinking disabled unless explicitly enabled by env.
    payload["think"] = settings.llm_think
    return payload


def _supports_reasoning(model: str) -> bool:
    model = model.lower()
    return model.startswith(("gpt-5", "o1", "o3", "o4"))


def _openai_text_from_response(data: dict[str, Any]) -> str:
    if isinstance(data.get("output_text"), str):
        return data["output_text"].strip()

    parts: list[str] = []
    for item in data.get("output") or []:
        for content in item.get("content") or []:
            if content.get("type") == "output_text":
                parts.append(content.get("text") or "")
            elif content.get("type") == "text":
                parts.append(content.get("text") or "")
    return "".join(parts).strip()


def _image_data_url(image: Any) -> str:
    if isinstance(image, dict):
        mime = image.get("mime") or "image/jpeg"
        data = image.get("data") or image.get("base64") or ""
    else:
        mime = "image/jpeg"
        data = str(image)
    return f"data:{mime};base64,{data}"


def _openai_input(messages: list[dict]) -> tuple[str | None, list[dict]]:
    instructions: list[str] = []
    items: list[dict] = []

    for message in messages:
        role = str(message.get("role") or "user")
        content = str(message.get("content") or "")

        if role == "system":
            if content:
                instructions.append(content)
            continue

        if role not in {"user", "assistant", "developer"}:
            role = "user"

        images = message.get("images") or []
        if images and role == "user":
            blocks: list[dict] = [{"type": "input_text", "text": content}]
            blocks.extend(
                {"type": "input_image", "image_url": _image_data_url(image)}
                for image in images
            )
            items.append({"role": role, "content": blocks})
        else:
            items.append({"role": role, "content": content})

    return ("\n\n".join(instructions) if instructions else None), items


def _openai_function_calls(data: dict[str, Any]) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    for item in data.get("output") or []:
        if item.get("type") != "function_call":
            continue
        calls.append({
            "call_id": item.get("call_id") or item.get("id") or "",
            "name": item.get("name") or "",
            "arguments": item.get("arguments") or "{}",
        })
    return calls


def _openai_replay_function_calls(calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function_call",
            "call_id": call["call_id"],
            "name": call["name"],
            "arguments": call["arguments"],
        }
        for call in calls
        if call.get("call_id") and call.get("name")
    ]


class LLMClient:
    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        provider: str | None = None,
    ):
        self.provider = (provider or settings.llm_provider).strip().lower()
        default_base = (
            settings.ollama_url if self.provider == "ollama" else settings.openai_base_url
        )
        self.base_url = (base_url or default_base).rstrip("/")
        self._model_override = model

    @property
    def model(self) -> str:
        return self._model_override or runtime.get_model()

    async def generate(self, prompt: str, system: str | None = None) -> str:
        if self.provider == "ollama":
            return await self._ollama_generate(prompt, system)

        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return await self._openai_chat(messages)

    async def chat(self, messages: list[dict], model: str | None = None) -> str:
        if self.provider == "ollama":
            return await self._ollama_chat(messages, model)
        return await self._openai_chat(messages, model)

    async def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        execute_tool: ToolExecutor,
        model: str | None = None,
        max_iterations: int = 6,
    ) -> str:
        """Run a Responses API tool loop and return the final text."""
        if self.provider == "ollama":
            return await self._ollama_chat(messages, model)

        active_model = model or self.model
        instructions, input_items = _openai_input(messages)
        final_text = ""

        for _ in range(max_iterations):
            data = await self._openai_create_response(
                input_items=input_items,
                instructions=instructions,
                model=active_model,
                tools=tools,
            )
            text = _openai_text_from_response(data)
            if text:
                final_text = text

            calls = _openai_function_calls(data)
            if not calls:
                return final_text

            # Responses function calling is multi-step. Because we keep
            # `store: false`, replay only sanitized function-call items rather
            # than persisted response item IDs.
            input_items.extend(_openai_replay_function_calls(calls))
            for call in calls:
                args = self._decode_tool_args(call)
                result = await execute_tool(call["name"], args)
                input_items.append({
                    "type": "function_call_output",
                    "call_id": call["call_id"],
                    "output": result,
                })

        return final_text or (
            "I stopped after reaching the configured maximum of "
            f"{max_iterations} terminal tool steps. Ask me to continue, or "
            "increase AGENT_MAX_TOOL_STEPS for longer tasks."
        )

    async def chat_stream(self, messages: list[dict], model: str | None = None):
        """Yield assistant content chunks (strings) from the active provider."""
        if self.provider == "ollama":
            async for chunk in self._ollama_chat_stream(messages, model):
                yield chunk
            return

        async for chunk in self._openai_chat_stream(messages, model):
            yield chunk

    async def health(self) -> bool:
        if self.provider == "ollama":
            try:
                async with httpx.AsyncClient(timeout=3) as client:
                    r = await client.get(f"{self.base_url}/api/tags")
                    return r.status_code == 200
            except Exception:
                return False
        return bool(settings.openai_api_key)

    async def _ollama_generate(self, prompt: str, system: str | None = None) -> str:
        payload = _with_thinking({
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": _llm_options(),
            "keep_alive": settings.llm_keep_alive,
        })
        if system:
            payload["system"] = system
        async with httpx.AsyncClient(timeout=settings.llm_timeout_s) as client:
            r = await client.post(f"{self.base_url}/api/generate", json=payload)
            r.raise_for_status()
            return r.json().get("response", "").strip()

    async def _ollama_chat(self, messages: list[dict], model: str | None = None) -> str:
        payload = _with_thinking({
            "model": model or self.model,
            "messages": messages,
            "stream": False,
            "options": _llm_options(),
            "keep_alive": settings.llm_keep_alive,
        })
        async with httpx.AsyncClient(timeout=settings.llm_timeout_s) as client:
            r = await client.post(f"{self.base_url}/api/chat", json=payload)
            r.raise_for_status()
            return r.json().get("message", {}).get("content", "").strip()

    async def _ollama_chat_stream(self, messages: list[dict], model: str | None = None):
        payload = _with_thinking({
            "model": model or self.model,
            "messages": messages,
            "stream": True,
            "options": _llm_options(),
            "keep_alive": settings.llm_keep_alive,
        })
        async with httpx.AsyncClient(timeout=settings.llm_timeout_s) as client:
            async with client.stream(
                "POST", f"{self.base_url}/api/chat", json=payload
            ) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    chunk = obj.get("message", {}).get("content", "")
                    if chunk:
                        yield chunk
                    if obj.get("done"):
                        break

    def _openai_headers(self) -> dict[str, str]:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        return {
            "Authorization": f"Bearer {settings.openai_api_key}",
            "Content-Type": "application/json",
        }

    def _openai_payload(
        self,
        messages: list[dict],
        model: str | None = None,
        stream: bool = False,
        tools: list[dict] | None = None,
    ) -> dict:
        active_model = model or self.model
        instructions, input_items = _openai_input(messages)
        return self._openai_payload_for_input(
            input_items=input_items,
            instructions=instructions,
            model=active_model,
            stream=stream,
            tools=tools,
        )

    def _openai_payload_for_input(
        self,
        input_items: list[dict],
        instructions: str | None,
        model: str,
        stream: bool = False,
        tools: list[dict] | None = None,
    ) -> dict:
        payload: dict[str, Any] = {
            "model": model,
            "input": input_items,
            "max_output_tokens": settings.llm_num_predict,
            "store": False,
        }
        if instructions:
            payload["instructions"] = instructions
        if tools:
            payload["tools"] = tools
        if settings.openai_reasoning_effort and _supports_reasoning(model):
            payload["reasoning"] = {"effort": settings.openai_reasoning_effort}
        if stream:
            payload["stream"] = True
            payload["stream_options"] = {"include_obfuscation": False}
        return payload

    @staticmethod
    def _openai_error(response: httpx.Response) -> RuntimeError:
        try:
            body = response.json()
            detail = (body.get("error") or {}).get("message") or response.text
        except Exception:
            detail = response.text
        return RuntimeError(f"OpenAI API error {response.status_code}: {detail}")

    async def _openai_chat(self, messages: list[dict], model: str | None = None) -> str:
        payload = self._openai_payload(messages, model=model)
        data = await self._openai_post(payload)
        return _openai_text_from_response(data)

    async def _openai_create_response(
        self,
        input_items: list[dict],
        instructions: str | None,
        model: str,
        tools: list[dict] | None = None,
    ) -> dict[str, Any]:
        payload = self._openai_payload_for_input(
            input_items=input_items,
            instructions=instructions,
            model=model,
            tools=tools,
        )
        return await self._openai_post(payload)

    async def _openai_post(self, payload: dict) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_s) as client:
            r = await client.post(
                f"{self.base_url}/responses",
                headers=self._openai_headers(),
                json=payload,
            )
            if r.status_code >= 400:
                raise self._openai_error(r)
            return r.json()

    @staticmethod
    def _decode_tool_args(call: dict[str, Any]) -> dict[str, Any]:
        try:
            args = json.loads(call.get("arguments") or "{}")
        except json.JSONDecodeError:
            return {}
        return args if isinstance(args, dict) else {}

    async def _openai_chat_stream(self, messages: list[dict], model: str | None = None):
        payload = self._openai_payload(messages, model=model, stream=True)
        async with httpx.AsyncClient(timeout=settings.llm_timeout_s) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/responses",
                headers=self._openai_headers(),
                json=payload,
            ) as r:
                if r.status_code >= 400:
                    body = await r.aread()
                    detail = body.decode(errors="replace")
                    raise RuntimeError(f"OpenAI API error {r.status_code}: {detail}")

                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line.removeprefix("data:").strip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        obj = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    if obj.get("type") == "response.output_text.delta":
                        delta = obj.get("delta") or ""
                        if delta:
                            yield delta
                    elif obj.get("type") == "error":
                        error = obj.get("error") or {}
                        raise RuntimeError(error.get("message") or "OpenAI stream error")
