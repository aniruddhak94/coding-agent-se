'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { AgentAction, AgentProvider, AgentStreamEvent, apiClient } from '@/lib/api';
import { DiffViewer } from './DiffViewer';
import {
    Bot,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Code2,
    Cpu,
    Loader2,
    Send,
    Sparkles,
    Square,
    TerminalSquare,
    Trash2,
    User,
    Wrench,
    XCircle,
} from 'lucide-react';



interface ToolCallCard {
    name: string;
    args: Record<string, unknown>;
    status: 'running' | 'done' | 'error';
    output?: string;
}

interface ChatMessage {
    role: 'user' | 'agent';
    content: string;
    actions?: AgentAction[];
    modelUsed?: string;
    tokensApprox?: number;
    toolCalls?: ToolCallCard[];
}

interface WorkspaceChatProps {
    workspaceId: number;
    isVisible: boolean;
    activeFilePath?: string | null;
    openFilePaths?: string[];
    onFileChanged?: (changedPaths?: string[]) => void;
}

const PROVIDER_OPTIONS: Array<{ value: AgentProvider; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'qwen', label: 'Qwen 3.5 (Local)' },
    { value: 'qwen-cloud', label: 'Qwen 397B (Cloud)' },
    { value: 'gemma4', label: 'Gemma 4 (Local)' },
    { value: 'gpt-oss-cloud', label: 'GPT-OSS 120B (Cloud)' },
    { value: 'kimi-cloud', label: 'Kimi k2.5 (Cloud)' },
    { value: 'minimax-cloud', label: 'MiniMax m2.7 (Cloud)' },
    { value: 'hf-qwen-7b', label: 'HF Qwen 7B' },
    { value: 'hf-qwen-35b', label: 'HF Qwen 35B' },
    { value: 'hf-llama-8b', label: 'HF Llama 8B' },
    { value: 'hf-llama-70b', label: 'HF Llama 70B' },
];

