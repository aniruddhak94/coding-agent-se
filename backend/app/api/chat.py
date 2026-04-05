import uuid
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from typing import AsyncGenerator, Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    CodeGenerateRequest,
    CodeExplainRequest,
    CodeDebugRequest,
    CodeResponse,
)
from app.services.gemini_service import get_gemini_service
from app.services.ollama_service import get_ollama_service, is_ollama_provider
from app.services.rag_service import RAGService
from app.core.database import get_db

router = APIRouter(prefix="/chat", tags=["Chat & Code Intelligence"])


async def get_rag_context(
    db: AsyncSession,
    message: str,
    repository_id: Optional[int] = None
) -> Optional[str]:
    """Fetch RAG context for a message."""
    if not repository_id:
        return None
    
    rag_service = RAGService(db)
    context_response = await rag_service.get_context_for_chat(
        query=message,
        repository_id=repository_id,
        max_chunks=5
    )
    return context_response.context if context_response.context else None


def get_ai_service(provider: str = "qwen-cloud"):
    """Get the appropriate AI service based on provider."""
    if is_ollama_provider(provider):
        return get_ollama_service(provider)
    return get_gemini_service()


@router.post("/message", response_model=ChatResponse)
async def send_message(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    """Send a message and get AI response with optional RAG context."""
    ai_service = get_ai_service(request.provider or "qwen-cloud")
    
    # Convert history to dict format
    history = None
    if request.history:
        history = [{"role": msg.role, "content": msg.content} for msg in request.history]
    
    # Get RAG context if repository is specified
    context = request.context
    context_used = False
    if request.repository_id and not context:
        context = await get_rag_context(db, request.message, request.repository_id)
    
    if context:
        context_used = True
    
    # Generate response with context
    response = await ai_service.generate_response(request.message, history, context)
    
    session_id = request.session_id or str(uuid.uuid4())
    
    return ChatResponse(message=response, session_id=session_id, context_used=context_used)


@router.post("/stream")
async def stream_message(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    """Stream AI response for a message with optional RAG context."""
    ai_service = get_ai_service(request.provider or "qwen-cloud")
    
    # Convert history to dict format
    history = None
    if request.history:
        history = [{"role": msg.role, "content": msg.content} for msg in request.history]
    
    # Get RAG context if repository is specified
    context = request.context
    if request.repository_id and not context:
        context = await get_rag_context(db, request.message, request.repository_id)
    
    async def generate() -> AsyncGenerator[str, None]:
        async for chunk in ai_service.stream_response(request.message, history, context):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.post("/generate", response_model=CodeResponse)
async def generate_code(request: CodeGenerateRequest):
    """Generate code for a specific task."""
    gemini = get_gemini_service()
    
    result = await gemini.generate_code(
        task=request.task,
        language=request.language,
        context=request.context,
    )
    
    return CodeResponse(result=result, language=request.language)


@router.post("/explain", response_model=CodeResponse)
async def explain_code(request: CodeExplainRequest):
    """Explain a piece of code."""
    gemini = get_gemini_service()
    
    result = await gemini.explain_code(
        code=request.code,
        language=request.language,
    )
    
    return CodeResponse(result=result, language=request.language)


@router.post("/debug", response_model=CodeResponse)
async def debug_code(request: CodeDebugRequest):
    """Debug code and suggest fixes."""
    gemini = get_gemini_service()
    
    result = await gemini.debug_code(
        code=request.code,
        error=request.error,
        language=request.language,
    )
    
    return CodeResponse(result=result, language=request.language)
