"""Repository API endpoints."""
import logging
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, status, Query, BackgroundTasks
from sqlalchemy import select, func, delete as sql_delete

from app.api.deps import DbSession, CurrentUser
from app.models.file import Repository, File, FileChunk
from app.services.file_service import FileService
from app.services.rag_service import RAGService
from app.services.github_service import GitHubService
from app.services.progress import update_progress, get_progress, clear_progress
from app.services.log_service import LogService, REPO_CREATED
from app.schemas.file import (
    RepositoryCreate,
    RepositoryImport,
    RepositoryResponse,
    RepositoryListResponse,
    SearchQuery,
    SearchResult,
    ContextRequest,
    ContextResponse,
    ChunkResponse,
    FileListResponse,
    FileResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/repo", tags=["repository"])


async def _count_repo_files(db, repo_id: int) -> int:
    """Count files in a repository."""
    result = await db.execute(
        select(func.count(File.id)).where(File.repository_id == repo_id)
    )
    return result.scalar_one()


@router.post("", response_model=RepositoryResponse)
async def create_repository(
    repo: RepositoryCreate,
    db: DbSession,
    current_user: CurrentUser
):
    """Create a new repository."""
    new_repo = Repository(
        name=repo.name,
        url=repo.url,
        description=repo.description,
        owner_id=current_user.id
    )
    
    db.add(new_repo)
    await db.commit()
    await db.refresh(new_repo)

    await LogService(db).log(action=REPO_CREATED, user_id=current_user.id, metadata={"repo_id": new_repo.id, "name": new_repo.name})

    response = RepositoryResponse.model_validate(new_repo)
    response.file_count = 0
    return response


@router.post("/import", response_model=RepositoryResponse)
async def import_github_repository(
    repo_import: RepositoryImport,
    background_tasks: BackgroundTasks,
    db: DbSession,
    current_user: CurrentUser
):
    """Import a GitHub repository using the GitHub REST API."""
    github = GitHubService()

    # Parse owner/repo from URL
    try:
        owner, repo_name = github.parse_github_url(repo_import.url)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    # Fetch repo info from GitHub for description
    try:
        repo_info = await github.get_repo_info(owner, repo_name)
        description = repo_info.description or f"Imported from {repo_import.url}"
        branch = repo_import.branch or repo_info.default_branch
    except Exception as e:
        logger.warning(f"Could not fetch repo info: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not access GitHub repository. It may be private or invalid. Error: {e}"
        )

    # Create repository record
    new_repo = Repository(
        name=repo_name,
        url=repo_import.url,
        description=description,
        owner_id=current_user.id
    )

    db.add(new_repo)
    await db.commit()
    await db.refresh(new_repo)

    await LogService(db).log(action=REPO_CREATED, user_id=current_user.id, metadata={"repo_id": new_repo.id, "name": repo_name, "source": "github"})

    # Fetch and index files in background
    async def fetch_and_index(repo_id: int, gh_owner: str, gh_repo: str, gh_branch: str, owner_id: int):
        from app.core.database import async_session_maker

        try:
            gh = GitHubService()

            # 1. Get the full file tree (single API call)
            update_progress(repo_id, status="fetching_tree", message="Fetching repository structure...")
            file_list = await gh.get_repo_tree(gh_owner, gh_repo, gh_branch)
            total_files = len(file_list)
            logger.info(f"Fetching {total_files} files from {gh_owner}/{gh_repo}")

            # 2. Fetch file contents in batches
            file_paths = [f.path for f in file_list]
            update_progress(repo_id, status="fetching_files", total=total_files, message=f"Downloading {total_files} files...")
            contents = await gh.get_files_batch(gh_owner, gh_repo, file_paths, gh_branch, batch_size=5)

            # 3. Store and index each file
            async with async_session_maker() as session:
                file_service = FileService(session)
                rag_service = RAGService(session)
                indexed_count = 0

                for i, gh_file in enumerate(file_list):
                    update_progress(
                        repo_id, 
                        status="indexing", 
                        current=i + 1, 
                        total=total_files, 
                        message=f"Indexing {gh_file.name}..."
                    )
                    content = contents.get(gh_file.path)
                    if content is None:
                        continue

                    try:
                        stored_file = await file_service.upload_file(
                            file_content=content,
                            filename=gh_file.name,
                            owner_id=owner_id,
                            repository_id=repo_id,
                            original_path=gh_file.path
                        )

                        # Index for RAG if it's a code file
                        if stored_file.language:
                            try:
                                await rag_service.index_file(
                                    stored_file,
                                    content.decode('utf-8', errors='ignore')
                                )
                                indexed_count += 1
                            except Exception as e:
                                logger.warning(f"RAG indexing failed for {gh_file.path}: {e}")
                    except Exception as e:
                        logger.warning(f"Failed to process {gh_file.path}: {e}")

                # Update indexed timestamp
                result = await session.execute(
                    select(Repository).where(Repository.id == repo_id)
                )
                repo = result.scalar_one_or_none()
                if repo:
                    repo.indexed_at = datetime.now()
                    await session.commit()

                update_progress(repo_id, status="complete", total=total_files, current=total_files, message=f"Imported {indexed_count} files successfully!")
                logger.info(f"Import complete: {indexed_count} files indexed for {gh_owner}/{gh_repo}")

        except Exception as e:
            update_progress(repo_id, status="error", message=f"Import failed: {str(e)}")
            logger.error(f"Import failed for {gh_owner}/{gh_repo}: {e}")

    # Start background task
    update_progress(new_repo.id, status="starting", message="Initializing import...")
    background_tasks.add_task(
        fetch_and_index,
        new_repo.id,
        owner,
        repo_name,
        branch,
        current_user.id
    )

    response = RepositoryResponse.model_validate(new_repo)
    response.file_count = 0
    return response


@router.get("/import/progress/{repo_id}")
async def get_import_progress(
    repo_id: int,
    db: DbSession,
    current_user: CurrentUser
):
    """Get real-time import progress for a repository."""
    # Verify ownership
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.owner_id == current_user.id
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found"
        )

    progress = get_progress(repo_id)
    if not progress:
        # If no active import, check if repo is fully indexed
        if repo.indexed_at:
            return {"status": "complete", "percent": 100, "message": "Repository is fully indexed"}
        return {"status": "idle", "percent": 0, "message": "No active import"}

    return progress


