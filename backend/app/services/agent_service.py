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
from typing import Optional, List, Annotated, TypedDict, AsyncGenerator, Dict, Any
import json
from pathlib import Path
import difflib

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

## Available Tools (16 tools)

### Exploration Tools
- **list_files(path)** — List directory contents. Always start here.
- **read_file(path)** — Read an entire file's content.
- **read_file_lines(path, start_line, end_line)** — Read specific line range from a file. Use for large files.
- **search_code(pattern, path)** — Search for a text pattern across all files (like grep).
- **find_files(pattern)** — Find files by name pattern (like find). Supports glob patterns like "*.py" or "test_*".
- **get_git_status()** — Run `git status` to see what changed.

### Modification Tools
- **write_file(path, content)** — Create or overwrite a complete file.
- **patch_file(path, old_text, new_text)** — Targeted string replacement in a file (avoids rewriting large files).
- **append_to_file(path, content)** — Append lines to the end of a file.
- **search_and_replace(path, search, replace)** — Replace all occurrences of a string.
- **delete_file(path)** — Delete a file or directory.
- **move_file(from_path, to_path)** — Rename or relocate a file/directory.
- **make_directory(path)** — Create a directory (`mkdir -p`).

### Execution Tools
- **run_command(command)** — Run a shell command inside the container.
- **install_package(manager, packages)** — Wrapper for `npm install X` or `pip install X`.
- **run_tests(command)** — Run test suite with a 60s timeout.

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
- **No Introductory Chatter before Tools:** If you need to use a tool, output the tool call IMMEDIATELY. Do not say "Let me look at the README" and then call the tool. Just call the tool.
- **Use search_code** to find things instead of reading every file manually.
- **If a file is not in the root directory, IMMEDIATELY call find_files('filename') to locate it.**
- **Your final message MUST be text** — a comprehensive summary with no tool calls.
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

    # ── Tool 9: Patch File ──
    @tool
    async def patch_file(path: str, old_text: str, new_text: str) -> str:
        """Replace a specific block of text in a file. 'old_text' must match exactly the text to be replaced."""
        try:
            file_data = await workspace_service.read_file(workspace_id, user_id, path)
            content = file_data.get("content", "")
            if old_text not in content:
                return f"[Error: 'old_text' not found in {path}. Make sure the indentation and whitespace match exactly.]"
            if content.count(old_text) > 1:
                return f"[Error: 'old_text' appears multiple times in {path}. Please provide a larger, unique block of text to replace.]"
            
            new_content = content.replace(old_text, new_text)
            await workspace_service.write_file(workspace_id, user_id, path, new_content)
            return f"✅ Successfully patched '{path}'"
        except Exception as e:
            return f"[Error patching {path}: {e}]"

    # ── Tool 10: Append to File ──
    @tool
    async def append_to_file(path: str, content: str) -> str:
        """Append text to the end of a file. Automatically adds a newline if needed."""
        try:
            file_data = await workspace_service.read_file(workspace_id, user_id, path)
            old_content = file_data.get("content", "")
            if old_content and not old_content.endswith('\\n'):
                old_content += '\\n'
            new_content = old_content + content
            await workspace_service.write_file(workspace_id, user_id, path, new_content)
            return f"✅ Successfully appended to '{path}'"
        except Exception as e:
            return f"[Error appending to {path}: {e}]"

    # ── Tool 11: Move File ──
    @tool
    async def move_file(from_path: str, to_path: str) -> str:
        """Move or rename a file or directory."""
        return await _exec_in_container(f"mv '/workspace/{from_path}' '/workspace/{to_path}'")

    # ── Tool 12: Make Directory ──
    @tool
    async def make_directory(path: str) -> str:
        """Create a directory, including all necessary parent directories."""
        return await _exec_in_container(f"mkdir -p '/workspace/{path}'")

    # ── Tool 13: Get Git Status ──
    @tool
    async def get_git_status() -> str:
        """Get the current git status of the workspace (modified files, untracked files, etc)."""
        return await _exec_in_container("git status")

    # ── Tool 14: Install Package ──
    @tool
    async def install_package(manager: str, packages: str) -> str:
        """Install dependencies. 'manager' should be 'npm', 'pip', 'yarn', 'pnpm', or 'apt'. 'packages' is space-separated."""
        if manager not in ['npm', 'pip', 'yarn', 'pnpm', 'apt', 'apt-get']:
            return f"[Error: unsupported package manager '{manager}']"
        cmd = ""
        if manager == "npm": cmd = f"npm install {packages}"
        elif manager == "yarn": cmd = f"yarn add {packages}"
        elif manager == "pnpm": cmd = f"pnpm install {packages}"
        elif manager == "pip": cmd = f"pip install {packages}"
        elif manager in ["apt", "apt-get"]: cmd = f"apt-get update && apt-get install -y {packages}"
        return await _exec_in_container(cmd)

    # ── Tool 15: Run Tests ──
    @tool
    async def run_tests(command: str) -> str:
        """Run tests. If they hang, this will timeout after 60s."""
        return await _exec_in_container(command, timeout=60)

    # ── Tool 16: Search and Replace ──
    @tool
    async def search_and_replace(path: str, search: str, replace: str) -> str:
        """Surgical string replacement. Replaces ALL occurrences of 'search' with 'replace' in the file."""
        try:
            file_data = await workspace_service.read_file(workspace_id, user_id, path)
            content = file_data.get("content", "")
            if search not in content:
                return f"[Error: '{search}' not found in {path}]"
            new_content = content.replace(search, replace)
            await workspace_service.write_file(workspace_id, user_id, path, new_content)
            return f"✅ Successfully replaced text in '{path}'"
        except Exception as e:
            return f"[Error replacing in {path}: {e}]"

    return [
        read_file, read_file_lines, list_files, search_code, find_files, write_file, delete_file, run_command,
        patch_file, append_to_file, move_file, make_directory, get_git_status, install_package, run_tests, search_and_replace
    ]


