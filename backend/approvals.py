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
