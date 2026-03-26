"""
AI Agent service — LangGraph-based iterative coding agent.

Mirrors the Antigravity agent architecture:
  - 8 workspace tools (read, write, list, delete, search, find, run, read_lines)
  - ToolNode from langgraph.prebuilt for automatic tool execution
  - Smart model routing: Qwen 3.5 for large context, Gemini for short tasks
  - Forced summary if the model stops without one
  - Step-by-step tool usage tracking for the frontend
"""
import re
import subprocess
import logging
import os
from typing import Optional, List, Annotated, TypedDict
from pathlib import Path

from dotenv import load_dotenv

# Load .env from backend directory
_backend_dir = Path(__file__).parent.parent.parent
load_dotenv(dotenv_path=_backend_dir / ".env", override=True)

from sqlalchemy.ext.asyncio import AsyncSession

from langchain_core.tools import tool
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from app.services.workspace_service import WorkspaceService
from app.schemas.agent import AgentAction, AgentResponse, AgentApplyResult

logger = logging.getLogger(__name__)

# ── Token threshold for model routing ────────────────────────────
GEMINI_TOKEN_THRESHOLD = 1500

# ── Agent System Prompt ──────────────────────────────────────────
AGENT_SYSTEM_PROMPT = """You are ICA (Intelligent Coding Agent), a powerful AI coding assistant embedded inside the user's sandbox workspace. You are pair programming with the user to help them understand, modify, debug, and build their codebase.

## Identity & Communication Style
- You are proactive, thorough, and precise. You explore the codebase deeply before answering or making changes.
- Format responses in clean markdown: use **bold** for emphasis, `backticks` for file/function names, and bullet points for lists.
- Be concise but comprehensive. Acknowledge what you found, explain your reasoning, and summarize actions taken.
- If you're unsure, say so — never guess about the codebase structure.

## Available Tools (8 tools)

### Exploration Tools
- **list_files(path)** — List directory contents. Always start here.
- **read_file(path)** — Read an entire file's content.
- **read_file_lines(path, start_line, end_line)** — Read specific line range from a file. Use for large files.
- **search_code(pattern, path)** — Search for a text pattern across all files (like grep). Returns matching lines with file paths and line numbers.
- **find_files(pattern)** — Find files by name pattern (like find). Supports glob patterns like "*.py" or "test_*".

### Modification Tools
- **write_file(path, content)** — Create or overwrite a file. Always provide COMPLETE file content.
- **delete_file(path)** — Delete a file or directory.
- **run_command(command)** — Run a shell command inside the container.

## Agentic Workflow — Think Step by Step

You MUST follow this chain of thought for every request:

### For Questions (e.g. "tell me about this repo", "what does X do?"):
1. **EXPLORE** — Call `list_files(".")` to see the project root structure.
2. **READ KEY FILES** — Read `README.md`, `package.json`, `requirements.txt`, config files, or main entry points.
3. **DIVE DEEPER** — List subdirectories and read relevant source files.
4. **SEARCH** — Use `search_code` to find specific patterns, function definitions, or imports.
5. **SYNTHESIZE** — Give a thorough, well-structured answer referencing specific files and code.

### For Code Changes (e.g. "add a feature", "fix this bug"):
1. **EXPLORE** — Understand the project structure first.
2. **SEARCH** — Use `search_code` to find related code, definitions, and usage patterns.
3. **READ** — Read the files you'll need to modify and their dependencies.
4. **IMPLEMENT** — Use `write_file` with COMPLETE file contents.
5. **VERIFY** — Use `run_command` to run tests, lint, or build.
6. **SUMMARIZE** — Explain what you changed and why.

### For Commands (e.g. "install X", "run tests"):
1. **RUN** — Execute with `run_command`.
2. **REPORT** — Share the output and explain the result.

## Critical Rules
- **ALWAYS explore first.** Never make assumptions about file structure.
- **Use MULTIPLE tool calls** across multiple turns. Iterate like a real developer.
- **Use search_code** to find things instead of reading every file manually.
- **Your final message MUST be text** — a comprehensive summary with no tool calls.
- **Complete files only** when using `write_file`.
- **Do NOT use `<think>` tags.** Respond directly."""