@router.get("", response_model=RepositoryListResponse)
async def list_repositories(
    db: DbSession,
    current_user: CurrentUser,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=50)
):
    """List repositories owned by the current user."""
    query = select(Repository).where(Repository.owner_id == current_user.id)
    query = query.order_by(Repository.created_at.desc()).offset(offset).limit(limit)
    
    count_query = select(func.count(Repository.id)).where(Repository.owner_id == current_user.id)
    
    result = await db.execute(query)
    count_result = await db.execute(count_query)
    
    repos = list(result.scalars().all())
    total = count_result.scalar_one()
    
    # Get file counts
    responses = []
    for repo in repos:
        response = RepositoryResponse.model_validate(repo)
        response.file_count = await _count_repo_files(db, repo.id)
        responses.append(response)
    
    return RepositoryListResponse(repositories=responses, total=total)


@router.get("/{repo_id}", response_model=RepositoryResponse)
async def get_repository(
    repo_id: int,
    db: DbSession,
    current_user: CurrentUser
):
    """Get repository by ID."""
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.owner_id == current_user.id
        )
    )
    repo = result.scalar_one_or_none()
    
    if not repo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found"
        )
    
    response = RepositoryResponse.model_validate(repo)
    response.file_count = await _count_repo_files(db, repo.id)
    return response


@router.get("/{repo_id}/files", response_model=FileListResponse)
async def list_repository_files(
    repo_id: int,
    db: DbSession,
    current_user: CurrentUser,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100)
):
    """List files in a repository."""
    # Verify repo ownership
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.owner_id == current_user.id
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found"
        )
    
    file_service = FileService(db)
    files, total = await file_service.list_files(
        owner_id=current_user.id,
        repository_id=repo_id,
        offset=offset,
        limit=limit
    )
    
    return FileListResponse(
        files=[FileResponse.model_validate(f) for f in files],
        total=total
    )


@router.get("/{repo_id}/file")
async def get_repository_file(
    repo_id: int,
    file_path: str,
    db: DbSession,
    current_user: CurrentUser
):
    """Get single file content from a repository by path."""
    # Verify repo ownership
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.owner_id == current_user.id
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found"
        )
    
    # Get file by path
    file_result = await db.execute(
        select(File).where(
            File.repository_id == repo_id,
            File.path == file_path
        )
    )
    file = file_result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found in repository"
        )
        
    file_service = FileService(db)
    content = await file_service.get_file_content(file)
    
    if content is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File content not found on disk"
        )
        
    try:
        text_content = content.decode('utf-8', errors='replace')
        return {"content": text_content}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not decode file content: {e}"
        )