# ── LangGraph Agent Service ──────────────────────────────────────

class AgentService:
    """LangGraph-based iterative AI agent for workspace operations."""

    MAX_ITERATIONS = 30  # Safety limit (raised from 20 — more tools = more iterations)

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
        
        # ── Ollama Models (Local & Cloud) ──
        # Provide fallback logic: if auto and token count > 1500, use qwen
        effective_provider = "qwen" if (provider == "auto" and context_size > GEMINI_TOKEN_THRESHOLD) else provider
        
        from app.services.ollama_service import is_ollama_provider, get_ollama_langchain_model
        
        if is_ollama_provider(effective_provider):
            try:
                model = get_ollama_langchain_model(effective_provider, context_size)
                return model, effective_provider
            except Exception as e:
                logger.warning(f"Ollama provider '{effective_provider}' unavailable: {e}, falling back to Gemini")

        # ── Gemini (fallback/default) ──
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
                
                # Detect stating intent without calling a tool
                is_premature_stop = (
                    ("let me read" in content_lower or
                     "i will read" in content_lower or
                     "let me check" in content_lower or
                     "i'll check" in content_lower or
                     "let me use" in content_lower or
                     "i will use" in content_lower or
                     "let me search" in content_lower or
                     "i will search" in content_lower or
                     "let me find" in content_lower or
                     "i will find" in content_lower or
                     "let me look" in content_lower or
                     "i will look" in content_lower) and
                    nudge_count < MAX_NUDGES
                )
                
                if is_premature or claims_not_found or is_premature_stop:
                    nudge_count += 1
                    logger.info(f"Nudging agent (nudge {nudge_count}/{MAX_NUDGES}): has_explored={has_explored}, claims={claims_not_found}, stop={is_premature_stop}")
                    
                    if is_premature_stop:
                        nudge_msg = "DO NOT STOP! You MUST call the tool immediately instead of just saying you will."
                    else:
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

    # ── Streaming entry ──────────────────────────────────────────

    async def stream_agent(
        self,
        workspace_id: int,
        user_id: int,
        prompt: str,
        file_paths: Optional[List[str]] = None,
        provider: str = "auto",
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Run the agent with real-time token streaming via manual loop."""

        # Create workspace-bound tools (8 tools)
        tools = create_workspace_tools(self.workspace_service, workspace_id, user_id)
        tool_map = {t.name: t for t in tools}

        # Model routing
        context_size = self._estimate_tokens(prompt)

        try:
            llm, model_name = self._get_llm(provider, context_size)
            model_with_tools = llm.bind_tools(tools)
        except Exception as e:
            logger.error(f"Failed to initialize model or bind tools: {e}", exc_info=True)
            yield {"type": "error", "message": f"Agent setup error: {str(e)}"}
            return

        yield {"type": "status", "status": "thinking", "model": model_name}

        # State
        messages = [
            SystemMessage(content=AGENT_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ]
        iteration_count = 0
        nudge_count = 0
        MAX_NUDGES = 3
        tools_used: set[str] = set()
        # ── FIX 1: Track (tool_name, key_arg) pairs to deduplicate identical calls ──
        tool_calls_made: set[tuple] = set()
        EXPLORATION_TOOLS = {"list_files", "read_file", "read_file_lines", "search_code", "find_files"}
        collected_actions: List[AgentAction] = []
        inside_think = False
        # ── FIX 2: Track last content to detect infinite repeat loops ──
        last_full_content = ""
        repeat_content_count = 0
        MAX_REPEAT_CONTENT = 2  # If the agent emits the same text twice, break the loop

        import asyncio

        try:
            while iteration_count < self.MAX_ITERATIONS:
                iteration_count += 1
                full_content = ""
                logger.info(f"Agent streaming iteration {iteration_count}/{self.MAX_ITERATIONS}")

                yield {"type": "status", "status": f"thinking (step {iteration_count})"}
                
                try:
                    response_msg = await model_with_tools.ainvoke(messages)
                except Exception as e:
                    yield {"type": "error", "message": f"LLM error: {str(e)}"}
                    break

                # Extract and clean text
                full_content = response_msg.content or ""
                if isinstance(full_content, list):
                    full_content = "".join(str(c) for c in full_content)
                full_content = _clean_think_tags(full_content)

                messages.append(response_msg)
                
                # Extract tool calls from the completed message
                parsed_tool_calls = response_msg.tool_calls or []

                # ── If tool calls, execute them but DO NOT stream text yet ──
                # This is the key fix: intermediate text (before tools) is NOT
                # streamed to the frontend. Only the FINAL text response (with
                # no tool calls) gets streamed. This prevents duplication.
                if parsed_tool_calls:
                    for tc in parsed_tool_calls:
                        tool_name = tc.get("name", "unknown")
                        tool_args = tc.get("args", {})
                        tool_id = tc.get("id") or f"call_{tool_name}_{iteration_count}"
                        tools_used.add(tool_name)

                        # Validate tool_args is a dict (some cloud models send strings)
                        if not isinstance(tool_args, dict):
                            try:
                                tool_args = json.loads(str(tool_args))
                            except (json.JSONDecodeError, TypeError):
                                tool_args = {"input": str(tool_args)}

                        yield {
                            "type": "tool_start",
                            "name": tool_name,
                            "args": tool_args,
                        }

                        # Execute the tool
                        try:
                            tool_func = tool_map.get(tool_name)
                            if tool_func:
                                result = await tool_func.ainvoke(tool_args)
                                output_str = str(result)
                            else:
                                output_str = f"[Error: Unknown tool '{tool_name}']"
                        except Exception as te:
                            output_str = f"[Tool error: {str(te)}]"

                        # Truncate long outputs
                        if len(output_str) > 2000:
                            output_str = output_str[:2000] + "... (truncated)"

                        yield {
                            "type": "tool_result",
                            "name": tool_name,
                            "output": output_str,
                        }

                        # Add tool result to conversation
                        messages.append(ToolMessage(
                            content=output_str,
                            name=tool_name,
                            tool_call_id=tool_id,
                        ))

                        # Collect modification actions to trigger editor refreshes
                        # Include old and newly added tools
                        if tool_name in ("write_file", "patch_file", "append_to_file", "search_and_replace", "delete_file", "move_file", "make_directory", "run_command"):
                            action_type = {
                                "write_file": "file_edit",
                                "patch_file": "file_edit",
                                "append_to_file": "file_edit",
                                "search_and_replace": "file_edit",
                                "delete_file": "file_delete",
                                "move_file": "file_edit",
                                "make_directory": "file_create",
                                "run_command": "run_command",
                            }[tool_name]
                            
                            # Handle different path argument names (e.g. from_path for move_file)
                            action_path = None
                            if isinstance(tool_args, dict):
                                action_path = tool_args.get("path") or tool_args.get("to_path") or tool_args.get("from_path")
                                
                            collected_actions.append(AgentAction(
                                type=action_type,
                                path=action_path,
                                content=tool_args.get("content") if isinstance(tool_args, dict) else None,
                                command=tool_args.get("command") if isinstance(tool_args, dict) else None,
                                description=f"{tool_name}: {action_path or tool_args.get('command', '') if isinstance(tool_args, dict) else ''}"
                            ))

                    # Continue to next iteration (agent sees tool results)
                    continue

                # ── Evaluate Nudges ONLY if no tools were called ──
                content_lower = full_content.lower()
                has_explored = bool(tools_used & EXPLORATION_TOOLS)
                has_used_any_tool = bool(tools_used)

                # Only nudge if agent used NO tools at all AND gave a suspiciously short answer
                is_premature_stop = (
                    not has_used_any_tool and
                    not has_explored and 
                    nudge_count < MAX_NUDGES and 
                    iteration_count < self.MAX_ITERATIONS - 1
                    and len(full_content.strip()) < 300
                )
                
                # Are they promising to do something but outputting raw text instead of a tool call?
                promises_action = (
                    any(phrase in content_lower for phrase in [
                        "let me read", "i will read", "let me search", 
                        "i will search", "let me check", "i'll run", "let me find", "i will find"
                    ]) and nudge_count < MAX_NUDGES
                )

                if is_premature_stop or promises_action:
                    nudge_count += 1
                    nudge_msg = (
                        "SYSTEM: You stated an intent to check/read something but did not actually output a tool call. "
                        "You MUST output a valid JSON tool call right now. Do not write introductory text."
                    )
                    messages.append(HumanMessage(content=nudge_msg))
                    yield {"type": "status", "status": "nudging"}
                    continue

                # ── No tool calls, No nudges: this is the FINAL text response ──
                # NOW stream the text to the frontend (only once, no duplicates)
                if full_content:
                    # Dedup check: if model repeats itself or paraphrases, break
                    is_duplicate = False
                    if last_full_content:
                        similarity = difflib.SequenceMatcher(None, full_content, last_full_content).ratio()
                        if similarity > 0.85:
                            is_duplicate = True
                            
                    if is_duplicate:
                        repeat_content_count += 1
                        if repeat_content_count >= MAX_REPEAT_CONTENT:
                            logger.warning(f"Agent repeating similar text (similarity). Breaking loop.")
                            break
                    else:
                        last_full_content = full_content
                        repeat_content_count = 0
                        words = full_content.split(" ")
                        for word in words:
                            yield {"type": "token", "content": word + " "}
                            await asyncio.sleep(0.01)

                # ── Agent finished (no tool calls, no nudge) ──
                break

            # If the agent didn't produce a proper text summary, force one more call
            if not last_full_content.strip():
                try:
                    logger.info("Agent didn't produce summary in stream — forcing summary call")
                    summary_messages = messages + [
                        HumanMessage(content="Now provide a clear, well-formatted markdown summary of everything you found and did. Do NOT call any tools, just respond with text.")
                    ]
                    
                    yield {"type": "status", "status": "synthesizing", "model": model_name}
                    
                    inside_summary_think = False
                    
                    async for chunk in llm.astream(summary_messages):
                        if chunk.content:
                            text = chunk.content
                            if isinstance(text, list):
                                text = "".join(str(t) for t in text)
                            
                            if "<think>" in text:
                                inside_summary_think = True
                                text = text.split("<think>")[0]
                            if "</think>" in text:
                                inside_summary_think = False
                                text = text.split("</think>", 1)[-1]
                                
                            if not inside_summary_think and text:
                                yield {"type": "token", "content": text}
                                
                except Exception as e:
                    logger.warning(f"Summary streaming call failed: {e}")

            # Stream complete
            yield {
                "type": "done",
                "model_used": model_name,
                "context_tokens_approx": context_size,
                "actions": [a.model_dump() for a in collected_actions],
            }

        except Exception as e:
            error_str = str(e)
            logger.error(f"Agent streaming error: {e}", exc_info=True)

            if "402" in error_str or "Payment Required" in error_str or "depleted" in error_str.lower():
                yield {"type": "error", "message": "HuggingFace API credits depleted. Switch to Gemini or Qwen."}
            else:
                yield {"type": "error", "message": f"Agent error: {error_str}"}

    def _build_response(self, state: AgentState, model_name: str, context_size: int) -> AgentResponse:
        """Extract final response and actions from the agent state."""
        messages = state["messages"]
        explanation = ""
        actions = []
        steps = []

        for msg in messages:
            if isinstance(msg, AIMessage) and msg.tool_calls:
                for tc in msg.tool_calls:
                    steps.append(f"🔧 {tc['name']}({', '.join(f'{k}={repr(v)[:40]}' for k, v in tc['args'].items())})")

        if steps:
            logger.info(f"Agent took {len(steps)} tool steps: {steps}")

        for msg in reversed(messages):
            if isinstance(msg, AIMessage):
                content = _clean_think_tags(msg.content) if msg.content else ""
                if content and not msg.tool_calls:
                    explanation = content
                    break

        if not explanation:
            for msg in reversed(messages):
                if isinstance(msg, AIMessage) and msg.content:
                    content = _clean_think_tags(msg.content)
                    if content:
                        explanation = content
                        break

        if not explanation:
            tool_summaries = []
            for msg in messages:
                if isinstance(msg, ToolMessage) and msg.content:
                    tool_summaries.append(msg.content[:500])
            if tool_summaries:
                explanation = "Here's what I found:\n\n" + "\n\n".join(tool_summaries)

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