export const WorkspaceChat: React.FC<WorkspaceChatProps> = ({
    workspaceId,
    isVisible,
    activeFilePath,
    openFilePaths = [],
    onFileChanged,
}) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const [streamingTools, setStreamingTools] = useState<ToolCallCard[]>([]);
    const [streamingModel, setStreamingModel] = useState('');

    const [planMode, setPlanMode] = useState(false);
    const [provider, setProvider] = useState<AgentProvider>('qwen-cloud');
    const isStreamingRef = useRef(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    // Refs to track latest streaming values — avoids nested setState (which React Strict Mode re-executes)
    const streamingContentRef = useRef('');
    const streamingToolsRef = useRef<ToolCallCard[]>([]);
    // Always call the latest onFileChanged callback, even mid-stream
    const onFileChangedRef = useRef(onFileChanged);
    onFileChangedRef.current = onFileChanged;
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const contextFilePaths = (() => {
        const paths = [activeFilePath, ...openFilePaths].filter(
            (path): path is string => Boolean(path)
        );
        const unique = Array.from(new Set(paths));
        return unique.length > 0 ? unique.slice(0, 8) : undefined;
    })();

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streamingContent, streamingTools]);

    useEffect(() => {
        if (isVisible) {
            inputRef.current?.focus();
        }
    }, [isVisible]);

    const handleStop = useCallback(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        // Finalize the streaming message using refs
        const content = streamingContentRef.current;
        const tools = streamingToolsRef.current;
        if (content || tools.length > 0) {
            setMessages((prev) => [
                ...prev,
                {
                    role: 'agent',
                    content: content || '(Generation stopped)',
                    toolCalls: tools.length > 0 ? tools : undefined,
                },
            ]);
        }
        setStreamingContent('');
        streamingContentRef.current = '';
        setStreamingTools([]);
        streamingToolsRef.current = [];
        setStreamingModel('');
        setIsStreaming(false);
        isStreamingRef.current = false;
    }, []);

    const handleSend = useCallback(async () => {
        const prompt = input.trim();
        if (!prompt || isStreamingRef.current) return;

        setInput('');
        setMessages((prev) => [...prev, { role: 'user', content: prompt }]);
        setIsStreaming(true);
        isStreamingRef.current = true;
        setStreamingContent('');
        streamingContentRef.current = '';
        setStreamingTools([]);
        streamingToolsRef.current = [];
        setStreamingModel('');

        const controller = apiClient.agentStream(
            {
                workspace_id: workspaceId,
                prompt,
                file_paths: contextFilePaths,
                provider,
            },
            // onEvent
            (event: AgentStreamEvent) => {
                switch (event.type) {
                    case 'status':
                        setStreamingModel(event.model || '');
                        break;

                    case 'token':
                        streamingContentRef.current += event.content;
                        setStreamingContent(streamingContentRef.current);
                        break;

                    case 'tool_start': {
                        const newTool: ToolCallCard = { name: event.name, args: event.args, status: 'running' };
                        streamingToolsRef.current = [...streamingToolsRef.current, newTool];
                        setStreamingTools(streamingToolsRef.current);
                        break;
                    }

                    case 'tool_result': {
                        streamingToolsRef.current = streamingToolsRef.current.map((tool) =>
                            tool.name === event.name && tool.status === 'running'
                                ? { ...tool, status: 'done' as const, output: event.output }
                                : tool
                        );
                        setStreamingTools(streamingToolsRef.current);
                        break;
                    }

                    case 'done': {
                        // Finalize: move streaming content to messages
                        // Read from REFS (not nested setState) to avoid React Strict Mode re-execution
                        const finalContent = streamingContentRef.current;
                        const finalTools = streamingToolsRef.current;

                        setMessages((prev) => [
                            ...prev,
                            {
                                role: 'agent',
                                content: finalContent || 'Agent completed.',
                                modelUsed: event.model_used,
                                tokensApprox: event.context_tokens_approx,
                                toolCalls:
                                    finalTools.length > 0 ? finalTools : undefined,
                            },
                        ]);

                        // Reset streaming state
                        setStreamingContent('');
                        streamingContentRef.current = '';
                        setStreamingTools([]);
                        streamingToolsRef.current = [];
                        setStreamingModel('');
                        setIsStreaming(false);
                        isStreamingRef.current = false;
                        abortControllerRef.current = null;

                        // Re-fetch files that were edited/created
                        if (event.actions && event.actions.length > 0) {
                            const changedPaths = event.actions
                                .filter((a: any) => ['file_edit', 'file_create', 'file_delete'].includes(a.type))
                                .map((a: any) => {
                                    if (typeof a.path === 'string') {
                                        let cleaned = a.path;
                                        if (cleaned.startsWith('/workspace/')) cleaned = cleaned.replace('/workspace/', '');
                                        if (cleaned.startsWith('./')) cleaned = cleaned.substring(2);
                                        if (cleaned.startsWith('/')) cleaned = cleaned.substring(1);
                                        return cleaned;
                                    }
                                    return null;
                                })
                                .filter((p: any) => typeof p === 'string' && p.length > 0);

                            if (changedPaths.length > 0 && onFileChangedRef.current) {
                                onFileChangedRef.current(changedPaths);
                            }
                        }
                        break;
                    }

                    case 'error': {
                        const errContent = streamingContentRef.current;
                        const errTools = streamingToolsRef.current;

                        setMessages((prev) => [
                            ...prev,
                            {
                                role: 'agent',
                                content: errContent || `⚠️ ${event.message}`,
                                toolCalls:
                                    errTools.length > 0 ? errTools : undefined,
                            },
                        ]);

                        setStreamingContent('');
                        streamingContentRef.current = '';
                        setStreamingTools([]);
                        streamingToolsRef.current = [];
                        setStreamingModel('');
                        setIsStreaming(false);
                        isStreamingRef.current = false;
                        abortControllerRef.current = null;
                        break;
                    }
                }
            },
            // onError
            (error: Error) => {
                setMessages((prev) => [
                    ...prev,
                    {
                        role: 'agent',
                        content: `Error: ${error.message}`,
                    },
                ]);
                setStreamingContent('');
                setStreamingTools([]);
                setStreamingModel('');
                setIsStreaming(false);
                isStreamingRef.current = false;
                abortControllerRef.current = null;
            },
            // onComplete
            () => {
                // SSE stream closed naturally — done event handles finalization
            }
        );

        abortControllerRef.current = controller;
    }, [input, isStreaming, workspaceId, contextFilePaths, provider]);


    return (
        <div className={`h-full flex flex-col bg-[#0B0F0E] border-l border-[#1F2D28] ${isVisible ? '' : 'hidden'}`}>
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[#1F2D28] bg-[#111917] shrink-0">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#2EFF7B]" />
                        <span className="text-sm font-semibold text-[#E6F1EC]">AI Agent</span>
                        {streamingModel && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2EFF7B]/10 text-[#2EFF7B] font-mono">
                                {streamingModel}
                            </span>
                        )}
                    </div>
                    <p className="text-[10px] text-[#5A7268] mt-1">
                        Real-time streaming agent with tool calls
                    </p>
                </div>

                <select
                    value={provider}
                    onChange={(event) => setProvider(event.target.value as AgentProvider)}
                    className="text-[10px] bg-[#1A2420] border border-[#1F2D28] text-[#8FAEA2] rounded px-2 py-1 focus:outline-none focus:border-[#2EFF7B]/50"
                    aria-label="Agent provider"
                >
                    {PROVIDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </div>

            {/* Context files */}
            {contextFilePaths && contextFilePaths.length > 0 && (
                <div className="px-3 py-2 border-b border-[#1F2D28] bg-[#0F1513] shrink-0">
                    <div className="text-[10px] uppercase tracking-wide text-[#5A7268]">Context Files</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                        {contextFilePaths.map((path) => (
                            <span
                                key={path}
                                className="px-2 py-1 rounded-full bg-[#1A2420] text-[10px] text-[#8FAEA2] border border-[#1F2D28]"
                            >
                                {path}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 relative">
                {messages.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center animate-fadeIn pt-10">
                        <div className="mb-6 flex flex-col items-center">
                            <div className="w-16 h-16 rounded-3xl bg-[#1A2420] border-2 border-[#1F2D28] flex items-center justify-center mb-6">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2EFF7B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><line x1="12" y1="8" x2="12" y2="12"></line><line x1="9" y1="12" x2="15" y2="12"></line></svg>
                            </div>
                            <h2 className="text-2xl font-bold text-[#E6F1EC] mb-3">New chat with Agent</h2>
                            <p className="text-sm text-[#8FAEA2] max-w-sm leading-relaxed">Agent can make changes, review its work, and debug itself automatically.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3 max-w-2xl w-full">
                            {[
                                "Check my app for bugs",
                                "Add payment processing",
                                "Connect with an AI Assistant",
                                "Add SMS message sending",
                                "Add a database",
                                "Add authenticated user login"
                            ].map((pill, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setInput(pill)}
                                    className="px-4 py-3 bg-[#1A2420] border border-[#1F2D28] rounded-xl text-sm text-[#E6F1EC] hover:bg-[#1A2420]/80 hover:text-[#2EFF7B] hover:border-[#2EFF7B]/30 transition-all text-center whitespace-nowrap overflow-hidden text-ellipsis shadow-sm"
                                >
                                    {pill}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {messages.map((message, index) => (
                    <div key={index} className={`flex gap-3 animate-fadeIn ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${message.role === 'user' ? 'bg-[#2EFF7B] text-[#0B0F0E]' : 'bg-[#1A2420] border border-[#1F2D28] text-[#2EFF7B]'}`}>
                            <span className="text-xs font-bold">{message.role === 'user' ? 'U' : 'AI'}</span>
                        </div>

                        <div
                            className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${message.role === 'user'
                                    ? 'bg-[#2EFF7B] text-[#0B0F0E] rounded-br-md'
                                    : 'bg-[#111917] border border-[#1F2D28] text-[#E6F1EC] rounded-bl-md'
                                }`}
                        >
                            {/* Tool call cards */}
                            {message.toolCalls && message.toolCalls.length > 0 && (
                                <div className="mb-3 space-y-1">
                                    {message.toolCalls.map((tc, i) => (
                                        <ToolCallBadge key={i} tool={tc} />
                                    ))}
                                </div>
                            )}
                            <div className={`prose prose-sm max-w-none ${message.role === 'user' ? 'prose-green text-[#0B0F0E] font-medium' : 'prose-invert'}`}>
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        code({ node, className, children, ...props }) {
                                            const match = /language-(\w+)/.exec(className || "");
                                            const codeString = String(children).replace(/\n$/, "");
                                            const lang = match ? match[1] : "";

                                            if (match) {
                                                if (message.role === 'user') return <div className="p-2 bg-black/10 rounded">{codeString}</div>;
                                                return (
                                                    <div className="my-3">
                                                        <div className="relative rounded-xl overflow-hidden bg-[#0B0F0E] border border-[#1F2D28]">
                                                            <div className="flex items-center justify-between px-4 py-2 bg-[#1A2420] border-b border-[#1F2D28]">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="flex gap-1.5">
                                                                        <span className="w-3 h-3 rounded-full bg-[#FF5F56]" />
                                                                        <span className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                                                                        <span className="w-3 h-3 rounded-full bg-[#27CA40]" />
                                                                    </div>
                                                                    <span className="text-xs text-[#5A7268] ml-2">{lang}</span>
                                                                </div>
                                                            </div>
                                                            <SyntaxHighlighter
                                                                style={oneDark}
                                                                language={lang}
                                                                PreTag="div"
                                                                customStyle={{ margin: 0, padding: "16px", background: "transparent", fontSize: "13px" }}
                                                            >
                                                                {codeString}
                                                            </SyntaxHighlighter>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            return <code className={`px-1.5 py-0.5 ${message.role === 'user' ? 'bg-black/10' : 'bg-[#1A2420] text-[#2EFF7B]'} rounded text-sm`} {...props}>{children}</code>;
                                        },
                                        p({ children }) { return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>; },
                                        ul({ children }) { return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>; },
                                        ol({ children }) { return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>; },
                                        h1({ children }) { return <h1 className="text-xl font-bold mb-2">{children}</h1>; },
                                        h2({ children }) { return <h2 className="text-lg font-bold mb-2">{children}</h2>; },
                                        h3({ children }) { return <h3 className="text-base font-semibold mb-1">{children}</h3>; },
                                        blockquote({ children }) { return <blockquote className="border-l-4 border-current pl-4 my-2 italic opacity-80">{children}</blockquote>; },
                                        table({ children }) { return <div className="overflow-x-auto my-3"><table className={`min-w-full border ${message.role === 'user' ? 'border-black/20' : 'border-[#1F2D28]'} rounded-lg overflow-hidden`}>{children}</table></div>; },
                                        th({ children }) { return <th className={`px-4 py-2 ${message.role === 'user' ? 'bg-black/10' : 'bg-[#1A2420] text-[#E6F1EC]'} text-left font-semibold border-b ${message.role === 'user' ? 'border-black/20' : 'border-[#1F2D28]'}`}>{children}</th>; },
                                        td({ children }) { return <td className={`px-4 py-2 border-b ${message.role === 'user' ? 'border-black/20' : 'border-[#1F2D28]'}`}>{children}</td>; },
                                    }}
                                >
                                    {message.content}
                                </ReactMarkdown>
                            </div>
                            {message.modelUsed && (
                                <div className={`flex items-center gap-1 mt-2 text-[10px] ${message.role === 'user' ? 'opacity-60' : 'text-[#5A7268]'}`}>
                                    <Cpu className="w-3 h-3" />
                                    <span>{message.modelUsed}</span>
                                    <span>·</span>
                                    <span>~{message.tokensApprox} tokens</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {/* Active streaming message */}
                {isStreaming && (
                    <div className="flex gap-3 animate-fadeIn">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 bg-[#1A2420] border border-[#1F2D28] text-[#2EFF7B]">
                            <span className="text-xs font-bold">AI</span>
                        </div>
                        <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-[#111917] border border-[#1F2D28] text-[#E6F1EC] rounded-bl-md">
                            {/* Live tool cards */}
                            {streamingTools.length > 0 && (
                                <div className="mb-3 space-y-1">
                                    {streamingTools.map((tc, i) => (
                                        <ToolCallBadge key={i} tool={tc} />
                                    ))}
                                </div>
                            )}
                            {streamingContent ? (
                                <div className="prose prose-sm max-w-none prose-invert">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                    >
                                        {streamingContent + (streamingContent.endsWith('\n') ? '█' : ' █')}
                                    </ReactMarkdown>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-[#8FAEA2]">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    {streamingTools.length > 0
                                        ? 'Executing tools...'
                                        : 'Thinking...'}
                                </div>
                            )}
                        </div>
                    </div>
                )}


                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 p-4 border-t border-[#1F2D28] bg-[#111917]">
                <div className="flex flex-col bg-[#1A2420] border border-[#1F2D28] rounded-2xl p-2 shadow-sm focus-within:border-[#2EFF7B]/50 transition-colors">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="Make, test, iterate..."
                        rows={1}
                        className="w-full bg-transparent px-3 py-3 text-sm text-[#E6F1EC] placeholder-[#5A7268] focus:outline-none resize-none"
                        style={{ maxHeight: '200px' }}
                    />
                    <div className="flex justify-between items-center px-1 mt-1">
                        <div className="flex items-center gap-1">
                            <button
                                className="p-2 text-[#5A7268] hover:text-[#8FAEA2] rounded-lg transition-colors"
                                aria-label="Add attachment"
                                title="Attachments"
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <div className="relative flex items-center">
                                    <input type="checkbox" className="sr-only" checked={planMode} onChange={(e) => setPlanMode(e.target.checked)} />
                                    <div className={`block w-9 h-5 rounded-full transition-colors ${planMode ? 'bg-[#2EFF7B]/20' : 'bg-[#111917] border border-[#1F2D28]'}`}></div>
                                    <div className={`absolute left-1 top-1 w-3 h-3 rounded-full transition-transform ${planMode ? 'translate-x-4 bg-[#2EFF7B]' : 'bg-[#5A7268] group-hover:bg-[#8FAEA2]'}`}></div>
                                </div>
                                <span className={`text-xs transition-colors ${planMode ? 'text-[#2EFF7B]' : 'text-[#5A7268] group-hover:text-[#8FAEA2]'}`}>Plan</span>
                            </label>

                            <button
                                className="p-1.5 text-[#5A7268] hover:text-[#8FAEA2] rounded-lg transition-colors ml-1"
                                aria-label="Expand"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"></path><path d="M9 21H3v-6"></path><path d="M21 3l-7 7"></path><path d="M3 21l7-7"></path></svg>
                            </button>

                            {isStreaming ? (
                                <button
                                    onClick={handleStop}
                                    className="p-2 ml-1 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                                    aria-label="Stop generation"
                                >
                                    <Square className="w-4 h-4 fill-current" />
                                </button>
                            ) : (
                                <button
                                    onClick={handleSend}
                                    disabled={!input.trim()}
                                    className="p-2 ml-1 bg-[#2EFF7B] text-[#0B0F0E] rounded-lg hover:bg-[#1ED760] disabled:opacity-50 disabled:bg-[#1A2420] disabled:text-[#5A7268] transition-colors"
                                    aria-label="Send message"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── Tool Call Badge ───────────────────────────────────────────────

const ToolCallBadge: React.FC<{ tool: ToolCallCard }> = ({ tool }) => {
    const [expanded, setExpanded] = useState(false);
    const argSummary = Object.entries(tool.args)
        .map(([k, v]) => {
            const val = typeof v === 'string' ? v : JSON.stringify(v);
            return `${k}=${val.length > 30 ? val.slice(0, 30) + '…' : val}`;
        })
        .join(', ');

    return (
        <div className="rounded-lg border border-[#1F2D28] bg-[#0F1513] text-[11px] overflow-hidden">
            <button
                onClick={() => setExpanded((p) => !p)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-[#1A2420]/50 transition-colors text-left"
            >
                {tool.status === 'running' ? (
                    <Loader2 className="w-3 h-3 text-[#E6CD69] animate-spin shrink-0" />
                ) : tool.status === 'done' ? (
                    <CheckCircle2 className="w-3 h-3 text-[#2EFF7B] shrink-0" />
                ) : (
                    <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                )}
                <Wrench className="w-3 h-3 text-[#8FAEA2] shrink-0" />
                <span className="text-[#E6F1EC] font-mono font-semibold">{tool.name}</span>
                <span className="text-[#5A7268] truncate flex-1">({argSummary})</span>
                {tool.output && (
                    expanded
                        ? <ChevronUp className="w-3 h-3 text-[#5A7268] shrink-0" />
                        : <ChevronDown className="w-3 h-3 text-[#5A7268] shrink-0" />
                )}
            </button>
            {expanded && tool.output && (
                <div className="px-2 py-1.5 border-t border-[#1F2D28] max-h-32 overflow-y-auto">
                    <pre className="text-[10px] text-[#8FAEA2] whitespace-pre-wrap break-words font-mono">
                        {tool.output}
                    </pre>
                </div>
            )}
        </div>
    );
};

