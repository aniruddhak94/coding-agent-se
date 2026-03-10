import sys
import asyncio
import logging
import warnings

# Suppress all warnings and SQLAlchemy noise
warnings.filterwarnings("ignore")
logging.getLogger("sqlalchemy").setLevel(logging.ERROR)
logging.getLogger("qdrant_client").setLevel(logging.ERROR)

sys.path.append(r"c:\Users\Abhas\OneDrive\Desktop\coding\coding_Agent\coding-agent\backend")

from app.core.database import async_session_maker
from app.services.rag_service import RAGService
from app.models.file import FileChunk
from sqlalchemy import select, func

async def diagnose():
    async with async_session_maker() as session:
        # 1. Check chunk count
        result = await session.execute(select(func.count()).select_from(FileChunk))
        chunk_count = result.scalar()
        print(f"1. FileChunk records in DB: {chunk_count}")
        
        # 2. Check Qdrant + Genai clients
        rag = RAGService(session)
        print(f"2. Qdrant client initialized: {rag._qdrant_client is not None}")
        print(f"3. Genai client initialized: {rag._genai_client is not None}")
        
        # 3. Test embedding
        try:
            embedding = await rag.generate_embedding("test snippet")
            if embedding:
                print(f"4. Embedding OK, dim={len(embedding)}")
            else:
                print("4. ERROR: Embedding returned None")
        except Exception as e:
            print(f"4. ERROR generating embedding: {e}")
        
        # 4. Check Qdrant
        try:
            from app.core.config import get_settings
            settings = get_settings()
            count = rag._qdrant_client.count(settings.qdrant_collection)
            print(f"5. Qdrant '{settings.qdrant_collection}' points: {count.count}")
        except Exception as e:
            print(f"5. ERROR checking Qdrant: {e}")

if __name__ == "__main__":
    asyncio.run(diagnose())
