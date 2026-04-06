"""AdminService — business logic for the admin panel."""
import logging
from typing import Optional

import docker
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole
from app.models.activity_log import ActivityLog
from app.services.log_service import LogService, USER_BANNED, USER_ROLE_CHANGED, USER_DELETED
from app.schemas.admin import (
    UserListItem,
    UserListResponse,
    StatsResponse,
    LogListItem,
    LogListResponse,
)

logger = logging.getLogger(__name__)


class AdminService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── User Management ────────────────────────────────────────────────────

    async def list_users(
        self,
        search: Optional[str] = None,
        page: int = 1,
        limit: int = 20,
    ) -> UserListResponse:
        """List all users with optional email search."""
        q = select(User)
        if search:
            q = q.where(User.email.ilike(f"%{search}%"))

        count_q = select(func.count()).select_from(q.subquery())
        total = (await self.db.execute(count_q)).scalar_one()

        offset = (page - 1) * limit
        rows = (
            await self.db.execute(
                q.order_by(User.created_at.desc()).offset(offset).limit(limit)
            )
        ).scalars().all()

        return UserListResponse(
            users=[UserListItem.model_validate(u) for u in rows],
            total=total,
            page=page,
            limit=limit,
        )

    async def ban_user(self, user_id: int, ban: bool, admin_id: int) -> User:
        """Toggle is_active flag on a user."""
        user = await self._get_user_or_404(user_id)
        user.is_active = not ban
        await self.db.commit()
        await self.db.refresh(user)
        await LogService(self.db).log(
            action=USER_BANNED,
            user_id=admin_id,
            metadata={"target_user_id": user_id, "banned": ban},
        )
        return user

    async def change_role(self, user_id: int, role: str, admin_id: int) -> User:
        """Promote or demote a user's role."""
        if role not in (UserRole.USER.value, UserRole.ADMIN.value):
            raise ValueError(f"Invalid role: {role}")
        user = await self._get_user_or_404(user_id)
        old_role = user.role
        user.role = role
        await self.db.commit()
        await self.db.refresh(user)
        await LogService(self.db).log(
            action=USER_ROLE_CHANGED,
            user_id=admin_id,
            metadata={"target_user_id": user_id, "from": old_role, "to": role},
        )
        return user

    async def delete_user_cascade(self, user_id: int, admin_id: int) -> dict:
        """
        Trigger cascade deletion asynchronously.
        Returns immediately — actual deletion runs in background.
        """
        user = await self._get_user_or_404(user_id)

        # Enqueue Celery task if available, otherwise run inline
        try:
            from app.tasks.admin_tasks import delete_user_task
            delete_user_task.delay(user_id)
            logger.info(f"Admin {admin_id} queued cascade delete for user {user_id}")
        except ImportError:
            # Celery not configured — run simplified inline delete
            await self._inline_delete_user(user_id)
            logger.info(f"Admin {admin_id} inline-deleted user {user_id}")

        await LogService(self.db).log(
            action=USER_DELETED,
            user_id=admin_id,
            metadata={"target_user_id": user_id, "email": user.email},
        )
        return {"message": f"User {user_id} deletion queued", "user_id": user_id}

    async def _inline_delete_user(self, user_id: int):
        """Simplified synchronous deletion (fallback when Celery unavailable)."""
        from sqlalchemy import delete as sql_delete
        from app.models.file import Repository, FileChunk, File
        from app.models.workspace import Workspace

        # Delete workspaces
        ws_result = await self.db.execute(select(Workspace).where(Workspace.user_id == user_id))
        for ws in ws_result.scalars().all():
            await self.db.delete(ws)

        # Delete repos (cascades files/chunks via FK)
        repo_result = await self.db.execute(select(Repository).where(Repository.owner_id == user_id))
        for repo in repo_result.scalars().all():
            await self.db.delete(repo)

        # Delete activity logs
        await self.db.execute(
            sql_delete(ActivityLog).where(ActivityLog.user_id == user_id)
        )

        # Delete user
        user = await self._get_user_or_404(user_id)
        await self.db.delete(user)
        await self.db.commit()

    # ── Stats ──────────────────────────────────────────────────────────────

    async def get_stats(self) -> StatsResponse:
        """Compute platform-wide statistics."""
        from app.models.file import Repository
        from app.models.workspace import Workspace

        total_users = (await self.db.execute(select(func.count(User.id)))).scalar_one()
        active_users = (
            await self.db.execute(select(func.count(User.id)).where(User.is_active == True))
        ).scalar_one()
        total_repos = (await self.db.execute(select(func.count(Repository.id)))).scalar_one()
        total_workspaces = (await self.db.execute(select(func.count(Workspace.id)))).scalar_one()

        # Count running Docker containers (any that start with "ica-ws-")
        active_containers = 0
        try:
            client = docker.from_env()
            containers = client.containers.list(filters={"name": "ica-ws-", "status": "running"})
            active_containers = len(containers)
        except Exception as e:
            logger.warning(f"Could not query Docker for container count: {e}")

        return StatsResponse(
            total_users=total_users,
            active_users=active_users,
            total_repos=total_repos,
            total_workspaces=total_workspaces,
            active_containers=active_containers,
        )

    # ── Logs ───────────────────────────────────────────────────────────────

    async def get_logs(
        self,
        user_id: Optional[int] = None,
        action: Optional[str] = None,
        start=None,
        end=None,
        page: int = 1,
        limit: int = 50,
    ) -> LogListResponse:
        """Fetch activity logs with optional filters, enriched with user email."""
        from app.services.log_service import LogService

        raw_logs, total = await LogService(self.db).get_logs(
            user_id=user_id, action=action, start=start, end=end, page=page, limit=limit
        )

        # Bulk-fetch emails for all user_ids found in logs
        user_ids = list({log.user_id for log in raw_logs if log.user_id})
        email_map: dict[int, str] = {}
        if user_ids:
            result = await self.db.execute(select(User.id, User.email).where(User.id.in_(user_ids)))
            email_map = {row.id: row.email for row in result}

        items = [
            LogListItem(
                id=log.id,
                user_id=log.user_id,
                user_email=email_map.get(log.user_id) if log.user_id else None,
                action=log.action,
                metadata=log.metadata_,
                created_at=log.created_at,
            )
            for log in raw_logs
        ]

        return LogListResponse(logs=items, total=total, page=page, limit=limit)

    # ── Helpers ────────────────────────────────────────────────────────────

    async def _get_user_or_404(self, user_id: int) -> User:
        result = await self.db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail=f"User {user_id} not found")
        return user
