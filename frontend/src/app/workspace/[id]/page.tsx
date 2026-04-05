'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient, WorkspaceResponse, FileNode } from '@/lib/api';
import { FileExplorer } from '@/components/workspace/FileExplorer';
import { EditorTabs, EditorTab } from '@/components/workspace/EditorTabs';
import { CodeEditor } from '@/components/workspace/CodeEditor';
import { WorkspaceTerminal } from '@/components/workspace/Terminal';
import { WorkspaceChat } from '@/components/workspace/WorkspaceChat';
import { 
    Play, 
    Square, 
    Trash2, 
    Loader2, 
    FolderGit2, 
    AlertCircle,
    ArrowLeft,
    Terminal as TerminalIcon,
    PanelBottomClose,
    PanelBottomOpen,
    Check,
    RefreshCw,
    Sparkles,
    PanelRightClose,
    PanelRightOpen
} from 'lucide-react';

interface OpenFile {
    path: string;
    content: string;
    originalContent: string;
    language?: string;
}

export default function WorkspacePage() {
    const params = useParams();
    const router = useRouter();
    const id = parseInt(params.id as string);

    // Workspace state
    const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
    const [status, setStatus] = useState<string>('loading');
    const [error, setError] = useState<string | null>(null);

    // File system state
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [isLoadingFiles, setIsLoadingFiles] = useState(false);

    // Editor state
    const [openFiles, setOpenFiles] = useState<Record<string, OpenFile>>({});
    const [activePath, setActivePath] = useState<string | null>(null);

    const [showTerminal, setShowTerminal] = useState(false);

    // AI panel state
    const [showAI, setShowAI] = useState(false);

    // Save toast state
    const [showSaveToast, setShowSaveToast] = useState(false);

    // Terminal resize state
    const [terminalHeight, setTerminalHeight] = useState(256); // default ~16rem
    const isDraggingRef = useRef(false);
    const dragStartYRef = useRef(0);
    const dragStartHeightRef = useRef(0);

    // AI panel horizontal resize state
    const [aiPanelWidth, setAiPanelWidth] = useState(320); // default w-80 = 320px
    const isAiDraggingRef = useRef(false);
    const aiDragStartXRef = useRef(0);
    const aiDragStartWidthRef = useRef(0);

    // Drag-to-resize handlers
    const handleDragStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isDraggingRef.current = true;
        dragStartYRef.current = e.clientY;
        dragStartHeightRef.current = terminalHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';

        const handleMouseMove = (ev: MouseEvent) => {
            if (!isDraggingRef.current) return;
            const delta = dragStartYRef.current - ev.clientY;
            const newHeight = Math.min(Math.max(dragStartHeightRef.current + delta, 120), 600);
            setTerminalHeight(newHeight);
        };

        const handleMouseUp = () => {
            isDraggingRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, [terminalHeight]);

    // AI panel horizontal drag-to-resize handlers
    const handleAiDragStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isAiDraggingRef.current = true;
        aiDragStartXRef.current = e.clientX;
        aiDragStartWidthRef.current = aiPanelWidth;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';

        const handleMouseMove = (ev: MouseEvent) => {
            if (!isAiDraggingRef.current) return;
            // Dragging left = increase width, dragging right = decrease width
            const delta = aiDragStartXRef.current - ev.clientX;
            const newWidth = Math.min(Math.max(aiDragStartWidthRef.current + delta, 260), 600);
            setAiPanelWidth(newWidth);
        };

        const handleMouseUp = () => {
            isAiDraggingRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, [aiPanelWidth]);


    // --- Data Fetching ---

    // Use a ref for status to avoid re-creating callbacks when status changes
    const statusRef = React.useRef(status);
    statusRef.current = status;

    const fetchWorkspace = useCallback(async (silent = false) => {
        try {
            if (!silent) setStatus('loading');
            const data = await apiClient.getWorkspace(id);
            setWorkspace(data);
            setStatus(data.status);
            return data;
        } catch (err: any) {
            setError(err.detail || 'Failed to load workspace');
            setStatus('error');
            return null;
        }
    }, [id]);

    const fetchFiles = useCallback(async (path: string = '.') => {
        // Use ref instead of state to avoid dependency changes
        if (statusRef.current !== 'running') return [];
        setIsLoadingFiles(true);
        try {
            const data = await apiClient.listWorkspaceFiles(id, path);
            if (path === '.') {
                setFileTree(data.entries);
            }
            return data.entries;
        } catch (err: any) {
            console.error('Failed to load files:', err);
            return [];
        } finally {
            setIsLoadingFiles(false);
        }
    }, [id]); // removed `status` dependency — uses ref now

    // Fetch children for tree expansion
    const fetchChildren = useCallback(async (path: string): Promise<FileNode[]> => {
        try {
            const data = await apiClient.listWorkspaceFiles(id, path);
            return data.entries;
        } catch (err: any) {
            console.error('Failed to fetch children:', err);
            return [];
        }
    }, [id]);

    // Initial load & status polling — stable effect that only runs once per `id`
    useEffect(() => {
        if (isNaN(id)) {
            setError('Invalid workspace ID');
            setStatus('error');
            return;
        }

        let isMounted = true;
        let pollInterval: NodeJS.Timeout;

        const init = async () => {
            try {
                const data = await apiClient.getWorkspace(id);
                if (!isMounted) return;
                setWorkspace(data);
                setStatus(data.status);

                if (['creating', 'starting'].includes(data.status)) {
                    pollInterval = setInterval(async () => {
                        try {
                            const latest = await apiClient.getWorkspace(id);
                            if (!isMounted) return;
                            setWorkspace(latest);
                            setStatus(latest.status);
                            if (!['creating', 'starting'].includes(latest.status)) {
                                clearInterval(pollInterval);
                                if (latest.status === 'running') {
                                    // Inline the fetch to avoid stale closures
                                    const files = await apiClient.listWorkspaceFiles(id, '.');
                                    if (isMounted) setFileTree(files.entries);
                                }
                            }
                        } catch (err) {
                            // Silently ignore poll errors
                        }
                    }, 3000);
                } else if (data.status === 'running') {
                    const files = await apiClient.listWorkspaceFiles(id, '.');
                    if (isMounted) setFileTree(files.entries);
                }
            } catch (err: any) {
                if (isMounted) {
                    setError(err.detail || 'Failed to load workspace');
                    setStatus('error');
                }
            }
        };

        init();

        return () => {
            isMounted = false;
            if (pollInterval) clearInterval(pollInterval);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    // --- Workspace Actions ---

    const handleAction = async (action: 'start' | 'stop' | 'destroy') => {
        setStatus('loading');
        try {
            if (action === 'start') {
                const ws = await apiClient.startWorkspace(id);
                setWorkspace(ws);
                setStatus('running');
                fetchFiles('.');
            } else if (action === 'stop') {
                const ws = await apiClient.stopWorkspace(id);
                setWorkspace(ws);
                setStatus('stopped');
                setOpenFiles({});
                setActivePath(null);
            } else if (action === 'destroy') {
                if (!confirm('Are you sure you want to destroy this workspace? All unsaved changes and files inside the sandbox will be lost forever.')) {
                    setStatus(workspace?.status || 'error');
                    return;
                }
                await apiClient.destroyWorkspace(id);
                router.push('/repository');
            }
        } catch (err: any) {
            setError(err.detail || `Failed to ${action} workspace`);
            setStatus('error');
        }
    };

    // --- File Actions ---

    const handleFileSelect = async (node: FileNode) => {
        if (node.type === 'dir') return; // Tree handles expansion now

        // Already open?
        if (openFiles[node.path]) {
            setActivePath(node.path);
            return;
        }

        // Fetch content and open
        try {
            const data = await apiClient.readWorkspaceFile(id, node.path);
            setOpenFiles(prev => ({
                ...prev,
                [node.path]: {
                    path: node.path,
                    content: data.content,
                    originalContent: data.content,
                    language: data.language
                }
            }));
            setActivePath(node.path);
        } catch (err: any) {
            alert(err.detail || 'Failed to read file');
        }
    };

    const handleCreateFile = async (basePath: string, isDir: boolean) => {
        const name = prompt(`Enter ${isDir ? 'folder' : 'file'} name:`);
        if (!name) return;

        const newPath = basePath === '.' ? name : `${basePath}/${name}`;
        try {
            await apiClient.createWorkspaceFile(id, newPath, isDir);
            // Refresh root tree
            fetchFiles('.');
            
            if (!isDir) {
                setOpenFiles(prev => ({
                    ...prev,
                    [newPath]: {
                        path: newPath,
                        content: '',
                        originalContent: '',
                    }
                }));
                setActivePath(newPath);
            }
        } catch (err: any) {
            alert(err.detail || `Failed to create ${isDir ? 'folder' : 'file'}`);
        }
    };

    const handleDeleteFile = async (path: string) => {
        if (!confirm(`Are you sure you want to delete ${path}?`)) return;
        try {
            await apiClient.deleteWorkspaceFile(id, path);
            fetchFiles('.');
            
            if (openFiles[path]) {
                handleTabClose(path);
            }
        } catch (err: any) {
            alert(err.detail || 'Failed to delete');
        }
    };

    // --- Editor Actions ---

    const handleEditorChange = (value: string | undefined) => {
        if (!activePath || value === undefined) return;
        setOpenFiles(prev => ({
            ...prev,
            [activePath]: {
                ...prev[activePath],
                content: value
            }
        }));
    };

    const handleSaveFile = async () => {
        if (!activePath) return;
        const file = openFiles[activePath];
        if (file.content === file.originalContent) return;

        try {
            await apiClient.writeWorkspaceFile(id, activePath, file.content);
            setOpenFiles(prev => ({
                ...prev,
                [activePath]: {
                    ...prev[activePath],
                    originalContent: file.content
                }
            }));
            // Show save toast
            setShowSaveToast(true);
            setTimeout(() => setShowSaveToast(false), 2000);
        } catch (err: any) {
            alert(err.detail || 'Failed to save file');
        }
    };

    const handleTabClose = (path: string) => {
        const file = openFiles[path];
        if (file && file.content !== file.originalContent) {
            if (!confirm(`You have unsaved changes in ${path}. Close anyway?`)) {
                return;
            }
        }

        setOpenFiles(prev => {
            const next = { ...prev };
            delete next[path];
            return next;
        });

        if (activePath === path) {
            const remaining = Object.keys(openFiles).filter(p => p !== path);
            setActivePath(remaining.length > 0 ? remaining[remaining.length - 1] : null);
        }
    };

    const handleFileChanged = useCallback(async (changedPaths?: string[]) => {
        fetchFiles('.');

        if (changedPaths && changedPaths.length > 0) {
            const updatedFiles: Record<string, OpenFile> = {};
            let hasUpdates = false;

            for (const path of changedPaths) {
                if (openFiles[path]) {
                    try {
                        const data = await apiClient.readWorkspaceFile(id, path);
                        updatedFiles[path] = {
                            ...openFiles[path],
                            content: data.content,
                            originalContent: data.content,
                            language: data.language
                        };
                        hasUpdates = true;
                    } catch (err: any) {
                        console.error(`Failed to refresh file ${path}:`, err);
                    }
                }
            }

            if (hasUpdates) {
                setOpenFiles(prev => {
                    const next = { ...prev };
                    for (const [path, file] of Object.entries(updatedFiles)) {
                        if (next[path]) {
                            next[path] = file;
                        }
                    }
                    return next;
                });
            }
        }
    }, [id, fetchFiles, openFiles]);

    // --- Render Helpers ---

    const tabs: EditorTab[] = Object.values(openFiles).map(f => ({
        path: f.path,
        isDirty: f.content !== f.originalContent
    }));

    const activeFile = activePath ? openFiles[activePath] : null;
    
    // Detect language for status bar
    const getLanguageLabel = (path: string) => {
        const ext = path.split('.').pop()?.toLowerCase();
        const map: Record<string, string> = {
            'js': 'JavaScript', 'ts': 'TypeScript', 'jsx': 'JSX', 'tsx': 'TSX',
            'py': 'Python', 'json': 'JSON', 'html': 'HTML', 'css': 'CSS',
            'md': 'Markdown', 'go': 'Go', 'rs': 'Rust', 'java': 'Java',
            'cpp': 'C++', 'c': 'C', 'sh': 'Shell', 'yaml': 'YAML', 'yml': 'YAML',
            'rb': 'Ruby', 'php': 'PHP', 'sql': 'SQL',
        };
        return map[ext || ''] || 'Plain Text';
    };

    if (error) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-[#0B0F0E] text-[#E6F1EC]">
                <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
                <h2 className="text-xl font-semibold mb-2">Workspace Error</h2>
                <p className="text-[#5A7268] mb-6">{error}</p>
                <button 
                    onClick={() => router.push('/repository')}
                    className="flex items-center gap-2 px-4 py-2 bg-[#1A2420] border border-[#1F2D28] rounded-xl hover:text-[#2EFF7B]"
                >
                    <ArrowLeft className="w-4 h-4" /> Back to Repositories
                </button>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col bg-[#0B0F0E] text-[#E6F1EC] overflow-hidden">
            {/* Top Toolbar */}
            <div className="h-14 flex items-center justify-between px-4 bg-[#111917] border-b border-[#1F2D28] shrink-0">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={() => router.push('/repository')}
                        className="p-2 hover:bg-[#1A2420] rounded-xl transition-colors text-[#8FAEA2] hover:text-[#E6F1EC]"
                        title="Back to Repositories"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    
                    <div className="flex items-center gap-2">
                        <FolderGit2 className="w-5 h-5 text-[#2EFF7B]" />
                        <div>
                            <div className="font-semibold leading-tight">{workspace?.name || 'Workspace'}</div>
                            <div className="text-xs text-[#5A7268] flex items-center gap-1.5">
                                <span className="flex items-center gap-1">
                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                        status === 'running' ? 'bg-[#2EFF7B]' :
                                        status === 'stopped' ? 'bg-gray-500' :
                                        status === 'error' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'
                                    }`} />
                                    <span className="capitalize">{status}</span>
                                </span>
                                • {workspace?.base_image}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {status === 'stopped' && (
                        <button 
                            onClick={() => handleAction('start')}
                            className="flex items-center gap-2 px-3 py-1.5 bg-[#1A2420] border border-[#1F2D28] rounded-lg text-sm hover:border-[#2EFF7B] hover:text-[#2EFF7B] transition-colors"
                        >
                            <Play className="w-4 h-4" /> Start
                        </button>
                    )}
                    
                    {status === 'running' && (
                        <>
                            {/* Save button with toast */}
                            <div className="relative">
                                <button 
                                    onClick={handleSaveFile}
                                    disabled={!activeFile || activeFile.content === activeFile.originalContent}
                                    className="flex items-center gap-2 px-4 py-1.5 bg-[#2EFF7B] text-[#0B0F0E] font-medium rounded-lg text-sm hover:bg-[#1ED760] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    title="Save (Ctrl+S)"
                                >
                                    Save
                                </button>
                                
                                {/* Save toast */}
                                {showSaveToast && (
                                    <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 bg-[#2EFF7B] text-[#0B0F0E] text-xs font-medium rounded-lg shadow-lg shadow-[#2EFF7B]/20 whitespace-nowrap animate-fade-in-down">
                                        <Check className="w-3.5 h-3.5" /> Saved
                                    </div>
                                )}
                            </div>

                            <div className="w-px h-6 bg-[#1F2D28] mx-1" />

                            {/* Refresh tree */}
                            <button 
                                onClick={() => fetchFiles('.')}
                                className="p-1.5 text-[#8FAEA2] hover:text-[#2EFF7B] hover:bg-[#1A2420] rounded-lg transition-colors"
                                title="Refresh file tree"
                            >
                                <RefreshCw className="w-4 h-4" />
                            </button>

                            <button 
                                onClick={() => handleAction('stop')}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#1A2420] border border-[#1F2D28] rounded-lg text-sm hover:text-yellow-400 hover:border-yellow-400/50 transition-colors"
                            >
                                <Square className="w-4 h-4" /> Stop
                            </button>
                        </>
                    )}

                    {status === 'running' && (
                        <button 
                            onClick={() => setShowTerminal(!showTerminal)}
                            className={`flex items-center gap-2 px-3 py-1.5 bg-[#1A2420] border rounded-lg text-sm transition-colors ${
                                showTerminal 
                                    ? 'border-[#2EFF7B] text-[#2EFF7B]' 
                                    : 'border-[#1F2D28] text-[#8FAEA2] hover:border-[#2EFF7B]/50 hover:text-[#2EFF7B]'
                            }`}
                            title={showTerminal ? 'Hide Terminal' : 'Show Terminal'}
                        >
                            <TerminalIcon className="w-4 h-4" />
                            {showTerminal ? <PanelBottomClose className="w-3.5 h-3.5" /> : <PanelBottomOpen className="w-3.5 h-3.5" />}
                        </button>
                    )}

                    {status === 'running' && (
                        <button 
                            onClick={() => setShowAI(!showAI)}
                            className={`flex items-center gap-2 px-3 py-1.5 bg-[#1A2420] border rounded-lg text-sm transition-colors ${
                                showAI 
                                    ? 'border-[#BD93F9] text-[#BD93F9]' 
                                    : 'border-[#1F2D28] text-[#8FAEA2] hover:border-[#BD93F9]/50 hover:text-[#BD93F9]'
                            }`}
                            title={showAI ? 'Hide AI Agent' : 'Show AI Agent'}
                        >
                            <Sparkles className="w-4 h-4" />
                            {showAI ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
                        </button>
                    )}
                    
                    <button 
                        onClick={() => handleAction('destroy')}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[#1A2420] border border-[#1F2D28] rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors ml-2"
                        title="Delete Workspace Completely"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-h-0">
                {['creating', 'starting', 'loading'].includes(status) ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-[#5A7268]">
                        <Loader2 className="w-12 h-12 animate-spin mb-4 text-[#2EFF7B]" />
                        <h3 className="text-lg font-medium text-[#E6F1EC] mb-2">Preparing Workspace...</h3>
                        <p className="text-sm">Pulling image and cloning repository if this is the first run.</p>
                        <p className="text-sm mt-1 opacity-70">This might take a minute or two.</p>
                    </div>
                ) : status === 'running' ? (
                    <>
                        <div className="flex-1 flex min-h-0">
                            {/* Sidebar: File Explorer */}
                            <div className="w-64 shrink-0 flex flex-col">
                                <div className="flex-1 min-h-0 relative">
                                    {isLoadingFiles ? (
                                        <div className="absolute inset-0 flex items-center justify-center bg-[#0B0F0E]/80 z-10">
                                            <Loader2 className="w-6 h-6 animate-spin text-[#8FAEA2]" />
                                        </div>
                                    ) : null}
                                    <FileExplorer 
                                        entries={fileTree}
                                        onFileSelect={handleFileSelect}
                                        selectedPath={activePath || undefined}
                                        currentPath="."
                                        onCreateFile={handleCreateFile}
                                        onDelete={handleDeleteFile}
                                        onFetchChildren={fetchChildren}
                                    />
                                </div>
                            </div>

                            {/* Editor Area */}
                            <div className="flex-1 flex flex-col min-w-0 bg-[#111917]">
                                <EditorTabs
                                    tabs={tabs}
                                    activePath={activePath}
                                    onSelect={setActivePath}
                                    onClose={handleTabClose}
                                />
                                
                                <div className="flex-1 min-h-0 relative">
                                    {activeFile ? (
                                        <CodeEditor
                                            content={activeFile.content}
                                            language={activeFile.language}
                                            path={activeFile.path}
                                            onChange={handleEditorChange}
                                            onSave={handleSaveFile}
                                        />
                                    ) : (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-[#5A7268]">
                                            <div className="w-16 h-16 rounded-2xl bg-[#1A2420] border border-[#1F2D28] flex items-center justify-center mb-4">
                                                <TerminalIcon className="w-8 h-8 text-[#2EFF7B]" />
                                            </div>
                                            <p className="text-sm">Select a file from the explorer to open in the editor.</p>
                                            <p className="text-xs text-[#3A4F46] mt-2">Or press the terminal button to run commands</p>
                                        </div>
                                    )}
                                </div>

                                {/* Status Bar */}
                                {activeFile && (
                                    <div className="h-6 flex items-center justify-between px-3 bg-[#0B0F0E] border-t border-[#1F2D28] text-[10px] text-[#5A7268] shrink-0">
                                        <div className="flex items-center gap-3">
                                            <span className="font-medium text-[#8FAEA2]">{getLanguageLabel(activeFile.path)}</span>
                                            <span>UTF-8</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {activeFile.content !== activeFile.originalContent && (
                                                <span className="text-[#E6CD69]">● Modified</span>
                                            )}
                                            <span>Lines: {activeFile.content.split('\n').length}</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* AI Agent Panel */}
                            {showAI && (
                                <>
                                    {/* Horizontal drag handle */}
                                    <div
                                        className="w-1 cursor-ew-resize hover:bg-[#2EFF7B]/40 bg-[#1F2D28] transition-colors shrink-0"
                                        onMouseDown={handleAiDragStart}
                                        onDoubleClick={() => setAiPanelWidth(320)}
                                    />
                                    <div className="shrink-0 overflow-hidden flex flex-col" style={{ width: `${aiPanelWidth}px` }}>
                                        <WorkspaceChat
                                            workspaceId={id}
                                            isVisible={showAI}
                                            activeFilePath={activePath}
                                            openFilePaths={Object.keys(openFiles)}
                                            onFileChanged={handleFileChanged}
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Terminal Panel */}
                        {showTerminal && (
                            <div className="flex flex-col bg-[#0B0F0E] shrink-0" style={{ height: `${terminalHeight}px` }}>
                                {/* Drag handle */}
                                <div
                                    className="h-1 cursor-ns-resize hover:bg-[#2EFF7B]/40 bg-[#1F2D28] transition-colors shrink-0"
                                    onMouseDown={handleDragStart}
                                    onDoubleClick={() => setTerminalHeight(256)}
                                />
                                <div className="flex items-center justify-between px-3 py-1 border-b border-[#1F2D28] bg-[#111917] shrink-0">
                                    <div className="flex items-center gap-2">
                                        <TerminalIcon className="w-3.5 h-3.5 text-[#2EFF7B]" />
                                        <span className="text-xs font-semibold text-[#8FAEA2] uppercase tracking-wider">Terminal</span>
                                    </div>
                                    <button
                                        onClick={() => setShowTerminal(false)}
                                        className="p-1 text-[#5A7268] hover:text-[#E6F1EC] rounded"
                                    >
                                        <PanelBottomClose className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                <div className="flex-1 min-h-0">
                                    <WorkspaceTerminal workspaceId={id} isVisible={showTerminal} />
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-[#5A7268]">
                        <Square className="w-12 h-12 mb-4" />
                        <h3 className="text-lg font-medium text-[#E6F1EC] mb-2">Workspace Stopped</h3>
                        <p className="text-sm">Start the workspace using the button in the top right to access files.</p>
                    </div>
                )}
            </div>

            {/* Global CSS for toast animation */}
            <style jsx global>{`
                @keyframes fade-in-down {
                    from { opacity: 0; transform: translate(-50%, -8px); }
                    to { opacity: 1; transform: translate(-50%, 0); }
                }
                .animate-fade-in-down {
                    animation: fade-in-down 0.2s ease-out;
                }
            `}</style>
        </div>
    );
}