# ── Helpers ──────────────────────────────────────────────────────
def _clean_think_tags(text: str) -> str:
    """Remove Qwen's <think>...</think> wrapper from responses."""
    if not text:
        return text
    cleaned = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()
    return cleaned if cleaned else text


# ── LangGraph State ──────────────────────────────────────────────
class AgentState(TypedDict):
    messages: Annotated[list, add_messages]


# ── Workspace Tool Factory ───────────────────────────────────────

def _get_container_id(workspace_service, workspace_id, user_id):
    """Helper to get container_id for direct docker exec calls."""
    import asyncio
    async def _get():
        ws = await workspace_service.get_workspace(workspace_id, user_id)
        return ws.container_id if ws else None
    return _get()


def create_workspace_tools(workspace_service: WorkspaceService, workspace_id: int, user_id: int):
    """Create 8 tool functions bound to a specific workspace — mirrors Antigravity's toolset."""

    # ── Helper: run a command in the container ──
    async def _exec_in_container(command: str, timeout: int = 60) -> str:
        """Execute a command inside the workspace container."""
        workspace = await workspace_service.get_workspace(workspace_id, user_id)
        if not workspace or not workspace.container_id:
            return "[Error: workspace not running]"
        proc = subprocess.run(
            ["docker", "exec", workspace.container_id, "/bin/bash", "-c", command],
            capture_output=True, text=True, timeout=timeout,
        )
        output = proc.stdout
        if proc.stderr:
            output += f"\nSTDERR:\n{proc.stderr}"
        if proc.returncode != 0:
            output += f"\n[Exit code: {proc.returncode}]"
        return output.strip() or "(no output)"

    # ── Tool 1: Read File ──
    @tool
    async def read_file(path: str) -> str:
        """Read an entire file from the workspace. Returns the file content with line numbers."""
        try:
            file_data = await workspace_service.read_file(workspace_id, user_id, path)
            content = file_data.get("content", "")
            if len(content) > 30_000:
                return f"[File too large: {len(content)} chars. Use read_file_lines for specific sections.]\nFirst 3000 chars:\n{content[:3000]}\n..."
            # Add line numbers for easier reference
            lines = content.split('\n')
            numbered = '\n'.join(f"{i+1}: {line}" for i, line in enumerate(lines))
            return f"File: {path} ({len(lines)} lines)\n{numbered}"
        except Exception as e:
            return f"[Error reading {path}: {e}]"

    # ── Tool 2: Read File Lines (specific range) ──
    @tool
    async def read_file_lines(path: str, start_line: int, end_line: int) -> str:
        """Read specific lines from a file. Useful for large files. Lines are 1-indexed."""
        try:
            file_data = await workspace_service.read_file(workspace_id, user_id, path)
            content = file_data.get("content", "")
            lines = content.split('\n')
            start = max(0, start_line - 1)
            end = min(len(lines), end_line)
            selected = lines[start:end]
            numbered = '\n'.join(f"{start + i + 1}: {line}" for i, line in enumerate(selected))
            return f"File: {path} (lines {start_line}-{end_line} of {len(lines)})\n{numbered}"
        except Exception as e:
            return f"[Error reading {path}: {e}]"

    # ── Tool 3: List Files ──
    @tool
    async def list_files(path: str = ".") -> str:
        """List files and directories at the given path. Returns a tree-like listing."""
        try:
            entries = await workspace_service.list_files(workspace_id, user_id, path)
            if not entries:
                return f"[Empty directory: {path}]"
            dirs = [e for e in entries if e["type"] == "dir"]
            files = [e for e in entries if e["type"] == "file"]
            lines = []
            for d in dirs:
                lines.append(f"  📁 {d['name']}/")
            for f in files:
                size = f.get('size', '?')
                lines.append(f"  📄 {f['name']} ({size} bytes)")
            return f"Contents of '{path}' ({len(dirs)} dirs, {len(files)} files):\n" + "\n".join(lines)
        except Exception as e:
            return f"[Error listing {path}: {e}]"

    # ── Tool 4: Search Code (grep-like) ──
    @tool
    async def search_code(pattern: str, path: str = ".") -> str:
        """Search for a text pattern across all files in the workspace (like grep -rn).
        Returns matching lines with file paths and line numbers. Use this to find 
        function definitions, imports, variable usage, etc."""
        try:
            # Use grep -rn for recursive search with line numbers
            cmd = f"grep -rn --include='*.py' --include='*.js' --include='*.ts' --include='*.tsx' --include='*.jsx' --include='*.java' --include='*.go' --include='*.rs' --include='*.c' --include='*.cpp' --include='*.h' --include='*.html' --include='*.css' --include='*.json' --include='*.yaml' --include='*.yml' --include='*.md' --include='*.txt' --include='*.sh' --include='*.sql' --include='*.rb' --include='*.php' -l 50 '{pattern}' /workspace/{path} 2>/dev/null | head -50"
            result = await _exec_in_container(cmd)
            if not result or result == "(no output)":
                return f"No matches found for '{pattern}' in '{path}'"
            matches = result.strip().split('\n')
            # Clean up /workspace/ prefix for readability
            cleaned = []
            for m in matches[:50]:
                cleaned.append(m.replace('/workspace/', ''))
            return f"Search results for '{pattern}' ({len(cleaned)} matches):\n" + "\n".join(cleaned)
        except Exception as e:
            return f"[Search error: {e}]"

    # ── Tool 5: Find Files (find-like) ──
    @tool
    async def find_files(pattern: str) -> str:
        """Find files by name pattern (like find). Supports glob patterns like '*.py', 'test_*', 'README*'.
        Use this to locate specific files in the project."""
        try:
            cmd = f"find /workspace -name '{pattern}' -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/__pycache__/*' -not -path '*/.next/*' 2>/dev/null | head -30"
            result = await _exec_in_container(cmd)
            if not result or result == "(no output)":
                return f"No files found matching '{pattern}'"
            files = result.strip().split('\n')
            cleaned = [f.replace('/workspace/', '') for f in files]
            return f"Files matching '{pattern}' ({len(cleaned)} found):\n" + "\n".join(f"  📄 {f}" for f in cleaned)
        except Exception as e:
            return f"[Find error: {e}]"

    # ── Tool 6: Write File ──
    @tool
    async def write_file(path: str, content: str) -> str:
        """Write content to a file in the workspace. Creates or overwrites. Always provide COMPLETE file content."""
        try:
            await workspace_service.write_file(workspace_id, user_id, path, content)
            lines = content.count('\n') + 1
            return f"✅ Successfully wrote '{path}' ({lines} lines, {len(content)} bytes)"
        except Exception as e:
            return f"[Error writing {path}: {e}]"

    # ── Tool 7: Delete File ──
    @tool
    async def delete_file(path: str) -> str:
        """Delete a file or directory from the workspace."""
        try:
            await workspace_service.delete_file(workspace_id, user_id, path)
            return f"✅ Deleted '{path}'"
        except Exception as e:
            return f"[Error deleting {path}: {e}]"

    # ── Tool 8: Run Command ──
    @tool
    async def run_command(command: str) -> str:
        """Run a shell command inside the workspace container. Returns stdout/stderr.
        Use for: installing packages, running tests, checking versions, building, etc."""
        try:
            return await _exec_in_container(command)
        except subprocess.TimeoutExpired:
            return "[Command timed out after 60s]"
        except Exception as e:
            return f"[Error: {e}]"

    return [read_file, read_file_lines, list_files, search_code, find_files, write_file, delete_file, run_command]


