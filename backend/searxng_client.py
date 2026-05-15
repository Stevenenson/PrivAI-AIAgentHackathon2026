"""Async wrapper for SearXNG JSON search API."""
from __future__ import annotations

import asyncio
import re
from html import unescape
from html.parser import HTMLParser
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from .config import settings


class SearxngClient:
    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.searxng_url).rstrip("/")

    async def search(self, query: str, top_k: int | None = None) -> list[dict]:
        top_k = top_k or settings.search_top_k
        try:
            return await self._searxng_search(query, top_k)
        except Exception:
            if settings.search_fallback_enabled:
                return await self._fallback_search(query, top_k)
            raise

    async def _searxng_search(self, query: str, top_k: int) -> list[dict]:
        async with httpx.AsyncClient(timeout=settings.search_timeout_s) as client:
            pages = max(1, min(10, (top_k + 9) // 10))
            responses = await asyncio.gather(
                *(
                    client.get(
                        f"{self.base_url}/search",
                        params={
                            "q": query,
                            "format": "json",
                            "safesearch": "1",
                            "pageno": page,
                        },
                    )
                    for page in range(1, pages + 1)
                )
            )
        results = []
        seen: set[str] = set()
        for response in responses:
            response.raise_for_status()
            for item in response.json().get("results", []):
                url = item.get("url", "")
                key = url.split("#", 1)[0] or item.get("title", "")
                if not key or key in seen:
                    continue
                seen.add(key)
                results.append(item)
                if len(results) >= top_k:
                    break
            if len(results) >= top_k:
                break

        formatted = []
        for item in results:
            formatted.append(
                {
                    "title": item.get("title", "").strip(),
                    "url": item.get("url", ""),
                    "content": item.get("content", "").strip(),
                }
            )
        return formatted

    async def _fallback_search(self, query: str, top_k: int) -> list[dict]:
        async with httpx.AsyncClient(
            timeout=settings.search_timeout_s,
            headers={
                "User-Agent": "Mozilla/5.0 Privai local desktop search fallback"
            },
            follow_redirects=True,
        ) as client:
            response = await client.get(
                settings.search_fallback_url,
                params={"q": query},
            )
            response.raise_for_status()

        parser = _DuckDuckGoHTMLParser()
        parser.feed(response.text)
        results = []
        seen: set[str] = set()
        for item in parser.results:
            url = _clean_duckduckgo_url(item.get("url", ""))
            title = _clean_text(item.get("title", ""))
            if not url or not title:
                continue
            key = url.split("#", 1)[0]
            if key in seen:
                continue
            seen.add(key)
            results.append({
                "title": title,
                "url": url,
                "content": _clean_text(item.get("content", "")),
            })
            if len(results) >= top_k:
                break
        return results

    async def health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                r = await client.get(f"{self.base_url}/healthz")
                if r.status_code == 200:
                    return True
                r = await client.get(f"{self.base_url}/")
                return r.status_code == 200
        except Exception:
            return False

    async def fallback_health(self) -> bool:
        return settings.search_fallback_enabled


class _DuckDuckGoHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[dict] = []
        self._current: dict | None = None
        self._field: str | None = None
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key: value or "" for key, value in attrs}
        klass = attrs_dict.get("class", "")
        if tag == "a" and "result__a" in klass:
            self._current = {"url": attrs_dict.get("href", ""), "title": "", "content": ""}
            self._field = "title"
            self._buffer = []
        elif self._current is not None and "result__snippet" in klass:
            self._field = "content"
            self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._field:
            self._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._current is None or self._field is None:
            return
        if self._field == "title" and tag == "a":
            self._current["title"] = "".join(self._buffer)
            self.results.append(self._current)
            self._field = None
            self._buffer = []
        elif self._field == "content" and tag in {"a", "div"}:
            self._current["content"] = "".join(self._buffer)
            self._field = None
            self._buffer = []


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", unescape(value)).strip()


def _clean_duckduckgo_url(url: str) -> str:
    url = unescape(url)
    parsed = urlparse(url)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path.startswith("/l/"):
        uddg = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(uddg)
    return url
