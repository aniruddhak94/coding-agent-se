"""
LogService — write and read ActivityLog entries.
Usage:
    log_service = LogService(db)
    await log_service.log(user_id=1, action="USER_LOGIN", metadata={"ip": "..."})
"""
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity_log import ActivityLog

# ── Standard action constants ──────────────────────────────────────────────
USER_LOGIN = "USER_LOGIN"
USER_DELETED = "USER_DELETED"
USER_BANNED = "USER_BANNED"
USER_ROLE_CHANGED = "USER_ROLE_CHANGED"
REPO_CREATED = "REPO_CREATED"
REPO_DELETED = "REPO_DELETED"
AGENT_RUN = "AGENT_RUN"
WORKSPACE_CREATED = "WORKSPACE_CREATED"
WORKSPACE_DELETED = "WORKSPACE_DELETED"
ERROR = "ERROR"


class LogService:
    """Shared service for writing and querying activity logs."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Write ──────────────────────────────────────────────────────────────

    async def log(
        self,
        action: str,
        user_id: Optional[int] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> ActivityLog:
        """Persist one log entry. Call-sites should await this."""
        entry = ActivityLog(
            user_id=user_id,
            action=action,
            metadata_=metadata or {},
        )
        self.db.add(entry)
        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    # ── Read ───────────────────────────────────────────────────────────────

    async def get_logs(
        self,
        user_id: Optional[int] = None,
        action: Optional[str] = None,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        page: int = 1,
        limit: int = 50,
    ) -> tuple[list[ActivityLog], int]:
        """Return (logs, total_count) with optional filters."""
        conditions = []
        if user_id is not None:
            conditions.append(ActivityLog.user_id == user_id)
        if action:
            conditions.append(ActivityLog.action == action)
        if start:
            conditions.append(ActivityLog.created_at >= start)
        if end:
            conditions.append(ActivityLog.created_at <= end)

        where_clause = and_(*conditions) if conditions else True

        # Total count
        count_q = await self.db.execute(
            select(func.count()).select_from(ActivityLog).where(where_clause)
        )
        total = count_q.scalar_one()

        # Paginated rows
        offset = (page - 1) * limit
        rows_q = await self.db.execute(
            select(ActivityLog)
            .where(where_clause)
            .order_by(ActivityLog.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        logs = list(rows_q.scalars().all())

        return logs, total
