"""Decide whether a question needs web search, then build the LLM prompt.

Heuristics intentionally simple — a small LLM is not great at tool-routing,
so we keep the routing logic deterministic in Python.
"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from . import business, google_workspace, privacy_guard, runtime, terminal
from .config import settings
from .llm_client import LLMClient
from .searxng_client import SearxngClient

_SEARCH_KEYWORDS = (
    "search", "look up", "google", "find", "latest", "news", "current",
    "today", "yesterday", "this week", "weather", "price", "stock",
    "score", "result", "release", "version", "who is", "what is happening",
    "cauta", "caută", "rezuma", "rezumă", "stiri", "știri", "ultimele",
    "azi", "ieri", "saptamana", "săptămâna", "vremea", "pret", "preț",
)
_AGENT_SEARCH_KEYWORDS = (
    "search", "look up", "google", "find", "research", "sources", "source",
    "citations", "citation", "references", "reference", "cite", "latest",
    "news", "current", "today",
)
_URL_RE = re.compile(r"https?://\S+")

_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "could", "for",
    "from", "has", "have", "how", "i", "in", "is", "it", "me", "my", "of",
    "on", "or", "please", "that", "the", "their", "this", "to", "used",
    "using", "was", "what", "when", "where", "which", "who", "why", "with",
    "would", "you", "your",
}
_BUILD_WORDS = {
    "add", "artifact", "beautiful", "build", "builder", "citations", "code",
    "create", "design", "generator", "html", "images", "include", "links",
    "page", "photos", "pretty", "presentation", "references", "responsive",
    "site", "sources", "stunning", "used", "website",
}
_WEAK_AI_TERMS = {"ai", "artificial", "intelligence", "machine", "learning"}
_BUILD_RESULT_NOISE = (
    "website builder", "website generator", "ai website", "web design",
    "no-code", "nocode", "figma", "canva", "zapier", "hubspot", "framer",
    "reloom", "aura.build", "make it pretty",
)
_AUTHORITY_HOST_HINTS = (
    ".edu", ".gov", "acm.org", "arxiv.org", "brookings.edu", "ibm.com",
    "ieee.org", "microsoft.com", "nist.gov", "oecd.org", "research.google",
    "stanford.edu", "unesco.org",
)
_ASSET_DIRECTIVE_RE = re.compile(
    r"\b(?:and|plus|with|include|including|add|use|list)\b\s+(?:all\s+)?"
    r"(?:photos?\w*|images?|pictures?|sources?|citations?|references?|links?)\b.*$",
    re.IGNORECASE,
)
_TRAILING_BUILD_DIRECTIVE_RE = re.compile(
    r"[,;]\s*(?:also\s+)?(?:use|add|include|list|make)\b.*$",
    re.IGNORECASE,
)
_BUILD_REQUEST_RE = re.compile(
    r"\b(?:build|make|create|design|generate|write|craft)\b.*"
    r"\b(?:website|site|page|presentation|app|artifact|visuali[sz]ation)\b",
    re.IGNORECASE,
)
_SEARCH_COMMAND_RE = re.compile(
    r"^(?:hi|hello|hey)?[,!\s]*(?:please\s+)?"
    r"(?:search(?:\s+for)?|look\s+up|google|find|research|tell\s+me\s+about)\s+",
    re.IGNORECASE,
)


@dataclass
class ChatTurn:
    answer: str
    used_search: bool
    sources: list[dict]
    redactions: list[str]


@dataclass
class ChatPrep:
    messages: list[dict]
    used_search: bool
    sources: list[dict]
    redactions: list[str]
    mode: str = "chat"
    model: str | None = None
    provider: str | None = None
    route_reason: str | None = None
    routed_sensitive: bool = False
    used_vision: bool = False


def needs_search(message: str) -> bool:
    low = message.lower()
    if _URL_RE.search(message):
        return True
    return any(k in low for k in _SEARCH_KEYWORDS)


def _agent_needs_search(message: str) -> bool:
    low = message.lower()
    if _URL_RE.search(message):
        return True
    return any(k in low for k in _AGENT_SEARCH_KEYWORDS)


def _clean_search_text(message: str) -> str:
    text = message.replace("\u2019", "'").replace("\u2018", "'")
    text = re.sub(r"\bcan\s+t\b", "can't", text, flags=re.IGNORECASE)
    text = re.sub(r"\bwon\s+t\b", "won't", text, flags=re.IGNORECASE)
    text = re.sub(r"[\r\n\t]+", " ", text)
    return re.sub(r"\s+", " ", text).strip(" .?!")


def _strip_build_scaffold(text: str) -> str:
    text = re.sub(
        r"^(?:hi|hello|hey)?[,!\s]*(?:please\s+)?"
        r"(?:build|make|create|design|generate|write|craft)\s+"
        r"(?:me\s+)?(?:a|an|the)?\s*"
        r"(?:(?:very|really)\s+)?"
        r"(?:pretty|beautiful|stunning|modern|responsive|single-page|one-page)?\s*"
        r"(?:website|site|web\s+page|page|landing\s+page|presentation|app|artifact|visuali[sz]ation)?\s*"
        r"(?:that|which|to)?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"^(?:explain(?:ing)?|present(?:s|ing)?|show(?:ing)?|summari[sz](?:e|ing)|about|on)\s+",
        "",
        text,
        flags=re.IGNORECASE,
    )
    return text.strip(" .?!")


def _extract_research_topic(message: str, mode: str) -> str:
    """Separate the thing to build from the thing to research."""
    text = _clean_search_text(message)
    is_build = mode == "agent" or bool(_BUILD_REQUEST_RE.search(text))
    candidate = text

    if is_build:
        # Prefer the semantic clause. For "build a website that explains why X",
        # searching "why X" is much better than searching "build a website".
        for pattern in (
            r"\bwhy\b.+",
            r"\bhow\b.+",
            r"\bwhat\b.+",
            r"\bwhether\b.+",
            r"\babout\b\s+.+",
            r"\bon\b\s+.+",
            r"\bexplain(?:s|ing)?\b\s+.+",
            r"\bpresent(?:s|ing)?\b\s+.+",
        ):
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if match:
                candidate = match.group(0)
                break
    else:
        candidate = _SEARCH_COMMAND_RE.sub("", text)

    candidate = _ASSET_DIRECTIVE_RE.sub("", candidate)
    candidate = _TRAILING_BUILD_DIRECTIVE_RE.sub("", candidate)
    candidate = re.sub(
        r"\b(?:and|plus|with|include|including|add)\s*$",
        "",
        candidate,
        flags=re.IGNORECASE,
    )
    candidate = _strip_build_scaffold(candidate)
    candidate = re.sub(r"\s+", " ", candidate).strip(" .,;?!")
    return candidate or text[:180]


def _topic_keywords(topic: str) -> tuple[set[str], set[str]]:
    tokens = set()
    for token in re.findall(r"[a-z0-9][a-z0-9'-]{1,}", topic.lower()):
        token = token.strip("'")
        if token in _STOPWORDS or token in _BUILD_WORDS:
            continue
        tokens.add(token)

    low = topic.lower()
    if "unbiased" in low or "bias" in low or "biased" in low:
        tokens.update({
            "algorithmic", "bias", "biased", "discrimination", "fairness",
            "neutral", "unbiased",
        })
    if re.search(r"\bai\b|artificial intelligence", low):
        tokens.update(_WEAK_AI_TERMS)

    weak = set(_WEAK_AI_TERMS)
    return tokens, weak


def _expand_query(topic: str) -> str:
    low = topic.lower()
    extras: list[str] = []
    if re.search(r"\bai\b|artificial intelligence", low):
        extras.extend(["artificial intelligence", "machine learning"])
    if "unbiased" in low or "bias" in low or "biased" in low:
        extras.extend([
            "algorithmic bias", "fairness", "training data", "human bias",
        ])
    query = " ".join([topic, *extras])
    words: list[str] = []
    seen: set[str] = set()
    for word in query.split():
        key = word.lower().strip(".,:;")
        if key and key not in seen:
            words.append(word)
            seen.add(key)
    return " ".join(words)[:240]


def _plan_search_queries(message: str, mode: str) -> tuple[str, list[str]]:
    topic = _extract_research_topic(message, mode)
    queries = [_expand_query(topic)]
    low = topic.lower()
    if re.search(r"\bai\b|artificial intelligence", low) and (
        "unbiased" in low or "bias" in low or "biased" in low
    ):
        queries.extend([
            "algorithmic bias artificial intelligence training data fairness",
            "AI bias examples facial recognition hiring healthcare",
        ])
    elif queries[0].lower() != topic.lower():
        queries.append(topic)

    deduped: list[str] = []
    seen: set[str] = set()
    for query in queries:
        key = query.lower()
        if key not in seen:
            deduped.append(query)
            seen.add(key)
    return topic, deduped[:3]


def _contains_term(text: str, term: str) -> bool:
    if len(term) <= 3:
        return re.search(rf"\b{re.escape(term)}\b", text) is not None
    return term in text


def _looks_like_build_result(result: dict, topic: str) -> bool:
    topic_low = topic.lower()
    if any(word in topic_low for word in ("website", "web design", "builder")):
        return False
    haystack = " ".join(
        str(result.get(k) or "").lower() for k in ("title", "content", "url")
    )
    return any(noise in haystack for noise in _BUILD_RESULT_NOISE)


def _score_source(result: dict, keywords: set[str], weak: set[str]) -> tuple[int, int]:
    title = str(result.get("title") or "").lower()
    body = " ".join(
        str(result.get(k) or "").lower() for k in ("content", "url")
    )
    url = str(result.get("url") or "").lower()
    score = 0
    strong_hits = 0
    for term in keywords:
        in_title = _contains_term(title, term)
        in_body = _contains_term(body, term)
        if in_title:
            score += 3
        elif in_body:
            score += 1
        if term not in weak and (in_title or in_body):
            strong_hits += 1
    if any(hint in url for hint in _AUTHORITY_HOST_HINTS):
        score += 3
    return score, strong_hits


def _dedupe_results(results: list[dict]) -> list[dict]:
    deduped: list[dict] = []
    seen: set[str] = set()
    for result in results:
        url = str(result.get("url") or "").split("#", 1)[0]
        key = url or str(result.get("title") or "").lower()
        if not key or key in seen:
            continue
        deduped.append(result)
        seen.add(key)
    return deduped


def _filter_relevant_sources(results: list[dict], topic: str, limit: int) -> list[dict]:
    keywords, weak = _topic_keywords(topic)
    if not keywords:
        return _dedupe_results(results)[:limit]

    scored: list[tuple[int, dict]] = []
    requires_strong_hit = bool(keywords - weak)
    for result in _dedupe_results(results):
        if _looks_like_build_result(result, topic):
            continue
        score, strong_hits = _score_source(result, keywords, weak)
        if (
            (not requires_strong_hit and score > 0)
            or (strong_hits > 0 and score >= 1)
        ):
            scored.append((score, result))

    scored.sort(key=lambda item: item[0], reverse=True)
    return [result for _, result in scored[:limit]]


SYSTEM_PROMPT = (
    "You are Privai, a privacy-first local assistant running on the user's own "
    "hardware. Help everyday users and businesses get useful work done. Be "
    "clear, practical, and concise. If web context is provided, ground your "
    "answer in it and cite sources by their [n] reference. If no context is "
    "provided, answer from your own knowledge and say so. Never invent URLs. "
    "When recommending websites, products, stores, or articles from web "
    "context, include useful Markdown links using the provided URLs. Reply in "
    "the user's language."
)

AGENT_SYSTEM_PROMPT = (
    "You are Privai Agent, a local work agent running on the user's hardware, "
    "similar in spirit to Codex or Claude Code but useful for both businesses "
    "and developers. Your job is to work in the selected workspace, use the "
    "terminal when needed, create or edit real files, run checks, and leave the "
    "user with something they can use.\n"
    "\n"
    "Rules:\n"
    "1. Use the terminal tool for practical work: inspect the workspace first, "
    "then create/edit files, install dependencies when needed, and run focused "
    "verification commands. For business tasks, create useful workflow docs, "
    "templates, spreadsheets, scripts, dashboards, or small apps as appropriate.\n"
    "2. Keep all file work inside the workspace root. If the user wants an app "
    "on the Desktop, create a project folder inside the selected Desktop "
    "workspace or tell them to use File > Open Workspace... first.\n"
    "3. Prefer real project files over pasted code. For apps, create a normal "
    "folder with source files and package/config files rather than returning a "
    "long code block. For business automation, create files the user can open, "
    "reuse, and share.\n"
    "4. Use non-interactive commands only. If a command would prompt, choose "
    "flags that make it non-interactive or explain the exact manual command.\n"
    "5. Be careful with destructive commands. Do not delete, reset, overwrite "
    "large directories, or run privileged commands unless the user explicitly "
    "asked for that exact action.\n"
    "6. When finished, summarize what changed, list important file paths, and "
    "give the command to run the app, open the files, or check the result.\n"
    "7. For app/code changes, do not claim the work is done until you have run "
    "a relevant verification command such as lint, tests, build, or a smoke "
    "check. For business files, verify that the files exist and are in the "
    "right workspace. If verification cannot run, say exactly why and what "
    "command the user should run.\n"
    "8. For Vite/React apps, do not use `npx tailwindcss init -p` unless the "
    "user explicitly asks for legacy Tailwind setup. Prefer plain CSS, and "
    "before finalizing verify that every relative import exists, especially "
    "`./App.css` and local assets. Run `npm run build` and fix missing imports "
    "or broken assets before saying the app is ready.\n"
    "9. If a scaffolding command exits non-zero after creating files, inspect "
    "the created folder and continue from the existing package.json instead of "
    "blindly failing or rerunning the scaffold.\n"
    "10. If the user asks only for a quick visual preview or a single-file demo, "
    "you may return one complete self-contained HTML document inside an "
    "<artifact> block. For normal software/app requests, use files.\n"
    "11. Reply in the user's language for the prose; code and commands stay "
    "English.\n"
    "12. In Business space, use Google Workspace tools when the user asks "
    "about email, clients, meetings, calendars, availability, scheduling, or "
    "business follow-up. Gmail access is read-only. Calendar creation must be "
    "drafted as a pending Business action for user approval before it happens.\n"
)


def _experience_system_note(experience: dict | None) -> str:
    if not experience:
        return ""

    persona_labels = {
        "business": "business owner or operator",
        "developer": "developer or technical builder",
        "creator": "creator or marketer",
        "student": "student or researcher",
    }
    goal_labels = {
        "automate": "automate repetitive work",
        "build": "build or fix software",
        "research": "research and explain topics",
        "documents": "work with documents, PDFs, and reports",
    }
    detail_labels = {
        "simple": "plain language, fewer technical details",
        "balanced": "clear steps with useful context",
        "technical": "more implementation details and exact commands",
    }

    persona = str(experience.get("persona") or "").lower()
    goal = str(experience.get("primaryGoal") or "").lower()
    detail = str(experience.get("detailLevel") or "").lower()
    context = str(experience.get("businessContext") or "").strip()[:240]

    parts = [
        "User experience profile:",
        f"- Main use: {persona_labels.get(persona, 'general work')}.",
        f"- Primary goal: {goal_labels.get(goal, 'get useful work done')}.",
        f"- Preferred answer style: {detail_labels.get(detail, 'clear steps with useful context')}.",
    ]
    if context:
        parts.append(f"- User context: {context}.")

    parts.append(
        "Adapt the response and any created files to this profile. For business "
        "users, prefer practical workflows, checklists, templates, dashboards, "
        "and automation plans over developer jargon. For developers, include "
        "the exact project files, commands, and verification details."
    )
    return "\n".join(parts)


@lru_cache(maxsize=1)
def _agent_guidelines() -> str:
    path = Path(__file__).resolve().parent / "prompts" / "agent_guidelines.txt"
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _system_prompt_for(mode: str) -> str:
    if mode != "agent":
        return SYSTEM_PROMPT
    guidelines = _agent_guidelines()
    prompt = AGENT_SYSTEM_PROMPT if not guidelines else f"{AGENT_SYSTEM_PROMPT}\n\n{guidelines}"
    workspace_root = terminal.workspace_root_or_none()
    if settings.terminal_enabled and workspace_root:
        prompt += (
            "\n\nTerminal workspace root: "
            f"{workspace_root}. Use `cwd: \".\"` for this root. "
            "Run focused inspection commands before making claims about files "
            "or project behavior."
        )
    elif mode == "agent":
        prompt += (
            "\n\nNo coding workspace is selected yet. If the user asks you to "
            "read files, edit files, run commands, or build an app, tell them "
            "to open or create a workspace in Coding first."
        )
    return prompt


def _build_context_block(results: list[dict]) -> str:
    if not results:
        return ""
    lines = ["Web context (do not assume freshness beyond what is shown):"]
    for i, r in enumerate(results, 1):
        snippet = (r.get("content") or "").replace("\n", " ").strip()
        lines.append(f"[{i}] {r.get('title', '').strip()} — {r.get('url', '')}\n    {snippet}")
    return "\n".join(lines)


class Orchestrator:
    def __init__(self, llm: LLMClient, search: SearxngClient):
        self.llm = llm
        self.search = search

    async def _execute_agent_tool(
        self,
        name: str,
        args: dict,
        owner_uid: str | None = None,
    ) -> str:
        if name != "run_terminal_command":
            if owner_uid and name in {
                "search_email",
                "read_email_thread",
                "find_calendar_slots",
                "draft_calendar_event",
                "create_calendar_event",
            }:
                return await google_workspace.execute_tool(owner_uid, name, args)
            return terminal.error_json(f"unknown tool: {name}")
        command = str(args.get("command") or "")
        cwd = str(args.get("cwd") or ".")
        timeout = int(args.get("timeout_s") or settings.terminal_timeout_s)
        try:
            result = await terminal.run_command(command, cwd=cwd, timeout_s=timeout)
            return terminal.result_json(result)
        except Exception as e:
            return terminal.error_json(str(e), command=command)

    def _should_use_agent_tools(self, prep: ChatPrep) -> bool:
        return (
            prep.mode == "agent"
            and (prep.provider or settings.llm_provider) == "gemini"
            and not prep.used_vision
            and (
                (settings.terminal_enabled and terminal.workspace_root_or_none())
                or google_workspace.configured()
            )
        )

    async def complete(
        self,
        prep: ChatPrep,
        on_tool_event=None,
        request_tool_approval=None,
        owner_uid: str | None = None,
    ) -> str:
        llm = (
            self.llm
            if not prep.provider or prep.provider == self.llm.provider
            else LLMClient(provider=prep.provider)
        )
        if self._should_use_agent_tools(prep):
            tools: list[dict] = []
            if settings.terminal_enabled and terminal.workspace_root_or_none():
                tools.append(terminal.TERMINAL_TOOL)
            if owner_uid and google_workspace.configured():
                tools.extend(google_workspace.GOOGLE_WORKSPACE_TOOLS)
            if not tools:
                return await llm.chat(prep.messages, model=prep.model)

            async def execute_tool(name: str, args: dict) -> str:
                return await self._execute_agent_tool(name, args, owner_uid)

            return await llm.chat_with_tools(
                prep.messages,
                tools=tools,
                execute_tool=execute_tool,
                model=prep.model,
                max_iterations=max(1, min(settings.agent_max_tool_steps, 50)),
                on_tool_event=on_tool_event,
                request_tool_approval=request_tool_approval,
            )
        return await llm.chat(prep.messages, model=prep.model)

    async def _search_relevant_sources(
        self,
        message: str,
        mode: str,
        top_k: int | None,
    ) -> tuple[list[dict], str]:
        limit = top_k or (
            settings.agent_search_top_k if mode == "agent" else settings.search_top_k
        )
        fetch_k = min(max(limit * 2, 10), 100)
        topic, queries = _plan_search_queries(message, mode)

        responses = await asyncio.gather(
            *(self.search.search(query, top_k=fetch_k) for query in queries),
            return_exceptions=True,
        )

        raw_results: list[dict] = []
        errors: list[str] = []
        for response in responses:
            if isinstance(response, Exception):
                errors.append(str(response))
            else:
                raw_results.extend(response)

        if not raw_results and errors:
            raise RuntimeError("; ".join(errors[:2]))

        relevant = _filter_relevant_sources(raw_results, topic, limit)
        if not relevant and raw_results:
            return [], (
                f"web search returned results, but none matched the research "
                f"topic '{topic}', so they were not used"
            )
        return relevant, ""

    async def prepare(
        self,
        message: str,
        history: list[dict] | None = None,
        force_search: bool | None = None,
        mode: str = "chat",
        attachments_text: str | None = None,
        search_top_k: int | None = None,
        image_payloads: list[str] | None = None,
        experience: dict | None = None,
        privacy_mode: str | None = None,
    ) -> ChatPrep:
        guard = privacy_guard.scan(message)
        safe_message = guard.text

        # In agent mode, only search when the user explicitly asks for research,
        # citations, current facts, or sources. The build request itself is not
        # a reason to search.
        do_search = (
            force_search
            if force_search is not None
            else (
                _agent_needs_search(safe_message)
                if mode == "agent"
                else needs_search(safe_message)
            )
        )
        results: list[dict] = []
        if do_search:
            try:
                results, note = await self._search_relevant_sources(
                    safe_message,
                    mode,
                    search_top_k,
                )
                if note:
                    safe_message = f"{safe_message}\n\n[note: {note}]"
            except Exception as e:
                results = []
                safe_message = f"{safe_message}\n\n[note: web search failed: {e}]"

        route_text = "\n\n".join(
            part for part in [safe_message, attachments_text or ""] if part
        )
        chosen_provider, route_reason, routed_sensitive = business.choose_provider(
            privacy_mode or (experience or {}).get("privacyMode"),
            route_text,
        )

        sys_prompt = _system_prompt_for(mode)
        experience_note = _experience_system_note(experience)
        if experience_note:
            sys_prompt = f"{sys_prompt}\n\n{experience_note}"
        sys_prompt = (
            f"{sys_prompt}\n\nPrivacy routing: {route_reason}. "
            f"Active model provider for this turn: {chosen_provider}."
        )
        messages: list[dict] = [{"role": "system", "content": sys_prompt}]
        for h in history or []:
            messages.append({"role": h["role"], "content": h["content"]})

        ctx_block = _build_context_block(results)
        attach_block = (
            f"Attached files (verbatim excerpts):\n{attachments_text}\n\n"
            if attachments_text
            else ""
        )
        user_content = (
            f"{attach_block}{ctx_block}\n\nUser question: {safe_message}"
            if (ctx_block or attach_block)
            else safe_message
        )
        user_message = {"role": "user", "content": user_content}
        if image_payloads:
            user_message["images"] = image_payloads
        messages.append(user_message)

        return ChatPrep(
            messages=messages,
            used_search=do_search and bool(results),
            sources=results,
            redactions=guard.redactions,
            mode=mode,
            model=runtime.get_vision_model(chosen_provider) if image_payloads else None,
            provider=chosen_provider,
            route_reason=route_reason,
            routed_sensitive=routed_sensitive,
            used_vision=bool(image_payloads),
        )

    async def answer(
        self,
        message: str,
        history: list[dict] | None = None,
        force_search: bool | None = None,
        mode: str = "chat",
        attachments_text: str | None = None,
        search_top_k: int | None = None,
        image_payloads: list[str] | None = None,
        experience: dict | None = None,
        privacy_mode: str | None = None,
    ) -> ChatTurn:
        prep = await self.prepare(
            message,
            history,
            force_search,
            mode=mode,
            attachments_text=attachments_text,
            search_top_k=search_top_k,
            image_payloads=image_payloads,
            experience=experience,
            privacy_mode=privacy_mode,
        )
        answer = await self.complete(prep)
        return ChatTurn(
            answer=answer,
            used_search=prep.used_search,
            sources=prep.sources,
            redactions=prep.redactions,
        )

    async def generate_title(self, first_user_message: str) -> str:
        """Ask the LLM for a 3-6 word title for this conversation."""
        sys = (
            "You generate ultra-short titles for chat conversations. "
            "Reply with 3 to 6 words, no quotes, no trailing punctuation, "
            "no leading 'Title:' prefix. Use the user's language."
        )
        user = (
            "Write a 3-6 word title that captures the topic of this opening "
            "message:\n\n" + first_user_message[:600]
        )
        try:
            raw = await self.llm.chat(
                [
                    {"role": "system", "content": sys},
                    {"role": "user", "content": user},
                ]
            )
        except Exception:
            return first_user_message[:48]
        title = raw.strip().splitlines()[0].strip().strip('"').strip("'").strip(".")
        if title.lower().startswith("title:"):
            title = title.split(":", 1)[1].strip()
        return title[:80] or first_user_message[:48]

    async def compact(self, messages: list[dict]) -> str:
        """Summarize a conversation into a compact recap that can replace it."""
        if not messages:
            return ""
        body = "\n".join(
            f"{m['role'].upper()}: {m['content']}" for m in messages
        )[:8000]
        sys = (
            "You summarize a chat conversation so it can be compacted to save "
            "context. Produce: (1) a one-paragraph recap of what was discussed, "
            "(2) a bullet list of decisions made or facts established, "
            "(3) a bullet list of open questions or pending tasks. "
            "Be precise. Reply in the user's language."
        )
        return (
            await self.llm.chat(
                [
                    {"role": "system", "content": sys},
                    {"role": "user", "content": body},
                ]
            )
        ).strip()
