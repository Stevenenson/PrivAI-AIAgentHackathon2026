"""In-memory approval gate for agent terminal commands."""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field


class ApprovalNotFound(Exception):
    pass


class ApprovalOwnerMismatch(Exception):
    pass


@dataclass
class PendingApproval:
    id: str
    owner_uid: str
    command: str
    cwd: str
    created_at: float = field(default_factory=time.time)
    approved: bool | None = None
    event: asyncio.Event = field(default_factory=asyncio.Event)


class ApprovalBroker:
    def __init__(self) -> None:
        self._pending: dict[str, PendingApproval] = {}
        self._lock = asyncio.Lock()

    async def create(self, owner_uid: str, command: str, cwd: str) -> PendingApproval:
        pending = PendingApproval(
            id=str(uuid.uuid4()),
            owner_uid=owner_uid,
            command=command,
            cwd=cwd,
        )
        async with self._lock:
            self._pending[pending.id] = pending
        return pending

    async def decide(self, approval_id: str, owner_uid: str, approved: bool) -> None:
        async with self._lock:
            pending = self._pending.get(approval_id)
            if not pending:
                raise ApprovalNotFound(approval_id)
            if pending.owner_uid != owner_uid:
                raise ApprovalOwnerMismatch(approval_id)
            pending.approved = approved
            pending.event.set()

    async def wait(self, approval_id: str, timeout_s: int = 3600) -> bool:
        pending = self._pending.get(approval_id)
        if not pending:
            return False
        try:
            await asyncio.wait_for(pending.event.wait(), timeout_s)
            return bool(pending.approved)
        except asyncio.TimeoutError:
            return False
        finally:
            async with self._lock:
                self._pending.pop(approval_id, None)


command_approvals = ApprovalBroker()


@dataclass
class PendingQuestion:
    id: str
    owner_uid: str
    question: str
    options: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    answer: str | None = None
    event: asyncio.Event = field(default_factory=asyncio.Event)


class QuestionBroker:
    def __init__(self) -> None:
        self._pending: dict[str, PendingQuestion] = {}
        self._lock = asyncio.Lock()

    async def create(
        self,
        owner_uid: str,
        question: str,
        options: list[str] | None = None,
    ) -> PendingQuestion:
        pending = PendingQuestion(
            id=str(uuid.uuid4()),
            owner_uid=owner_uid,
            question=question,
            options=options or [],
        )
        async with self._lock:
            self._pending[pending.id] = pending
        return pending

    async def answer(self, question_id: str, owner_uid: str, answer: str) -> None:
        async with self._lock:
            pending = self._pending.get(question_id)
            if not pending:
                raise ApprovalNotFound(question_id)
            if pending.owner_uid != owner_uid:
                raise ApprovalOwnerMismatch(question_id)
            pending.answer = answer
            pending.event.set()

    async def wait(self, question_id: str, timeout_s: int = 1800) -> str | None:
        pending = self._pending.get(question_id)
        if not pending:
            return None
        try:
            await asyncio.wait_for(pending.event.wait(), timeout_s)
            return pending.answer
        except asyncio.TimeoutError:
            return None
        finally:
            async with self._lock:
                self._pending.pop(question_id, None)


question_broker = QuestionBroker()
