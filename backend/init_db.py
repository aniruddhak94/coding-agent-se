"""Initialize the database tables."""
import asyncio
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

async def init_db():
    from sqlalchemy.ext.asyncio import create_async_engine
    from app.core.config import get_settings
    from app.core.database import Base
    
    # Import models to register them with Base
    from app.models.user import User
    from app.models.file import Repository, File, FileChunk
    from app.models.activity_log import ActivityLog
    
    settings = get_settings()
    engine = create_async_engine(settings.database_url, echo=True)
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    print("Database tables created successfully!")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(init_db())
