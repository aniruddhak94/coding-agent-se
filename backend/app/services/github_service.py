"""GitHub API service for fetching repository contents."""
import base64
import logging
from typing import Optional, List
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# File extensions to index for RAG
CODE_EXTENSIONS = {
    '.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.cpp', '.c', '.h',
    '.hpp', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.cs',
    '.html', '.css', '.scss', '.json', '.yaml', '.yml', '.md', '.sql', '.sh',
}

# Directories to always skip
SKIP_DIRS = {
    'node_modules', 'venv', '.venv', '__pycache__', 'dist', 'build',
    '.git', '.next', '.cache', 'vendor', 'target', 'bin', 'obj',
    'coverage', '.tox', 'env', '.env',
}

# Max file size to fetch (1MB)
MAX_FILE_SIZE = 1024 * 1024


@dataclass
class GitHubFile:
    """Represents a file from a GitHub repository."""
    path: str
    name: str
    size: int
    sha: str
    download_url: Optional[str] = None


@dataclass
class GitHubRepoInfo:
    """Basic info about a GitHub repository."""
    name: str
    full_name: str
    description: Optional[str]
    default_branch: str
    language: Optional[str]
    size: int  # KB


class GitHubService:
    """Service for interacting with the GitHub REST API."""

    BASE_URL = "https://api.github.com"

    def __init__(self, token: Optional[str] = None):
        self.token = token or getattr(settings, 'github_token', None)
        self.headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            self.headers["Authorization"] = f"Bearer {self.token}"

    @staticmethod
    def parse_github_url(url: str) -> tuple[str, str]:
        """Extract owner and repo name from a GitHub URL.
        
        Supports:
          - https://github.com/owner/repo
          - https://github.com/owner/repo.git
          - https://github.com/owner/repo/tree/branch
        """
        url = url.rstrip('/')
        if url.endswith('.git'):
            url = url[:-4]

        parts = url.replace("https://github.com/", "").split("/")
        if len(parts) < 2:
            raise ValueError(f"Invalid GitHub URL: {url}")
        return parts[0], parts[1]

    async def get_repo_info(self, owner: str, repo: str) -> GitHubRepoInfo:
        """Fetch repository metadata."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/repos/{owner}/{repo}",
                headers=self.headers,
                timeout=30.0,
            )
            response.raise_for_status()
            data = response.json()

            return GitHubRepoInfo(
                name=data["name"],
                full_name=data["full_name"],
                description=data.get("description"),
                default_branch=data.get("default_branch", "main"),
                language=data.get("language"),
                size=data.get("size", 0),
            )

    async def get_repo_tree(
        self,
        owner: str,
        repo: str,
        branch: str = "main",
    ) -> List[GitHubFile]:
        """Fetch the full file tree using the Git Trees API (recursive, single call)."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/repos/{owner}/{repo}/git/trees/{branch}?recursive=1",
                headers=self.headers,
                timeout=60.0,
            )
            response.raise_for_status()
            data = response.json()

        files = []
        for item in data.get("tree", []):
            if item["type"] != "blob":
                continue

            path = item["path"]
            name = path.rsplit("/", 1)[-1]

            # Skip files in excluded directories
            path_parts = path.split("/")
            if any(part in SKIP_DIRS for part in path_parts):
                continue

            # Skip hidden files/dirs
            if any(part.startswith('.') and part not in ('.env.example',) for part in path_parts):
                continue

            # Check extension
            ext = ""
            if "." in name:
                ext = "." + name.rsplit(".", 1)[-1].lower()
            if ext not in CODE_EXTENSIONS:
                continue

            size = item.get("size", 0)
            if size > MAX_FILE_SIZE:
                continue

            files.append(GitHubFile(
                path=path,
                name=name,
                size=size,
                sha=item["sha"],
            ))

        logger.info(f"Found {len(files)} indexable files in {owner}/{repo}")
        return files

    async def get_file_content(
        self,
        owner: str,
        repo: str,
        path: str,
        branch: str = "main",
    ) -> Optional[bytes]:
        """Fetch a single file's content via the Contents API."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/repos/{owner}/{repo}/contents/{path}",
                params={"ref": branch},
                headers=self.headers,
                timeout=30.0,
            )

            if response.status_code == 404:
                return None
            response.raise_for_status()
            data = response.json()

        if data.get("encoding") == "base64" and data.get("content"):
            return base64.b64decode(data["content"])

        # Fallback: use download_url
        download_url = data.get("download_url")
        if download_url:
            async with httpx.AsyncClient() as client:
                dl_response = await client.get(download_url, timeout=30.0)
                dl_response.raise_for_status()
                return dl_response.content

        return None

    async def get_files_batch(
        self,
        owner: str,
        repo: str,
        file_paths: List[str],
        branch: str = "main",
        batch_size: int = 5,
    ) -> dict[str, bytes]:
        """Fetch multiple files with concurrency control.

        Returns a dict mapping path -> content for successfully fetched files.
        """
        import asyncio

        results: dict[str, bytes] = {}
        semaphore = asyncio.Semaphore(batch_size)

        async def fetch_one(path: str):
            async with semaphore:
                try:
                    content = await self.get_file_content(owner, repo, path, branch)
                    if content is not None:
                        results[path] = content
                except Exception as e:
                    logger.warning(f"Failed to fetch {path}: {e}")

        tasks = [fetch_one(p) for p in file_paths]
        await asyncio.gather(*tasks)
        return results
