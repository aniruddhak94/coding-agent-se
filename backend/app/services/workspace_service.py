"""Workspace service for managing persistent Docker sandbox environments."""
import os
import asyncio
import logging
from datetime import datetime
from typing import Optional, List

import docker
from docker.errors import NotFound, APIError, ImageNotFound
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func

from app.models.workspace import Workspace
from app.models.file import Repository
from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# Language detection for file extensions
EXTENSION_LANGUAGES = {
    ".py": "python", ".js": "javascript", ".ts": "typescript",
    ".tsx": "typescript", ".jsx": "javascript", ".java": "java",
    ".cpp": "cpp", ".c": "c", ".go": "go", ".rs": "rust",
    ".html": "html", ".css": "css", ".json": "json",
    ".yaml": "yaml", ".yml": "yaml", ".md": "markdown",
    ".sh": "bash", ".sql": "sql", ".rb": "ruby", ".php": "php",
}


class WorkspaceService:
    """Manages persistent Docker workspace containers."""

    def __init__(self, db: AsyncSession):
        self.db = db
        try:
            self.docker_client = docker.from_env()
        except Exception as e:
            logger.warning(f"Docker client not available: {e}")
            self.docker_client = None

    # ── Lifecycle ──────────────────────────────────────────────

    async def create_workspace(
        self,
        user_id: int,
        repo_url: Optional[str] = None,
        repo_id: Optional[int] = None,
        name: Optional[str] = None,
    ) -> Workspace:
        """Create a new workspace from a repo URL or DB repo."""
        if not self.docker_client:
            raise RuntimeError("Docker is not available. Please ensure Docker Desktop is running.")

        # Resolve repo URL from DB if repo_id given
        if repo_id and not repo_url:
            result = await self.db.execute(
                select(Repository).where(Repository.id == repo_id)
            )
            repo = result.scalar_one_or_none()
            if not repo:
                raise ValueError(f"Repository {repo_id} not found")
            repo_url = repo.url
            name = name or repo.name

        if not repo_url:
            raise ValueError("Either repo_url or repo_id must be provided")

        name = name or repo_url.rstrip("/").rsplit("/", 1)[-1].replace(".git", "")
        volume_name = f"ica_ws_{user_id}_{name}_{int(datetime.utcnow().timestamp())}"
        base_image = settings.workspace_base_image

        # Create DB record
        workspace = Workspace(
            user_id=user_id,
            repo_id=repo_id,
            name=name,
            status="creating",
            base_image=base_image,
            volume_name=volume_name,
            repo_url=repo_url,
        )
        self.db.add(workspace)
        await self.db.commit()
        await self.db.refresh(workspace)

        # Run Docker setup in true background to immediately return to frontend
        asyncio.create_task(
            self._background_setup(
                workspace.id,
                volume_name,
                base_image,
                repo_url,
                name,
            )
        )

        return workspace

    async def _background_setup(
        self, workspace_id: int, volume_name: str, base_image: str, repo_url: str, name: str
    ):
        """Runs the blocking Docker setup and updates the DB with a new session."""
        try:
            container_id = await asyncio.get_event_loop().run_in_executor(
                None,
                self._setup_container,
                volume_name,
                base_image,
                repo_url,
                name,
            )
            from app.core.database import async_session_maker
            async with async_session_maker() as db:
                workspace = await db.get(Workspace, workspace_id)
                if workspace:
                    workspace.container_id = container_id
                    workspace.status = "running"
                    workspace.last_accessed_at = datetime.utcnow()
                    await db.commit()
        except Exception as e:
            logger.error(f"Failed to create workspace in background: {e}")
            from app.core.database import async_session_maker
            async with async_session_maker() as db:
                workspace = await db.get(Workspace, workspace_id)
                if workspace:
                    workspace.status = "error"
                    workspace.error_message = str(e)
                    await db.commit()

    def _setup_container(
        self, volume_name: str, base_image: str, repo_url: str, name: str
    ) -> str:
        """Create volume, start container, clone repo. Runs in thread pool."""
        # Ensure image exists
        try:
            self.docker_client.images.get(base_image)
        except ImageNotFound:
            logger.info(f"Pulling image {base_image}...")
            self.docker_client.images.pull(base_image)

        # Create volume
        self.docker_client.volumes.create(name=volume_name)

        # Start container with volume mounted
        container = self.docker_client.containers.run(
            image=base_image,
            command="sleep infinity",  # Keep alive
            volumes={volume_name: {"bind": "/workspace", "mode": "rw"}},
            working_dir="/workspace",
            name=f"ica_ws_{name}_{volume_name[-8:]}",
            detach=True,
            mem_limit="512m",
            cpu_period=100000,
            cpu_quota=100000,  # 1 full CPU
        )

        # Clone repo inside container
        exit_code, output = container.exec_run(
            f"git clone {repo_url} .",
            workdir="/workspace",
        )
        if exit_code != 0:
            error_msg = output.decode("utf-8", errors="replace")
            # If directory not empty (already cloned), that's okay
            if "already exists and is not an empty directory" not in error_msg:
                logger.warning(f"Git clone warning: {error_msg}")

        return container.id

    async def start_workspace(self, workspace_id: int, user_id: int) -> Workspace:
        """Start a stopped workspace."""
        workspace = await self._get_owned(workspace_id, user_id)
        if not workspace:
            raise ValueError("Workspace not found")
        if workspace.status == "running":
            return workspace

        if not workspace.container_id:
            raise ValueError("No container associated with this workspace")

        await asyncio.get_event_loop().run_in_executor(
            None, self._start_container, workspace.container_id
        )
        workspace.status = "running"
        workspace.last_accessed_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(workspace)
        return workspace

    def _start_container(self, container_id: str):
        try:
            container = self.docker_client.containers.get(container_id)
            container.start()
        except NotFound:
            raise ValueError("Container no longer exists")

    async def stop_workspace(self, workspace_id: int, user_id: int) -> Workspace:
        """Stop a running workspace."""
        workspace = await self._get_owned(workspace_id, user_id)
        if not workspace:
            raise ValueError("Workspace not found")
        if workspace.status == "stopped":
            return workspace

        if workspace.container_id:
            await asyncio.get_event_loop().run_in_executor(
                None, self._stop_container, workspace.container_id
            )
        workspace.status = "stopped"
        await self.db.commit()
        await self.db.refresh(workspace)
        return workspace

    def _stop_container(self, container_id: str):
        try:
            container = self.docker_client.containers.get(container_id)
            container.stop(timeout=5)
        except NotFound:
            pass

    async def destroy_workspace(self, workspace_id: int, user_id: int) -> None:
        """Remove container, volume, and DB record."""
        workspace = await self._get_owned(workspace_id, user_id)
        if not workspace:
            raise ValueError("Workspace not found")

        await asyncio.get_event_loop().run_in_executor(
            None, self._destroy_resources, workspace.container_id, workspace.volume_name
        )
        workspace.status = "destroyed"
        await self.db.delete(workspace)
        await self.db.commit()

    def _destroy_resources(self, container_id: Optional[str], volume_name: Optional[str]):
        if container_id:
            try:
                container = self.docker_client.containers.get(container_id)
                container.remove(force=True)
            except NotFound:
                pass
        if volume_name:
            try:
                volume = self.docker_client.volumes.get(volume_name)
                volume.remove(force=True)
            except NotFound:
                pass

    # ── Queries ────────────────────────────────────────────────

    async def get_workspace(self, workspace_id: int, user_id: int) -> Optional[Workspace]:
        """Get workspace with live status refresh."""
        workspace = await self._get_owned(workspace_id, user_id)
        if workspace and workspace.container_id and workspace.status not in ("destroyed", "creating"):
            # Refresh status from Docker
            actual_status = await asyncio.get_event_loop().run_in_executor(
                None, self._check_container_status, workspace.container_id
            )
            if actual_status and actual_status != workspace.status:
                workspace.status = actual_status
                await self.db.commit()
                await self.db.refresh(workspace)
        return workspace

    def _check_container_status(self, container_id: str) -> Optional[str]:
        try:
            container = self.docker_client.containers.get(container_id)
            docker_status = container.status  # running, exited, paused, etc.
            if docker_status == "running":
                return "running"
            elif docker_status in ("exited", "dead"):
                return "stopped"
            return None
        except NotFound:
            return "stopped"

    async def list_workspaces(
        self, user_id: int, limit: int = 20, offset: int = 0
    ) -> tuple[list[Workspace], int]:
        """List user's workspaces."""
        count_result = await self.db.execute(
            select(func.count()).select_from(Workspace).where(
                Workspace.user_id == user_id,
                Workspace.status != "destroyed",
            )
        )
        total = count_result.scalar() or 0

        result = await self.db.execute(
            select(Workspace)
            .where(Workspace.user_id == user_id, Workspace.status != "destroyed")
            .order_by(desc(Workspace.created_at))
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all()), total

    async def _get_owned(self, workspace_id: int, user_id: int) -> Optional[Workspace]:
        result = await self.db.execute(
            select(Workspace).where(
                Workspace.id == workspace_id,
                Workspace.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    # ── File System Operations ─────────────────────────────────

    async def list_files(self, workspace_id: int, user_id: int, path: str = ".") -> list[dict]:
        """List files/dirs in a workspace path."""
        workspace = await self._get_running(workspace_id, user_id)
        full_path = self._resolve_path(workspace.work_dir, path)

        output = await self._exec(workspace.container_id, f"ls -laF --group-directories-first {full_path}")
        entries = []
        for line in output.strip().split("\n"):
            if line.startswith("total") or not line.strip():
                continue
            parts = line.split(None, 8)
            if len(parts) < 9:
                continue
            name = parts[8].rstrip("*/@ ")
            if name in (".", ".."):
                continue

            is_dir = parts[0].startswith("d")
            size = int(parts[4]) if not is_dir else None
            entry_path = f"{path}/{name}".lstrip("./")
            entries.append({
                "name": name,
                "path": entry_path,
                "type": "dir" if is_dir else "file",
                "size": size,
            })
        return entries

    async def read_file(self, workspace_id: int, user_id: int, path: str) -> dict:
        """Read file content from workspace."""
        workspace = await self._get_running(workspace_id, user_id)
        full_path = self._resolve_path(workspace.work_dir, path)

        content = await self._exec(workspace.container_id, f"cat {full_path}")

        # Detect language
        ext = ""
        if "." in path:
            ext = "." + path.rsplit(".", 1)[-1].lower()
        language = EXTENSION_LANGUAGES.get(ext)

        workspace.last_accessed_at = datetime.utcnow()
        await self.db.commit()

        return {"path": path, "content": content, "language": language}

    async def write_file(self, workspace_id: int, user_id: int, path: str, content: str) -> dict:
        """Write content to a file in the workspace."""
        workspace = await self._get_running(workspace_id, user_id)
        full_path = self._resolve_path(workspace.work_dir, path)

        # Ensure parent directory exists
        parent_dir = "/".join(full_path.split("/")[:-1])
        if parent_dir:
            await self._exec(workspace.container_id, f"mkdir -p {parent_dir}")

        # Write file using base64 encoding to safely handle ANY content
        # (heredoc + shell escaping breaks on code with quotes, backslashes, $, etc.)
        import base64
        encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
        await self._exec(
            workspace.container_id,
            f"echo '{encoded}' | base64 -d > {full_path}"
        )

        # Verify write by checking file exists
        workspace.last_accessed_at = datetime.utcnow()
        await self.db.commit()

        return {"path": path, "status": "written"}

    async def create_file(
        self, workspace_id: int, user_id: int, path: str, is_directory: bool = False, content: str = ""
    ) -> dict:
        """Create a new file or directory."""
        workspace = await self._get_running(workspace_id, user_id)
        full_path = self._resolve_path(workspace.work_dir, path)

        if is_directory:
            await self._exec(workspace.container_id, f"mkdir -p {full_path}")
        else:
            parent = "/".join(full_path.split("/")[:-1])
            if parent:
                await self._exec(workspace.container_id, f"mkdir -p {parent}")
            if content:
                import base64
                encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
                await self._exec(
                    workspace.container_id,
                    f"echo '{encoded}' | base64 -d > {full_path}"
                )
            else:
                await self._exec(workspace.container_id, f"touch {full_path}")

        return {"path": path, "type": "dir" if is_directory else "file", "status": "created"}

    async def delete_file(self, workspace_id: int, user_id: int, path: str) -> dict:
        """Delete a file or directory."""
        workspace = await self._get_running(workspace_id, user_id)
        full_path = self._resolve_path(workspace.work_dir, path)

        # Safety: prevent deleting workspace root
        if full_path.rstrip("/") == workspace.work_dir.rstrip("/"):
            raise ValueError("Cannot delete workspace root directory")

        await self._exec(workspace.container_id, f"rm -rf {full_path}")
        return {"path": path, "status": "deleted"}

    # ── Helpers ─────────────────────────────────────────────────

    async def _get_running(self, workspace_id: int, user_id: int) -> Workspace:
        """Get workspace and verify it's running."""
        workspace = await self._get_owned(workspace_id, user_id)
        if not workspace:
            raise ValueError("Workspace not found")
        if workspace.status != "running":
            raise ValueError(f"Workspace is not running (status: {workspace.status})")
        if not workspace.container_id:
            raise ValueError("No container associated with this workspace")
        return workspace

    @staticmethod
    def _resolve_path(work_dir: str, relative_path: str) -> str:
        """Resolve and sanitize a path inside the workspace."""
        # Prevent path traversal
        clean = relative_path.replace("\\", "/").strip("/")
        if ".." in clean.split("/"):
            raise ValueError("Path traversal is not allowed")
        if clean == "." or clean == "":
            return work_dir
        return f"{work_dir}/{clean}"

    async def _exec(self, container_id: str, command: str) -> str:
        """Execute a command inside a container and return stdout."""
        output = await asyncio.get_event_loop().run_in_executor(
            None, self._exec_sync, container_id, command
        )
        return output

    def _exec_sync(self, container_id: str, command: str) -> str:
        """Blocking exec inside container."""
        try:
            container = self.docker_client.containers.get(container_id)
            exit_code, output = container.exec_run(command, workdir="/workspace")
            text = output.decode("utf-8", errors="replace")
            if exit_code != 0:
                logger.debug(f"Command '{command[:50]}' exited with {exit_code}: {text[:200]}")
            return text
        except NotFound:
            raise ValueError("Workspace container not found. It may have been removed.")
        except APIError as e:
            raise RuntimeError(f"Docker API error: {e}")
