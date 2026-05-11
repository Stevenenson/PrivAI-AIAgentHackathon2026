"""Async wrapper for SearXNG JSON search API."""
from __future__ import annotations

import asyncio

import httpx

from .config import settings


class SearxngClient:
    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.searxng_url).rstrip("/")

    async def search(self, query: str, top_k: int | None = None) -> list[dict]:
        top_k = top_k or settings.search_top_k
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