@router.post("/{repo_id}/search", response_model=SearchResult)
async def search_repository(
    repo_id: int,
    search: SearchQuery,
    db: DbSession,
    current_user: CurrentUser
):
    """Perform semantic search within a repository."""
    # Verify repo ownership
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.owner_id == current_user.id
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found"
        )
    
    rag_service = RAGService(db)
    chunks_with_scores = await rag_service.search(
        query=search.query,
        top_k=search.top_k,
        repository_id=repo_id,
        owner_id=current_user.id
    )
    
    chunk_responses = [
        ChunkResponse(
            id=cws.chunk.id,
            file_id=cws.chunk.file_id,
            content=cws.chunk.content,
            start_line=cws.chunk.start_line,
            end_line=cws.chunk.end_line,
            file_path=cws.file_path,
            file_name=cws.file_name,
            relevance_score=cws.score
        )
        for cws in chunks_with_scores
    ]
    
    return SearchResult(
        chunks=chunk_responses,
        query=search.query,
        total_results=len(chunk_responses)
    )


@router.post("/{repo_id}/context", response_model=ContextResponse)
async def get_repository_context(
    repo_id: int,
    request: ContextRequest,
    db: DbSession,
    current_user: CurrentUser
):
    """Get RAG context for chat from repository."""
    # Verify repo ownership
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.owner_id == current_user.id
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found"
        )
    
    rag_service = RAGService(db)
    context = await rag_service.get_context_for_chat(
        query=request.query,
        repository_id=repo_id,
        max_chunks=request.max_chunks,
        owner_id=current_user.id
    )
    
    return context


@router.post("/{repo_id}/reindex")
async def reindex_repository(
    repo_id: int,
    background_tasks: BackgroundTasks,
    db: DbSession,
    current_user: CurrentUser
):
    """Re-index all files in a repository for RAG."""
    # Verify repo ownership
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.owner_id == current_user.id
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found"
        )

    async def do_reindex(repo_id: int, owner_id: int):
        from app.core.database import async_session_maker

        async with async_session_maker() as session:
            try:
                # 1. Get all files for this repo
                file_result = await session.execute(
                    select(File).where(File.repository_id == repo_id)
                )
                files = list(file_result.scalars().all())

                # 2. Delete existing chunks for these files
                file_ids = [f.id for f in files]
                if file_ids:
                    await session.execute(
                        sql_delete(FileChunk).where(FileChunk.file_id.in_(file_ids))
                    )
                    await session.commit()

                # 3. Re-index each file
                file_service = FileService(session)
                rag_service = RAGService(session)
                indexed_count = 0

                for file in files:
                    content = await file_service.get_file_content(file)
                    if content and file.language:
                        try:
                            await rag_service.index_file(
                                file,
                                content.decode('utf-8', errors='ignore')
                            )
                            indexed_count += 1
                        except Exception as e:
                            logger.warning(f"Re-index failed for {file.path}: {e}")

                # 4. Update indexed timestamp
                repo_result = await session.execute(
                    select(Repository).where(Repository.id == repo_id)
                )
                repo = repo_result.scalar_one_or_none()
                if repo:
                    repo.indexed_at = datetime.now()
                    await session.commit()

                logger.info(f"Re-indexed {indexed_count} files for repo {repo_id}")
            except Exception as e:
                logger.error(f"Re-index failed for repo {repo_id}: {e}")

    background_tasks.add_task(do_reindex, repo_id, current_user.id)
    return {"message": "Re-indexing started", "repo_id": repo_id}


@router.delete("/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_repository(
    repo_id: int,
    db: DbSession,
    current_user: CurrentUser
):
    """Delete a repository and all its files."""
    result = await db.execute(
        select(Repository).where(
            Repository.id == repo_id,
            Repository.owner_id == current_user.id
        )
    )
    repo = result.scalar_one_or_none()
    
    if not repo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found"
        )
    
    # Delete repository (cascades to files and chunks)
    await db.delete(repo)
    await db.commit()
