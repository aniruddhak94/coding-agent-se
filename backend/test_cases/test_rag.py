import asyncio
import os
import sys

# Add backend to Python path
sys.path.append(r"c:\Users\Abhas\OneDrive\Desktop\coding\coding_Agent\coding-agent\backend")

from app.core.database import async_session_maker
from app.services.rag_service import RAGService

async def test_rag():
    async with async_session_maker() as db:
        rag_service = RAGService(db)
        
        # Test 1: Generate Embedding
        print("Testing Document Embedding...")
        emb = await rag_service.generate_embedding("This is a test document.")
        if emb:
            print(f"Embedding successful: len={len(emb)}")
        else:
            print("Embedding failed!")

        # Test 2: Search with Repository ID
        print("\nTesting Search (repo_id=1, query='tell me about this repo')...")
        context_resp = await rag_service.get_context_for_chat("tell me about this repo", repository_id=1)
        print(f"Repository Name: {context_resp.repository_name}")
        print(f"Found {len(context_resp.chunks)} chunks.")
        for chunk in context_resp.chunks:
            print(f" - [{chunk.relevance_score:.4f}] {chunk.file_name} (lines {chunk.start_line}-{chunk.end_line})")
        
        print("\nContext Preview:")
        print(context_resp.context[:400])

if __name__ == "__main__":
    asyncio.run(test_rag())
