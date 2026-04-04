from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.chat import router as chat_router
from app.api.files import router as files_router
from app.api.repository import router as repo_router
from app.api.execution import router as execution_router
from app.api.workspace import router as workspace_router
from app.api.terminal import router as terminal_router
from app.api.agent import router as agent_router
api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(chat_router)
api_router.include_router(files_router)
api_router.include_router(repo_router)
api_router.include_router(execution_router)
api_router.include_router(workspace_router)
api_router.include_router(terminal_router)
api_router.include_router(agent_router)
