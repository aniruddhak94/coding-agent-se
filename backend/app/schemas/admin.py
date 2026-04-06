"""Pydantic schemas for the Admin Panel API."""
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


# ── Users ──────────────────────────────────────────────────────────────────

class UserListItem(BaseModel):
    id: int
    email: str
    full_name: Optional[str]
    role: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    users: list[UserListItem]
    total: int
    page: int
    limit: int


class BanRequest(BaseModel):
    ban: bool  # True = ban, False = unban


class RoleRequest(BaseModel):
    role: str  # "user" or "admin"


# ── Stats ──────────────────────────────────────────────────────────────────

class StatsResponse(BaseModel):
    total_users: int
    active_users: int
    total_repos: int
    total_workspaces: int
    active_containers: int


# ── Logs ───────────────────────────────────────────────────────────────────

class LogListItem(BaseModel):
    id: int
    user_id: Optional[int]
    user_email: Optional[str]   # joined from users table
    action: str
    metadata: dict[str, Any]
    created_at: datetime

    model_config = {"from_attributes": True}


class LogListResponse(BaseModel):
    logs: list[LogListItem]
    total: int
    page: int
    limit: int
