"""API routes for the AI Agent system."""
import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.agent import (
    AgentRequest,
    AgentResponse,
    AgentApplyRequest,
    AgentApplyResponse,
)
from app.services.agent_service import AgentService
from app.services.log_service import LogService, AGENT_RUN

router = APIRouter(prefix="/agent", tags=["AI Agent"])


@router.post("/act", response_model=AgentResponse)
async def agent_act(
    request: AgentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Plan AI actions for a workspace (blocking — waits for full response).
    Kept for backward compatibility.
    """
    agent = AgentService(db)
    response = await agent.plan_actions(
        workspace_id=request.workspace_id,
        user_id=current_user.id,
        prompt=request.prompt,
        file_paths=request.file_paths,
        provider=request.provider or "auto",
    )
    return response


@router.post("/stream")
async def agent_stream(
    request: AgentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Stream AI agent responses in real-time via SSE.
    
    Yields events:
      - {"type": "status", "status": "thinking", "model": "gemini"}
      - {"type": "token", "content": "..."}
      - {"type": "tool_start", "name": "list_files", "args": {...}}
      - {"type": "tool_result", "name": "list_files", "output": "..."}
      - {"type": "done", "model_used": "gemini", "actions": [...]}
      - {"type": "error", "message": "..."}
    """
    agent = AgentService(db)

    # Log agent run (fire-and-forget style — don't block the stream)
    await LogService(db).log(
        action=AGENT_RUN,
        user_id=current_user.id,
        metadata={"workspace_id": request.workspace_id, "prompt_len": len(request.prompt or "")},
    )

    async def event_generator():
        async for event in agent.stream_agent(
            workspace_id=request.workspace_id,
            user_id=current_user.id,
            prompt=request.prompt,
            file_paths=request.file_paths,
            provider=request.provider or "auto",
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/apply", response_model=AgentApplyResponse)
async def agent_apply(
    request: AgentApplyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Apply user-approved AI actions to a workspace.
    Only actions the user explicitly accepted should be sent here.
    """
    agent = AgentService(db)
    results = await agent.apply_actions(
        workspace_id=request.workspace_id,
        user_id=current_user.id,
        actions=request.actions,
    )
    return AgentApplyResponse(
        results=results,
        all_succeeded=all(r.success for r in results),
    )
