"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import MessageBubble from "./MessageBubble";
import { apiClient, ChatMessage as ApiChatMessage } from "@/lib/api";

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
}

interface Repository {
    id: number;
    name: string;
    description?: string;
    file_count: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

const INITIAL_MESSAGES: Message[] = [
    {
        id: "welcome",
        role: "assistant",
        content: "👋 Hello! I'm your **Intelligent Coding Agent**. I can help you with:\n\n- 💡 Answering coding questions\n- 🔧 Generating code in multiple languages\n- 🐛 Debugging errors\n- 📁 Analyzing your repositories\n\nHow can I help you today?",
        timestamp: new Date(),
    },
];

export default function ChatInterface() {
    const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const isLoadingRef = useRef(false);
    const [streamingContent, setStreamingContent] = useState("");
    const [sessionId, setSessionId] = useState<string | null>(null);
    const useStreaming = false;
    const [repositories, setRepositories] = useState<Repository[]>([]);
    const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
    const [uploadedFiles, setUploadedFiles] = useState<{ name: string, status: 'uploading' | 'success' | 'error' }[]>([]);
    const [showRepoDropdown, setShowRepoDropdown] = useState(false);
    const [planMode, setPlanMode] = useState(false);
    const [provider, setProvider] = useState<"gemini" | "qwen" | "qwen-cloud" | "gemma4" | "gpt-oss-cloud" | "kimi-cloud" | "minimax-cloud">("qwen-cloud");
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const searchParams = useSearchParams();
    const router = useRouter();

    const getToken = () => {
        if (typeof window !== "undefined") {
            return localStorage.getItem("auth_token");
        }
        return null;
    };

    /** Persist the session to localStorage for the Recent sidebar section */
    const saveRecentChat = (id: string, title: string) => {
        if (typeof window === "undefined") return;
        try {
            const raw = localStorage.getItem("recent_chats");
            const existing: { id: string; title: string; timestamp: number }[] = raw ? JSON.parse(raw) : [];
            // Remove any previous entry for this session
            const filtered = existing.filter((c) => c.id !== id);
            // Add to front
            filtered.unshift({ id, title, timestamp: Date.now() });
            localStorage.setItem("recent_chats", JSON.stringify(filtered.slice(0, 20)));
            // Fire a storage event so Sidebar picks it up in the same tab
            window.dispatchEvent(new StorageEvent("storage", { key: "recent_chats" }));
        } catch {
            // ignore
        }
    };

    useEffect(() => {
        const fetchRepos = async () => {
            const token = getToken();
            if (!token) return;
            try {
                const response = await fetch(`${API_BASE}/repo`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (response.ok) {
                    const data = await response.json();
                    setRepositories(data.repositories || []);
                }
            } catch (err) {
                console.error("Failed to fetch repositories:", err);
            }
        };
        fetchRepos();
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, streamingContent]);

    // Auto-submit query from global search bar (?q=...)
    useEffect(() => {
        const q = searchParams.get("q");
        if (!q) return;
        // Remove the param from URL without re-render
        router.replace("/chat", { scroll: false });
        // Set and submit
        setInput(q);
        setTimeout(() => {
            const syntheticEvent = { preventDefault: () => { } } as React.FormEvent;
            // Trigger via direct call to avoid stale closure
            const userMessage: Message = {
                id: Date.now().toString(),
                role: "user",
                content: q,
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, userMessage]);
            setInput("");
            setIsLoading(true);
            isLoadingRef.current = true;
            setStreamingContent("");
            const history: ApiChatMessage[] = INITIAL_MESSAGES.slice(-10).map(msg => ({
                role: msg.role,
                content: msg.content,
            }));
            apiClient.sendMessage({ message: q, session_id: undefined, history, repository_id: undefined, provider: "gemini" })
                .then(response => {
                    const aiMessage: Message = { id: (Date.now() + 1).toString(), role: "assistant", content: response.message, timestamp: new Date() };
                    setMessages(prev => [...prev, aiMessage]);
                    setSessionId(response.session_id);
                })
                .catch(err => {
                    const errMsg: Message = { id: (Date.now() + 1).toString(), role: "assistant", content: `⚠️ Error: ${err?.message || "Unknown error"}`, timestamp: new Date() };
                    setMessages(prev => [...prev, errMsg]);
                })
                .finally(() => { 
                    setIsLoading(false); 
                    isLoadingRef.current = false;
                    setStreamingContent(""); 
                });
        }, 100);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const token = getToken();
        if (!token) { alert("Please log in to upload files"); return; }
        if (files.length === 0) return;

        for (const file of files) {
            setUploadedFiles(prev => [...prev, { name: file.name, status: 'uploading' }]);
            try {
                const formData = new FormData();
                formData.append('file', file);
                if (selectedRepoId) formData.append('repository_id', selectedRepoId.toString());

                const response = await fetch(`${API_BASE}/files/upload`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: formData,
                });

                if (response.ok) {
                    setUploadedFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'success' } : f));
                    const repoResponse = await fetch(`${API_BASE}/repo`, { headers: { Authorization: `Bearer ${token}` } });
                    if (repoResponse.ok) {
                        const data = await repoResponse.json();
                        setRepositories(data.repositories || []);
                    }
                } else {
                    const errorData = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
                    console.error('Upload failed:', errorData);
                    setUploadedFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'error' } : f));
                }
            } catch (err) {
                console.error('Upload network error:', err);
                setUploadedFiles(prev => prev.map(f => f.name === file.name ? { ...f, status: 'error' } : f));
            }
        }
        if (e.target) e.target.value = '';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoadingRef.current) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: input.trim(),
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMessage]);
        const currentInput = input.trim();
        setInput("");
        setIsLoading(true);
        isLoadingRef.current = true;
        setStreamingContent("");

        const history: ApiChatMessage[] = messages.slice(-10).map((msg) => ({
            role: msg.role,
            content: msg.content,
        }));

        try {
            if (useStreaming) {
                let fullContent = "";
                await apiClient.streamMessage(
                    { message: currentInput, session_id: sessionId || undefined, history, repository_id: selectedRepoId || undefined, provider },
                    (chunk) => { fullContent += chunk; setStreamingContent(fullContent); },
                    () => {
                        const aiMessage: Message = { id: (Date.now() + 1).toString(), role: "assistant", content: fullContent, timestamp: new Date() };
                        setMessages((prev) => [...prev, aiMessage]);
                        setStreamingContent("");
                        setIsLoading(false);
                        isLoadingRef.current = false;
                    },
                    (error) => { console.error("Streaming error:", error); handleNonStreamingResponse(currentInput, history); }
                );
            } else {
                await handleNonStreamingResponse(currentInput, history);
            }
        } catch (error) {
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: `⚠️ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, errorMessage]);
            setIsLoading(false);
            isLoadingRef.current = false;
        }
    };

    const handleNonStreamingResponse = async (message: string, history: ApiChatMessage[]) => {
        try {
            const response = await apiClient.sendMessage({
                message,
                session_id: sessionId || undefined,
                history,
                repository_id: selectedRepoId || undefined,
                provider,
            });
            setSessionId(response.session_id);
            // Save to recent chats on the very first exchange
            if (!sessionId && response.session_id) {
                const title = message.slice(0, 40) + (message.length > 40 ? '...' : '');
                saveRecentChat(response.session_id, title);
            }
            const aiMessage: Message = { id: (Date.now() + 1).toString(), role: "assistant", content: response.message, timestamp: new Date() };
            setMessages((prev) => [...prev, aiMessage]);
        } catch (error) {
            throw error;
        } finally {
            setIsLoading(false);
            isLoadingRef.current = false;
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const selectedRepo = repositories.find(r => r.id === selectedRepoId);

    return (
        <div className="flex flex-col h-full bg-[#0B0F0E]">
            {/* Context Bar */}
            <div className="border-b border-[#1F2D28] px-4 py-3 bg-[#111917]">
                <div className="flex items-center gap-3">
                    <span className="text-[#5A7268] text-sm">Context:</span>

                    {/* Repository Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setShowRepoDropdown(!showRepoDropdown)}
                            className="flex items-center gap-2 px-3 py-2 bg-[#1A2420] border border-[#1F2D28] rounded-xl text-sm hover:border-[#2EFF7B]/50 transition-colors min-w-[180px]"
                        >
                            <svg className="w-4 h-4 text-[#2EFF7B]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                            </svg>
                            <span className="flex-1 text-left text-[#E6F1EC] truncate">
                                {selectedRepo ? selectedRepo.name : "No repository"}
                            </span>
                            <svg className={`w-4 h-4 text-[#5A7268] transition-transform ${showRepoDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {showRepoDropdown && (
                            <div className="absolute top-full left-0 mt-2 w-64 bg-[#111917] border border-[#1F2D28] rounded-xl shadow-xl z-50 overflow-hidden">
                                <button
                                    onClick={() => { setSelectedRepoId(null); setShowRepoDropdown(false); }}
                                    className={`w-full px-3 py-2.5 text-left text-sm hover:bg-[#1A2420] transition-colors ${!selectedRepoId ? 'bg-[#2EFF7B]/10 text-[#2EFF7B]' : 'text-[#8FAEA2]'}`}
                                >
                                    No repository (general chat)
                                </button>
                                {repositories.map((repo) => (
                                    <button
                                        key={repo.id}
                                        onClick={() => { setSelectedRepoId(repo.id); setShowRepoDropdown(false); }}
                                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-[#1A2420] transition-colors ${selectedRepoId === repo.id ? 'bg-[#2EFF7B]/10 text-[#2EFF7B]' : 'text-[#8FAEA2]'}`}
                                    >
                                        <span className="truncate">{repo.name}</span>
                                        <span className="text-xs text-[#5A7268]">({repo.file_count})</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {selectedRepoId && (
                        <span className="text-[#2EFF7B] text-xs bg-[#2EFF7B]/10 px-2 py-1 rounded-lg border border-[#2EFF7B]/30">
                            ✓ RAG enabled
                        </span>
                    )}

                    {/* AI Provider Dropdown */}
                    <div className="relative">
                        <select
                            value={provider}
                            onChange={(e) => setProvider(e.target.value as "gemini" | "qwen" | "qwen-cloud" | "gemma4" | "gpt-oss-cloud" | "kimi-cloud" | "minimax-cloud")}
                            className={`appearance-none cursor-pointer px-3 py-1.5 pr-7 rounded-lg text-xs font-medium transition-all duration-200 border focus:outline-none ${provider === "gemini"
                                    ? "bg-[#2EFF7B]/10 text-[#2EFF7B] border-[#2EFF7B]/30 hover:bg-[#2EFF7B]/20"
                                    : provider === "gemma4"
                                        ? "bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20"
                                        : provider.endsWith("-cloud")
                                            ? "bg-orange-500/10 text-orange-400 border-orange-500/30 hover:bg-orange-500/20"
                                            : "bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/20"
                                }`}
                            aria-label="AI model"
                        >
                            <option value="gemini">✦ Gemini</option>
                            <option value="gemma4">◆ Gemma 4 (Local)</option>
                            <option value="qwen">■ Qwen 3.5 (Local)</option>
                            <option value="qwen-cloud">☁ Qwen 397B (Cloud)</option>
                            <option value="gpt-oss-cloud">☁ GPT-OSS 120B (Cloud)</option>
                            <option value="kimi-cloud">☁ Kimi k2.5 (Cloud)</option>
                            <option value="minimax-cloud">☁ MiniMax m2.7 (Cloud)</option>
                        </select>
                        <svg className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#5A7268]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                ))}

                {streamingContent && (
                    <MessageBubble message={{ id: "streaming", role: "assistant", content: streamingContent, timestamp: new Date() }} />
                )}

                {isLoading && !streamingContent && (
                    <div className="flex gap-3">
                        <div className="w-9 h-9 rounded-lg bg-[#1A2420] border border-[#1F2D28] flex items-center justify-center">
                            <svg className="w-4 h-4 text-[#2EFF7B]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                        <div className="bg-[#111917] border border-[#1F2D28] rounded-2xl rounded-tl-md px-4 py-3">
                            <div className="flex gap-1.5">
                                <span className="w-2 h-2 bg-[#2EFF7B] rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
                                <span className="w-2 h-2 bg-[#2EFF7B] rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
                                <span className="w-2 h-2 bg-[#2EFF7B] rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
                            </div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 p-4 border-t border-[#1F2D28] bg-[#111917]">
                <div className="flex flex-col bg-[#1A2420] border border-[#1F2D28] rounded-2xl p-2 shadow-sm focus-within:border-[#2EFF7B]/50 transition-colors">
                    {uploadedFiles.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2 px-2 pt-1">
                            {uploadedFiles.map((file, idx) => (
                                <span key={idx} className={`text-xs px-2 py-1 rounded-lg ${file.status === 'success' ? 'bg-[#2EFF7B]/10 text-[#2EFF7B] border border-[#2EFF7B]/30' : file.status === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/30' : 'bg-[#1A2420] text-[#8FAEA2] border border-[#1F2D28]'}`}>
                                    {file.status === 'uploading' ? '⏳' : file.status === 'success' ? '✓' : '✕'} {file.name}
                                </span>
                            ))}
                            <button onClick={() => setUploadedFiles([])} className="text-xs text-[#5A7268] hover:text-red-400">Clear</button>
                        </div>
                    )}
                    <form onSubmit={handleSubmit} className="flex flex-col">
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask me anything about code..."
                            rows={1}
                            className="w-full bg-transparent px-3 py-2 text-sm text-[#E6F1EC] placeholder-[#5A7268] focus:outline-none resize-none"
                            style={{ maxHeight: '200px' }}
                        />
                        <div className="flex justify-between items-center px-1 mt-1">
                            <div className="flex items-center gap-1">
                                <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} className="hidden" accept=".py,.js,.ts,.tsx,.jsx,.java,.cpp,.c,.go,.rs,.md,.json,.pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.txt" />
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="p-2 text-[#5A7268] hover:text-[#8FAEA2] rounded-lg transition-colors"
                                    title="Attach files"
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
                                    type="button"
                                    className="p-1.5 text-[#5A7268] hover:text-[#8FAEA2] rounded-lg transition-colors ml-1"
                                    aria-label="Expand"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"></path><path d="M9 21H3v-6"></path><path d="M21 3l-7 7"></path><path d="M3 21l7-7"></path></svg>
                                </button>

                                <button
                                    type="submit"
                                    disabled={!input.trim() || isLoading}
                                    className="p-2 ml-1 bg-[#2EFF7B] text-[#0B0F0E] rounded-lg hover:bg-[#1ED760] disabled:opacity-50 disabled:bg-[#1A2420] disabled:text-[#5A7268] transition-colors"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
                <div className="text-center mt-2 pointer-events-auto">
                    <span className="text-[10px] text-[#5A7268]">ICA may produce inaccurate information.</span>
                </div>
            </div>
        </div>
    );
}
