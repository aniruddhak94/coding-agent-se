import sys
import asyncio

sys.path.append(r"c:\Users\Abhas\OneDrive\Desktop\coding\coding_Agent\coding-agent\backend")

from app.core.database import async_session_maker
from app.services.rag_service import RAGService
from app.services.file_service import FileService
from app.models.file import File, FileChunk, Repository
from sqlalchemy import select, delete as sql_delete

async def reindex_all():
    async with async_session_maker() as session:
        file_service = FileService(session)
        rag_service = RAGService(session)
        
        # Get all repos to reindex
        repos_result = await session.execute(select(Repository))
        repos = repos_result.scalars().all()
        
        for repo in repos:
            print(f"Re-indexing repo: {repo.name}")
            
            # 1. Get all files for this repo
            file_result = await session.execute(
                select(File).where(File.repository_id == repo.id)
            )
            files = list(file_result.scalars().all())
            print(f"Found {len(files)} files.")

            # 2. Delete existing chunks for these files
            file_ids = [f.id for f in files]
            if file_ids:
                await session.execute(
                    sql_delete(FileChunk).where(FileChunk.file_id.in_(file_ids))
                )
                await session.commit()
                
            # 3. Re-index each file
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
                        print(f" - Indexed {file.name}")
                    except Exception as e:
                        print(f"Re-index failed for {file.path}: {e}")

            print(f"Completed repo {repo.name}: {indexed_count} files indexed.")

if __name__ == "__main__":
    asyncio.run(reindex_all())