# ── LangGraph Agent Service ──────────────────────────────────────

class AgentService:
    """LangGraph-based iterative AI agent for workspace operations."""

    MAX_ITERATIONS = 20  # Safety limit (raised from 15 — more tools = more iterations)

    def __init__(self, db: AsyncSession):
        self.db = db
        self.workspace_service = WorkspaceService(db)

    def _estimate_tokens(self, text: str) -> int:
        return len(text) // 4

    def _get_llm(self, provider: str = "auto", context_size: int = 0):
        """Get the appropriate LangChain LLM based on provider selection."""
        
        # ── HuggingFace models (via Inference API) ───────────────────────────────
        HF_MODELS = {
            "hf-qwen-7b": (
                "Qwen/Qwen2.5-7B-Instruct",
                "Qwen 2.5 7B Instruct",
            ),
            "hf-qwen-35b": (
                "Qwen/Qwen3.5-35B-A3B",
                "Qwen 3.5 35B",
            ),
            "hf-llama-8b": (
                "meta-llama/Llama-3.1-8B-Instruct",
                "Llama 3.1 8B Instruct",
            ),
            "hf-llama-70b": (
                "meta-llama/Llama-3.1-70B-Instruct",
                "Llama 3.1 70B Instruct",
            ),
        }
        
        if provider in HF_MODELS:
            model_id, display_name = HF_MODELS[provider]
            try:
                from langchain_huggingface import ChatHuggingFace, HuggingFaceEndpoint
                from app.core.config import get_settings
                settings = get_settings()
                
                logger.info(f"Agent using {display_name} via HuggingFace (context ~{context_size} tokens)")
                llm = HuggingFaceEndpoint(
                    repo_id=model_id,
                    huggingfacehub_api_token=settings.hf_api_token,
                    temperature=0.1,
                    max_new_tokens=8192,
                    task="text-generation",
                )
                return ChatHuggingFace(llm=llm), provider
            except Exception as e:
                logger.error(f"HuggingFace {display_name} failed: {e}")
                raise RuntimeError(f"HuggingFace {display_name} unavailable: {e}")
        
        # ── Qwen (Ollama — local) ──
        use_qwen = (
            provider == "qwen" or
            (provider == "auto" and context_size > GEMINI_TOKEN_THRESHOLD)
        )

        if use_qwen:
            try:
                from langchain_ollama import ChatOllama
                logger.info(f"Agent using Qwen 3.5 (context ~{context_size} tokens)")
                return ChatOllama(
                    model="qwen3.5:9b",
                    temperature=0,
                    base_url="http://localhost:11434",
                ), "qwen"
            except Exception as e:
                logger.warning(f"Qwen unavailable: {e}, falling back to Gemini")

        # ── Gemini (fallback) ──
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            api_key = os.getenv("GEMINI_API_KEY", "")
            logger.info(f"Agent using Gemini (context ~{context_size} tokens)")
            return ChatGoogleGenerativeAI(
                model="gemini-2.0-flash",
                google_api_key=api_key,
                temperature=0,
                max_output_tokens=8192,
            ), "gemini"
        except Exception as e:
            logger.error(f"Gemini unavailable: {e}")
            raise RuntimeError("No LLM available")

    # ── Main entry ───────────────────────────────────────────────

    async def plan_actions(
        self,
        workspace_id: int,
        user_id: int,
        prompt: str,
        file_paths: Optional[List[str]] = None,
        provider: str = "auto",
    ) -> AgentResponse:
        """Run the LangGraph agent and return results."""

        # Create workspace-bound tools (8 tools)
        tools = create_workspace_tools(self.workspace_service, workspace_id, user_id)

        # Model routing
        context_size = self._estimate_tokens(prompt)
        
        try:
            llm, model_name = self._get_llm(provider, context_size)
            
            # Bind tools to model
            model_with_tools = llm.bind_tools(tools)
        except Exception as e:
            logger.error(f"Failed to initialize model or bind tools: {e}", exc_info=True)
            return AgentResponse(
                explanation=f"Agent setup error: {str(e)}",
                actions=[],
                model_used=provider,
                context_tokens_approx=context_size,
            )

        # Build graph
        tool_node = ToolNode(tools)
        iteration_count = 0
        nudge_count = 0
        MAX_NUDGES = 3  # Max times we force the agent to keep exploring
        tools_used: set[str] = set()  # Track which tools the agent has called
        EXPLORATION_TOOLS = {"list_files", "read_file", "read_file_lines", "search_code", "find_files"}

        async def call_model(state: AgentState):
            nonlocal iteration_count, nudge_count
            iteration_count += 1
            
            # Safety: force end if too many iterations
            if iteration_count > self.MAX_ITERATIONS:
                logger.warning(f"Agent hit max iterations ({self.MAX_ITERATIONS})")
                return {"messages": [AIMessage(content="I've reached my iteration limit. Here's what I found so far based on my exploration.")]}
            
            response = await model_with_tools.ainvoke(state["messages"])
            
            # Clean Qwen think tags
            if response.content:
                response.content = _clean_think_tags(response.content)
            
            # Track tool calls
            if response.tool_calls:
                for tc in response.tool_calls:
                    tools_used.add(tc["name"])
            
            tc = len(response.tool_calls) if response.tool_calls else 0
            logger.info(f"Agent step {iteration_count}: content={bool(response.content)}, tool_calls={tc}, tools_used={tools_used}")
            
            # ── Nudge logic: if the agent tries to conclude without exploring ──
            if response.content and not response.tool_calls:
                has_explored = bool(tools_used & EXPLORATION_TOOLS)
                content_lower = response.content.lower()
                
                # Detect premature conclusions
                is_premature = (
                    not has_explored and
                    nudge_count < MAX_NUDGES and
                    iteration_count < self.MAX_ITERATIONS - 2
                )
                # Also detect "file not found" claims without searching
                claims_not_found = (
                    ("does not exist" in content_lower or
                     "not found" in content_lower or
                     "couldn't find" in content_lower or
                     "could not find" in content_lower or
                     "no such file" in content_lower) and
                    "search_code" not in tools_used and
                    "find_files" not in tools_used and
                    "list_files" not in tools_used and
                    nudge_count < MAX_NUDGES
                )
                
                if is_premature or claims_not_found:
                    nudge_count += 1
                    logger.info(f"Nudging agent (nudge {nudge_count}/{MAX_NUDGES}): has_explored={has_explored}, claims_not_found={claims_not_found}")
                    
                    nudge_msg = (
                        "STOP — you have NOT explored the workspace yet. "
                        "You MUST call `list_files('.')` first to see the project structure, "
                        "then use `search_code` or `find_files` to locate the relevant file. "
                        "Do NOT claim a file doesn't exist without searching for it. "
                        "Explore the workspace now."
                    )
                    
                    # Return the agent's response + a nudge to keep going
                    return {"messages": [
                        response,
                        HumanMessage(content=nudge_msg),
                    ]}
                
                logger.info(f"Agent final answer: {response.content[:200]}")
            
            return {"messages": [response]}

        def should_continue(state: AgentState):
            last_message = state["messages"][-1]
            # If the last message is a HumanMessage (nudge), route back to agent
            if isinstance(last_message, HumanMessage):
                return "agent"
            if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
                return "tools"
            return END

        # Build the graph
        workflow = StateGraph(AgentState)
        workflow.add_node("agent", call_model)
        workflow.add_node("tools", tool_node)
        workflow.set_entry_point("agent")
        workflow.add_conditional_edges("agent", should_continue, {"tools": "tools", "agent": "agent", END: END})
        workflow.add_edge("tools", "agent")

        app = workflow.compile()

        # Run
        initial_state = {
            "messages": [
                SystemMessage(content=AGENT_SYSTEM_PROMPT),
                HumanMessage(content=prompt),
            ],
        }

        try:
            final_state = await app.ainvoke(initial_state)
        except Exception as e:
            error_str = str(e)
            logger.error(f"LangGraph agent error: {e}", exc_info=True)
            
            # Detect HuggingFace payment / quota errors
            if "402" in error_str or "Payment Required" in error_str or "depleted" in error_str.lower():
                explanation = (
                    "⚠️ **HuggingFace API credits depleted**\n\n"
                    "Your monthly HuggingFace Inference API credits have run out.\n\n"
                    "**Options:**\n"
                    "- Switch to **Gemini** or **Qwen** (local) using the model selector above\n"
                    "- Purchase more HuggingFace credits at [huggingface.co](https://huggingface.co/settings/billing)\n"
                    "- Subscribe to HuggingFace PRO for 20x more usage"
                )
            else:
                explanation = f"⚠️ **Agent error:** {error_str}"
            
            return AgentResponse(
                explanation=explanation,
                actions=[],
                model_used=model_name,
                context_tokens_approx=context_size,
            )

        # Extract response
        response = self._build_response(final_state, model_name, context_size)
        
        # If the agent didn't produce a proper text summary, force one more call
        if not response.explanation or response.explanation.startswith("Here's what I found:"):
            try:
                logger.info("Agent didn't produce summary — forcing summary call")
                summary_messages = final_state["messages"] + [
                    HumanMessage(content="Now provide a clear, well-formatted markdown summary of everything you found and did. Do NOT call any tools, just respond with text.")
                ]
                summary_response = await llm.ainvoke(summary_messages)
                if summary_response.content:
                    summary_text = _clean_think_tags(summary_response.content)
                    if summary_text:
                        response.explanation = summary_text
            except Exception as e:
                logger.warning(f"Summary call failed: {e}")
        
        return response

    def _build_response(self, state: AgentState, model_name: str, context_size: int) -> AgentResponse:
        """Extract final response and actions from the agent state."""
        messages = state["messages"]
        explanation = ""
        actions = []
        steps = []  # Track tool usage steps for transparency

        # Collect steps taken (for logging)
        for msg in messages:
            if isinstance(msg, AIMessage) and msg.tool_calls:
                for tc in msg.tool_calls:
                    steps.append(f"🔧 {tc['name']}({', '.join(f'{k}={repr(v)[:40]}' for k, v in tc['args'].items())})")

        if steps:
            logger.info(f"Agent took {len(steps)} tool steps: {steps}")

        # Find the final AI response (last AI message without tool calls)
        for msg in reversed(messages):
            if isinstance(msg, AIMessage):
                content = _clean_think_tags(msg.content) if msg.content else ""
                if content and not msg.tool_calls:
                    explanation = content
                    break

        # Fallback: any AI message with content
        if not explanation:
            for msg in reversed(messages):
                if isinstance(msg, AIMessage) and msg.content:
                    content = _clean_think_tags(msg.content)
                    if content:
                        explanation = content
                        break

        # Fallback: build from tool results
        if not explanation:
            tool_summaries = []
            for msg in messages:
                if isinstance(msg, ToolMessage) and msg.content:
                    tool_summaries.append(msg.content[:500])
            if tool_summaries:
                explanation = "Here's what I found:\n\n" + "\n\n".join(tool_summaries)

        # Extract modification actions from tool calls
        for msg in messages:
            if isinstance(msg, AIMessage) and msg.tool_calls:
                for tc in msg.tool_calls:
                    name = tc["name"]
                    args = tc["args"]
                    if name in ("write_file", "delete_file", "run_command"):
                        action_type = {
                            "write_file": "file_edit",
                            "delete_file": "file_delete",
                            "run_command": "run_command",
                        }[name]
                        actions.append(AgentAction(
                            type=action_type,
                            path=args.get("path"),
                            content=args.get("content"),
                            command=args.get("command"),
                            description=f"{name}: {args.get('path') or args.get('command', '')}"
                        ))

        return AgentResponse(
            explanation=explanation or "Agent completed.",
            actions=actions,
            model_used=model_name,
            context_tokens_approx=context_size,
        )

    # ── Action Application ───────────────────────────────────────

    async def apply_actions(
        self,
        workspace_id: int,
        user_id: int,
        actions: List[AgentAction],
    ) -> List[AgentApplyResult]:
        """Apply approved actions to the workspace."""
        workspace = await self.workspace_service.get_workspace(workspace_id, user_id)
        if not workspace or workspace.status != "running":
            return [AgentApplyResult(action=a, success=False, error="Workspace not running") for a in actions]

        results = []
        for action in actions:
            result = await self._apply_single(workspace, action, user_id)
            results.append(result)
        return results

    async def _apply_single(self, workspace, action: AgentAction, user_id: int) -> AgentApplyResult:
        """Apply a single action."""
        try:
            if action.type in ("file_edit", "file_create") and action.path and action.content is not None:
                await self.workspace_service.write_file(workspace.id, user_id, action.path, action.content)
                return AgentApplyResult(action=action, success=True, output=f"Updated {action.path}")

            elif action.type == "file_delete" and action.path:
                await self.workspace_service.delete_file(workspace.id, user_id, action.path)
                return AgentApplyResult(action=action, success=True, output=f"Deleted {action.path}")

            elif action.type == "run_command" and action.command:
                workspace_obj = await self.workspace_service.get_workspace(workspace.id, user_id)
                if workspace_obj and workspace_obj.container_id:
                    proc = subprocess.run(
                        ["docker", "exec", workspace_obj.container_id, "/bin/bash", "-c", action.command],
                        capture_output=True, text=True, timeout=60,
                    )
                    output = (proc.stdout + proc.stderr).strip() or "(no output)"
                    return AgentApplyResult(action=action, success=True, output=output)
                return AgentApplyResult(action=action, success=False, error="No container")

            else:
                return AgentApplyResult(action=action, success=False, error=f"Invalid action: {action.type}")

        except Exception as e:
            logger.error(f"Failed to apply action {action.type}: {e}")
            return AgentApplyResult(action=action, success=False, error=str(e))
