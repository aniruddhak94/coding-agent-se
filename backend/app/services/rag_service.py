"""RAG service for semantic search and context retrieval."""
import logging
from typing import Optional, List
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.file import File, FileChunk, Repository
from app.schemas.file import ChunkResponse, SearchResult, ContextResponse
from app.core.config import get_settings

try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
    QDRANT_AVAILABLE = True
except ImportError:
    QDRANT_AVAILABLE = False

try:
    from google import genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False

settings = get_settings()
logger = logging.getLogger(__name__)

# Embedding dimension for Gemini gemini-embedding-001
EMBEDDING_DIMENSION = 3072


@dataclass
class ChunkWithScore:
    """Chunk with relevance score from vector search."""
    chunk: FileChunk
    score: float
    file_path: str
    file_name: str


class RAGService:
    """Service for RAG-based semantic search and context retrieval."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._qdrant_client: Optional[QdrantClient] = None
        self._genai_client = None
        self._initialize_clients()

    def _initialize_clients(self):
        """Initialize Qdrant and Gemini clients."""
        # Initialize Qdrant
        if QDRANT_AVAILABLE:
            try:
                self._qdrant_client = QdrantClient(
                    host=settings.qdrant_host,
                    port=settings.qdrant_port
                )
                self._ensure_collection()
                logger.info("Qdrant client initialized successfully")
            except Exception as e:
                logger.warning(f"Qdrant initialization failed: {e}. Using fallback search.")
                self._qdrant_client = None
        
        # Initialize Gemini for embeddings
        if GENAI_AVAILABLE and settings.gemini_api_key:
            try:
                self._genai_client = genai.Client(api_key=settings.gemini_api_key)
                logger.info("Gemini embedding client initialized")
            except Exception as e:
                logger.warning(f"Gemini initialization failed: {e}")

    def _ensure_collection(self):
        """Ensure Qdrant collection exists."""
        if not self._qdrant_client:
            return
        
        collections = self._qdrant_client.get_collections().collections
        collection_names = [c.name for c in collections]
        
        if settings.qdrant_collection not in collection_names:
            self._qdrant_client.create_collection(
                collection_name=settings.qdrant_collection,
                vectors_config=VectorParams(
                    size=EMBEDDING_DIMENSION,
                    distance=Distance.COSINE
                )
            )
            logger.info(f"Created Qdrant collection: {settings.qdrant_collection}")

    async def generate_embedding(self, text: str) -> Optional[List[float]]:
        """Generate embedding for text using Gemini."""
        if not GENAI_AVAILABLE or not self._genai_client:
            logger.warning("Gemini not available for embeddings")
            return None
        
        try:
            result = self._genai_client.models.embed_content(
                model="models/gemini-embedding-001",
                contents=text,
                config={"task_type": "RETRIEVAL_DOCUMENT"},
            )
            return result.embeddings[0].values
        except Exception as e:
            logger.error(f"Embedding generation failed: {e}")
            return None

    async def generate_query_embedding(self, query: str) -> Optional[List[float]]:
        """Generate embedding for search query."""
        if not GENAI_AVAILABLE or not self._genai_client:
            return None
        
        try:
            result = self._genai_client.models.embed_content(
                model="models/gemini-embedding-001",
                contents=query,
                config={"task_type": "RETRIEVAL_QUERY"},
            )
            return result.embeddings[0].values
        except Exception as e:
            logger.error(f"Query embedding generation failed: {e}")
            return None

    def chunk_code(self, content: str, chunk_size: int = 50, overlap: int = 10) -> List[dict]:
        """Split code into overlapping chunks by lines."""
        lines = content.split('\n')
        chunks = []
        
        i = 0
        while i < len(lines):
            end = min(i + chunk_size, len(lines))
            chunk_lines = lines[i:end]
            chunk_content = '\n'.join(chunk_lines)
            
            if chunk_content.strip():  # Skip empty chunks
                chunks.append({
                    'content': chunk_content,
                    'start_line': i + 1,  # 1-indexed
                    'end_line': end
                })
            
            i += chunk_size - overlap
            if i >= len(lines):
                break
        
        return chunks

    async def index_file(self, file: File, content: str) -> int:
        """Index a file's content into vector database."""
        chunks = self.chunk_code(content)
        indexed_count = 0
        
        for chunk_data in chunks:
            # Create chunk record
            chunk = FileChunk(
                file_id=file.id,
                content=chunk_data['content'],
                start_line=chunk_data['start_line'],
                end_line=chunk_data['end_line']
            )
            self.db.add(chunk)
            await self.db.flush()
            
            # Generate embedding and store in Qdrant
            embedding = await self.generate_embedding(chunk_data['content'])
            
            if embedding and self._qdrant_client:
                point_id = f"chunk_{chunk.id}"
                self._qdrant_client.upsert(
                    collection_name=settings.qdrant_collection,
                    points=[
                        PointStruct(
                            id=chunk.id,
                            vector=embedding,
                            payload={
                                "chunk_id": chunk.id,
                                "file_id": file.id,
                                "file_path": file.path,
                                "file_name": file.name,
                                "repository_id": file.repository_id,
                                "start_line": chunk_data['start_line'],
                                "end_line": chunk_data['end_line']
                            }
                        )
                    ]
                )
                chunk.embedding_id = point_id
            
            indexed_count += 1
        
        await self.db.commit()
        return indexed_count

    async def search(
        self,
        query: str,
        top_k: int = 5,
        repository_id: Optional[int] = None,
        owner_id: Optional[int] = None
    ) -> List[ChunkWithScore]:
        """Perform semantic search across indexed code."""
        # Generate query embedding
        query_embedding = await self.generate_query_embedding(query)
        
        if not query_embedding or not self._qdrant_client:
            # Fallback to keyword search
            return await self._keyword_search(query, top_k, repository_id, owner_id)
        
        # Build filter if repository specified
        search_filter = None
        if repository_id:
            search_filter = Filter(
                must=[
                    FieldCondition(
                        key="repository_id",
                        match=MatchValue(value=repository_id)
                    )
                ]
            )
        
        # Search Qdrant
        results = self._qdrant_client.search(
            collection_name=settings.qdrant_collection,
            query_vector=query_embedding,
            limit=top_k,
            query_filter=search_filter
        )
        
        # Fetch chunks from database
        chunks_with_scores = []
        for result in results:
            chunk_id = result.payload.get("chunk_id")
            chunk_result = await self.db.execute(
                select(FileChunk).where(FileChunk.id == chunk_id)
            )
            chunk = chunk_result.scalar_one_or_none()
            
            if chunk:
                chunks_with_scores.append(
                    ChunkWithScore(
                        chunk=chunk,
                        score=result.score,
                        file_path=result.payload.get("file_path", ""),
                        file_name=result.payload.get("file_name", "")
                    )
                )
        
        return chunks_with_scores

    async def _keyword_search(
        self,
        query: str,
        top_k: int,
        repository_id: Optional[int],
        owner_id: Optional[int]
    ) -> List[ChunkWithScore]:
        """Fallback keyword-based search."""
        sql_query = select(FileChunk, File).join(File)
        
        if repository_id:
            sql_query = sql_query.where(File.repository_id == repository_id)
        if owner_id:
            sql_query = sql_query.where(File.owner_id == owner_id)
        
        # Simple LIKE search
        sql_query = sql_query.where(FileChunk.content.ilike(f"%{query}%"))
        sql_query = sql_query.limit(top_k)
        
        result = await self.db.execute(sql_query)
        rows = result.all()
        
        return [
            ChunkWithScore(
                chunk=row[0],
                score=1.0,  # No real score for keyword search
                file_path=row[1].path,
                file_name=row[1].name
            )
            for row in rows
        ]

    async def get_context_for_chat(
        self,
        query: str,
        repository_id: Optional[int] = None,
        max_chunks: int = 5,
        owner_id: Optional[int] = None
    ) -> ContextResponse:
        """Get relevant context for chat based on query."""
        chunks_with_scores = await self.search(query, max_chunks, repository_id, owner_id)
        
        # Build context string
        context_parts = []
        chunk_responses = []
        
        for cws in chunks_with_scores:
            context_parts.append(
                f"File: {cws.file_path} (lines {cws.chunk.start_line}-{cws.chunk.end_line})\n"
                f"```\n{cws.chunk.content}\n```"
            )
            chunk_responses.append(
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
            )
        
        # Get repository name if specified
        repo_name = None
        if repository_id:
            repo_result = await self.db.execute(
                select(Repository).where(Repository.id == repository_id)
            )
            repo = repo_result.scalar_one_or_none()
            if repo:
                repo_name = repo.name
        
        return ContextResponse(
            context="\n\n".join(context_parts) if context_parts else "",
            chunks=chunk_responses,
            repository_name=repo_name
        )
