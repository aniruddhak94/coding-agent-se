"use client";

import { useState, useRef, useEffect } from "react";
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
    const [streamingContent, setStreamingContent] = useState("");
    const [sessionId, setSessionId] = useState<string | null>(null);
    const useStreaming = false;
    const [repositories, setRepositories] = useState<Repository[]>([]);
    const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
    const [uploadedFiles, setUploadedFiles] = useState<{ name: string, status: 'uploading' | 'success' | 'error' }[]>([]);
    const [showRepoDropdown, setShowRepoDropdown] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const getToken = () => {
        if (typeof window !== "undefined") {
            return localStorage.getItem("auth_token");
        }
        return null;
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
        if (!input.trim() || isLoading) return;

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
        setStreamingContent("");

        const history: ApiChatMessage[] = messages.slice(-10).map((msg) => ({
            role: msg.role,
            content: msg.content,
        }));

        try {
            if (useStreaming) {
                let fullContent = "";
                await apiClient.streamMessage(
                    { message: currentInput, session_id: sessionId || undefined, history, repository_id: selectedRepoId || undefined },
                    (chunk) => { fullContent += chunk; setStreamingContent(fullContent); },
                    () => {
                        const aiMessage: Message = { id: (Date.now() + 1).toString(), role: "assistant", content: fullContent, timestamp: new Date() };
                        setMessages((prev) => [...prev, aiMessage]);
                        setStreamingContent("");
                        setIsLoading(false);
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
        }
    };

    const handleNonStreamingResponse = async (message: string, history: ApiChatMessage[]) => {
        try {
            const response = await apiClient.sendMessage({
                message,
                session_id: sessionId || undefined,
                history,
                repository_id: selectedRepoId || undefined,
            });
            setSessionId(response.session_id);
            const aiMessage: Message = { id: (Date.now() + 1).toString(), role: "assistant", content: response.message, timestamp: new Date() };
            setMessages((prev) => [...prev, aiMessage]);
        } catch (error) {
            throw error;
        } finally {
            setIsLoading(false);
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
            <div className="border-t border-[#1F2D28] p-4 bg-[#111917]">
                {uploadedFiles.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-2">
                        {uploadedFiles.map((file, idx) => (
                            <span key={idx} className={`text-xs px-2 py-1 rounded-lg ${file.status === 'success' ? 'bg-[#2EFF7B]/10 text-[#2EFF7B] border border-[#2EFF7B]/30' : file.status === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/30' : 'bg-[#1A2420] text-[#8FAEA2]'}`}>
                                {file.status === 'uploading' ? '⏳' : file.status === 'success' ? '✓' : '✕'} {file.name}
                            </span>
                        ))}
                        <button onClick={() => setUploadedFiles([])} className="text-xs text-[#5A7268] hover:text-red-400">Clear</button>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="relative">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask me anything about code..."
                        rows={2}
                        className="w-full bg-[#1A2420] text-[#E6F1EC] placeholder-[#5A7268] rounded-xl px-4 py-3 pr-14 resize-none border border-[#1F2D28] focus:border-[#2EFF7B] focus:outline-none transition-colors"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || isLoading}
                        className="absolute right-3 bottom-3 p-2.5 bg-[#2EFF7B] hover:bg-[#1ED760] disabled:bg-[#1A2420] disabled:text-[#5A7268] text-[#0B0F0E] disabled:cursor-not-allowed rounded-xl transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                    </button>
                </form>

                <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-4">
                        <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} className="hidden" accept=".py,.js,.ts,.tsx,.jsx,.java,.cpp,.c,.go,.rs,.md,.json,.pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.txt" />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-1.5 text-xs text-[#8FAEA2] hover:text-[#2EFF7B] transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                            Attach files
                        </button>
                        <span className="text-xs text-[#5A7268]">ICA may produce inaccurate information.</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
