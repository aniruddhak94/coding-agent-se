"""API routes for Phase 4A workspace management."""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.workspace import (
    WorkspaceCreate,
    WorkspaceResponse,
    WorkspaceListResponse,
    FileTreeResponse,
    FileNode,
    FileContentResponse,
    FileWriteRequest,
    FileCreateRequest,
    FileDeleteRequest,
)
from app.services.workspace_service import WorkspaceService
from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.services.log_service import LogService, WORKSPACE_CREATED

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/workspace", tags=["Workspace"])


@router.post("/create", response_model=WorkspaceResponse)
async def create_workspace(
    request: WorkspaceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new workspace from a repo."""
    if not request.repo_id and not request.repo_url:
        raise HTTPException(status_code=400, detail="Either repo_id or repo_url is required")

    service = WorkspaceService(db)
    try:
        workspace = await service.create_workspace(
            user_id=current_user.id,
            repo_url=request.repo_url,
            repo_id=request.repo_id,
            name=request.name,
        )
        await LogService(db).log(
            action=WORKSPACE_CREATED,
            user_id=current_user.id,
            metadata={"workspace_id": workspace.id, "name": workspace.name},
        )
        return WorkspaceResponse.model_validate(workspace)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("", response_model=WorkspaceListResponse)
async def list_workspaces(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
):
    """List user's workspaces."""
    service = WorkspaceService(db)
    workspaces, total = await service.list_workspaces(current_user.id, limit, offset)
    return WorkspaceListResponse(
        workspaces=[WorkspaceResponse.model_validate(w) for w in workspaces],
        total=total,
    )


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
async def get_workspace(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get workspace details with live status."""
    service = WorkspaceService(db)
    workspace = await service.get_workspace(workspace_id, current_user.id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return WorkspaceResponse.model_validate(workspace)


@router.post("/{workspace_id}/start", response_model=WorkspaceResponse)
async def start_workspace(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start a stopped workspace."""
    service = WorkspaceService(db)
    try:
        workspace = await service.start_workspace(workspace_id, current_user.id)
        return WorkspaceResponse.model_validate(workspace)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{workspace_id}/stop", response_model=WorkspaceResponse)
async def stop_workspace(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stop a running workspace."""
    service = WorkspaceService(db)
    try:
        workspace = await service.stop_workspace(workspace_id, current_user.id)
        return WorkspaceResponse.model_validate(workspace)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{workspace_id}")
async def destroy_workspace(
    workspace_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Destroy a workspace entirely (container + volume)."""
    service = WorkspaceService(db)
    try:
        await service.destroy_workspace(workspace_id, current_user.id)
        return {"message": "Workspace destroyed"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── File System Endpoints ──────────────────────────────────────


@router.get("/{workspace_id}/files", response_model=FileTreeResponse)
async def list_workspace_files(
    workspace_id: int,
    path: str = Query(".", description="Relative path to list"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List files and directories in a workspace path."""
    service = WorkspaceService(db)
    try:
        entries = await service.list_files(workspace_id, current_user.id, path)
        return FileTreeResponse(
            path=path,
            entries=[FileNode(**e) for e in entries],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{workspace_id}/files/read", response_model=FileContentResponse)
async def read_workspace_file(
    workspace_id: int,
    path: str = Query(..., description="File path to read"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Read a file's content from the workspace."""
    service = WorkspaceService(db)
    try:
        result = await service.read_file(workspace_id, current_user.id, path)
        return FileContentResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{workspace_id}/files/write")
async def write_workspace_file(
    workspace_id: int,
    request: FileWriteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Write/update a file in the workspace."""
    service = WorkspaceService(db)
    try:
        result = await service.write_file(
            workspace_id, current_user.id, request.path, request.content
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{workspace_id}/files/create")
async def create_workspace_file(
    workspace_id: int,
    request: FileCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new file or directory in the workspace."""
    service = WorkspaceService(db)
    try:
        result = await service.create_file(
            workspace_id, current_user.id, request.path,
            is_directory=request.is_directory, content=request.content or ""
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{workspace_id}/files")
async def delete_workspace_file(
    workspace_id: int,
    path: str = Query(..., description="File path to delete"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a file or directory from the workspace."""
    service = WorkspaceService(db)
    try:
        result = await service.delete_file(workspace_id, current_user.id, path)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
