"""Pydantic schemas for the AI Agent system."""
from pydantic import BaseModel, Field
from typing import Optional, List, Literal


class AgentRequest(BaseModel):
    """Request body for POST /agent/act."""
    workspace_id: int
    prompt: str = Field(..., min_length=1, max_length=4000)
    file_paths: Optional[List[str]] = Field(
        default=None,
        description="Specific file paths to include as context. If None, agent auto-discovers key files."
    )
    provider: Optional[Literal[
        "auto", "gemini", "qwen", "qwen-cloud", "gemma4",
        "hf-qwen-7b", "hf-qwen-35b",
        "hf-llama-8b", "hf-llama-70b",
        "gpt-oss-cloud", "kimi-cloud", "minimax-cloud"
    ]] = Field(
        default="auto",
        description="Model selection: auto, gemini, qwen, qwen-cloud, gemma4, or hf-* HuggingFace models."
    )


class AgentAction(BaseModel):
    """A single proposed action the agent wants to take."""
    type: Literal["file_edit", "file_create", "file_delete", "run_command"]
    path: Optional[str] = Field(default=None, description="File path (for file actions)")
    content: Optional[str] = Field(default=None, description="New file content (for file_edit/create)")
    command: Optional[str] = Field(default=None, description="Shell command (for run_command)")
    description: str = Field(..., description="Human-readable description of this action")


class AgentResponse(BaseModel):
    """Response from POST /agent/act — proposed actions for user review."""
    explanation: str = Field(..., description="AI explanation of the proposed changes")
    actions: List[AgentAction]
    model_used: str = Field(..., description="Which model was used: gemini or qwen")
    context_tokens_approx: int = Field(default=0, description="Approximate token count of context sent")


class AgentApplyRequest(BaseModel):
    """Request body for POST /agent/apply — user-approved actions."""
    workspace_id: int
    actions: List[AgentAction]


class AgentApplyResult(BaseModel):
    """Result of a single applied action."""
    action: AgentAction
    success: bool
    output: Optional[str] = None
    error: Optional[str] = None


class AgentApplyResponse(BaseModel):
    """Response from POST /agent/apply."""
    results: List[AgentApplyResult]
    all_succeeded: bool
