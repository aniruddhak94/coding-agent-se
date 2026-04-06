"""Admin Panel API routes — all routes require ADMIN role."""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import DbSession, CurrentAdminUser
from app.services.admin_service import AdminService
from app.schemas.admin import (
    UserListResponse,
    UserListItem,
    BanRequest,
    RoleRequest,
    StatsResponse,
    LogListResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["Admin"])


# ── Users ──────────────────────────────────────────────────────────────────

@router.get("/users", response_model=UserListResponse)
async def list_users(
    db: DbSession,
    admin: CurrentAdminUser,
    search: Optional[str] = Query(None, description="Filter by email"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    """List all users with optional email search. Admin only."""
    service = AdminService(db)
    return await service.list_users(search=search, page=page, limit=limit)


@router.patch("/users/{user_id}/ban", response_model=UserListItem)
async def ban_user(
    user_id: int,
    request: BanRequest,
    db: DbSession,
    admin: CurrentAdminUser,
):
    """Ban or unban a user. Admin only."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot ban yourself")
    service = AdminService(db)
    user = await service.ban_user(user_id=user_id, ban=request.ban, admin_id=admin.id)
    return UserListItem.model_validate(user)


@router.patch("/users/{user_id}/role", response_model=UserListItem)
async def change_user_role(
    user_id: int,
    request: RoleRequest,
    db: DbSession,
    admin: CurrentAdminUser,
):
    """Promote or demote a user's role. Admin only."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    service = AdminService(db)
    user = await service.change_role(user_id=user_id, role=request.role, admin_id=admin.id)
    return UserListItem.model_validate(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_202_ACCEPTED)
async def delete_user(
    user_id: int,
    db: DbSession,
    admin: CurrentAdminUser,
):
    """
    Queue cascade deletion of a user (workspaces, repos, chats, logs, then user).
    Returns 202 immediately — Celery handles the actual work.
    Admin only.
    """
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    service = AdminService(db)
    return await service.delete_user_cascade(user_id=user_id, admin_id=admin.id)


# ── Stats ──────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    db: DbSession,
    admin: CurrentAdminUser,
):
    """System-wide statistics. Admin only."""
    service = AdminService(db)
    return await service.get_stats()


# ── Logs ───────────────────────────────────────────────────────────────────

@router.get("/logs", response_model=LogListResponse)
async def get_logs(
    db: DbSession,
    admin: CurrentAdminUser,
    user_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None),
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    """Activity logs with filters. Admin only."""
    service = AdminService(db)
    return await service.get_logs(
        user_id=user_id, action=action, start=start, end=end, page=page, limit=limit
    )
