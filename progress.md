# Intelligent Coding Agent (ICA) — Progress Tracker

> Last updated: 2026-03-18

---

## Phased Delivery Plan — Status

| Phase | Name | Status | Details |
|-------|------|--------|---------|
| **Phase 1** | Foundation — Auth, User roles, Basic chat UI, Basic AI chat | ✅ Completed | JWT auth, login/register, role-based access, FastAPI + Next.js |
| **Phase 2** | Code Intelligence — Code generation, Explanation, Debugging, Markdown rendering | ✅ Completed | Gemini + Qwen AI, syntax-highlighted code blocks, multi-turn chat |
| **Phase 3** | File & RAG — File uploads, Repo indexing, Context-aware answers | ✅ Completed | GitHub import, Qdrant vector DB, RAG pipeline, file tree/code viewer |
| **Phase 4.0** | Snippet Runner (lightweight) | ✅ Completed | Quick code execution via Docker, `/execute` page, ▶ Run button in chat |
| **Phase 4A** | Sandbox Workspace — Container per project | ✅ Completed | Workspace model, WorkspaceService with Docker lifecycle + file API, 11 REST endpoints, Open Workspace button |
| **Phase 4B** | Web Code Editor — Monaco/VS Code in browser | ✅ Completed | Monaco editor, multi-tab editing, file tree, create/edit/save/delete |
| **Phase 4C** | Terminal & Commands — Shell inside sandbox | ✅ Completed | WebSocket terminal via Docker exec, xterm.js UI, toggle panel |
| **Phase 4D** | AI Agent in Sandbox — AI reads/writes/runs in workspace | ✅ Completed | Smart Qwen/Gemini routing, structured JSON actions, accept/reject flow, workspace chat panel | 
| **Phase 4E** | Live Preview — See the app running | ✅ Completed | Host proxying, companion container, iframe preview, start/stop dev server |
| **Phase 5** | Admin Panel — User management, Logs & monitoring, System settings | ❌ Not Started | User CRUD, system logs, config dashboard |

## Additional Features
| Phase | Name | Status | Details |
|-------|------|--------|---------|
| **Automation** | Task definitions, Workflow execution, Scheduling | ❌ Not Started | Multi-step tasks, background execution, cron triggers |

---

## Current Position: 🎯 Phase 5 — Admin Panel

---

## Phase 4 Sub-phases (Bolt/Lovable-style Workspace)

### Phase 4.0 — Snippet Runner ✅ (already built)
- Run isolated code snippets in Docker (Python, JS, C++, Java)
- `/execute` page with editor, output panels, history
- ▶ Run button on code blocks in chat
- AI error diagnostics

### Phase 4A — Sandbox Workspace Foundation 🔶
- **Docker container per project** — persistent workspace from an imported repo
- **File system API** — list, read, write, create, delete files inside the container
- **Workspace lifecycle** — create, start, stop, destroy workspaces
- **Mount imported repo** into the container with read/write access

### Phase 4B — Web Code Editor
- **Monaco Editor** integration (VS Code in browser)
- **File tree** connected to the sandbox filesystem
- **Multi-tab editing** with syntax highlighting
- **Save** changes back to the sandbox container
- **Create/rename/delete** files and folders

### Phase 4C — Terminal & Command Execution
- **WebSocket-based terminal** connected to the sandbox shell
- **Run commands** — `npm install`, `pip install`, `build`, `test`, etc.
- **Live streaming output** via WebSocket
- **Process management** — start/stop/restart processes

### Phase 4D — AI Agent in Sandbox
- **AI reads workspace files** — understands the full project
- **AI writes/modifies files** — generates code changes directly
- **AI runs commands** — install deps, build, test
- **Accept/reject/edit flow** — user reviews AI changes before applying
- **Context-aware from RAG + live files**

### Phase 4E — Live Preview ✅
- **Port proxying** from sandbox container to host via Alpine companion
- **iframe preview** of the running app in the Workspace UI
- **Redis state management** for preview lifecycle
- **Dev server management** — start/stop the app inside sandbox (e.g. npm start)

---

## Completed Work Summary

### Phase 1 — Foundation ✅
- User registration, login, logout
- JWT-based authentication with token expiration & refresh
- Role-based access control (USER / ADMIN)
- Basic chat UI with Next.js + TailwindCSS
- FastAPI backend with REST APIs

### Phase 2 — Code Intelligence ✅
- AI-powered code generation (Gemini + Qwen models)
- Code explanation & debugging
- Markdown rendering with syntax-highlighted code blocks
- Multi-turn conversational context

### Phase 3 — File & RAG ✅
- File upload support
- GitHub repository import with real-time progress bar
- RAG pipeline: chunking → Gemini embeddings → Qdrant vector DB → top-K retrieval
- Context-aware AI answers using retrieved code chunks
- File tree browsing, code viewer, and context panel components
- Re-indexing support

### Phase 4.0 — Snippet Runner ✅
- Docker sandbox execution (Python, JS, C++, Java)
- `/execute` page with code editor, output panels, history sidebar
- ▶ Run button on chat code blocks with inline results
- AI error diagnostics via Gemini
- Resource limits (10s timeout, 256MB memory, 50% CPU)
