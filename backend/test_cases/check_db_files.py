import asyncio
import sys

sys.path.append(r"c:\Users\Abhas\OneDrive\Desktop\coding\coding_Agent\coding-agent\backend")

from app.core.database import async_session_maker
from app.models.file import File, Repository
from sqlalchemy import select

async def check_files():
    async with async_session_maker() as session:
        # Get all repos
        repos_result = await session.execute(select(Repository))
        repos = repos_result.scalars().all()
        
        for repo in repos:
            print(f"Repo ID: {repo.id}, Name: {repo.name}")
            
            # Get files for repo
            file_result = await session.execute(
                select(File).where(File.repository_id == repo.id)
            )
            files = list(file_result.scalars().all())
            print(f" -> DB has {len(files)} files for this repo.")

if __name__ == "__main__":
    asyncio.run(check_files())
