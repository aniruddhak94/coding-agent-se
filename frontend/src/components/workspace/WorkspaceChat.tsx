'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AgentAction, AgentProvider, apiClient } from '@/lib/api';
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
    TerminalSquare,
    Trash2,
    User,
    XCircle,
} from 'lucide-react';

type ActionDecision = 'pending' | 'accepted' | 'rejected';

interface ChatMessage {
    role: 'user' | 'agent';
    content: string;
    actions?: AgentAction[];
    modelUsed?: string;
    tokensApprox?: number;
}

interface WorkspaceChatProps {
    workspaceId: number;
    isVisible: boolean;
    activeFilePath?: string | null;
    openFilePaths?: string[];
    onFileChanged?: () => void;
}

const PROVIDER_OPTIONS: Array<{ value: AgentProvider; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'qwen', label: 'Qwen' },
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
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            role: 'agent',
            content:
                "I'm your workspace agent. I can inspect the workspace, propose file changes, and wait for your approval before applying them.",
        },
    ]);
    const [input, setInput] = useState('');
    const [isPlanning, setIsPlanning] = useState(false);
    const [pendingActions, setPendingActions] = useState<AgentAction[] | null>(null);
    const [actionStates, setActionStates] = useState<Record<number, ActionDecision>>({});
    const [isApplying, setIsApplying] = useState(false);
    const [provider, setProvider] = useState<AgentProvider>('auto');
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
    }, [messages, pendingActions]);

    useEffect(() => {
        if (isVisible) {
            inputRef.current?.focus();
        }
    }, [isVisible]);

    const handleSend = async () => {
        const prompt = input.trim();
        if (!prompt || isPlanning) {
            return;
        }

        setInput('');
        setMessages((prev) => [...prev, { role: 'user', content: prompt }]);
        setIsPlanning(true);
        setPendingActions(null);
        setActionStates({});

        try {
            const response = await apiClient.agentAct({
                workspace_id: workspaceId,
                prompt,
                file_paths: contextFilePaths,
                provider,
            });

            setMessages((prev) => [
                ...prev,
                {
                    role: 'agent',
                    content: response.explanation,
                    actions: response.actions,
                    modelUsed: response.model_used,
                    tokensApprox: response.context_tokens_approx,
                },
            ]);

            if (response.actions.length > 0) {
                setPendingActions(response.actions);
                setActionStates(
                    response.actions.reduce<Record<number, ActionDecision>>((next, _action, index) => {
                        next[index] = 'pending';
                        return next;
                    }, {})
                );
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to reach AI agent';
            setMessages((prev) => [
                ...prev,
                {
                    role: 'agent',
                    content: `Error while planning changes: ${message}`,
                },
            ]);
        } finally {
            setIsPlanning(false);
        }
    };

    const handleApply = async () => {
        if (!pendingActions) {
            return;
        }

        const accepted = pendingActions.filter((_, index) => actionStates[index] === 'accepted');
        if (accepted.length === 0) {
            return;
        }

        setIsApplying(true);

        try {
            const result = await apiClient.agentApply(workspaceId, accepted);
            const successCount = result.results.filter((item) => item.success).length;
            const failureCount = result.results.length - successCount;
            const details = result.results
                .filter((item) => item.output || item.error)
                .map((item) => {
                    const label = item.action.path || item.action.command || item.action.description;
                    const detail = item.success ? item.output : item.error;
                    return `${item.success ? '[ok]' : '[error]'} ${label}${detail ? `\n${detail}` : ''}`;
                })
                .join('\n\n');

            const summaryLines = [
                `Applied ${successCount} of ${result.results.length} approved action(s).`,
            ];

            if (failureCount > 0) {
                summaryLines.push(`${failureCount} action(s) failed.`);
            }

            if (details) {
                summaryLines.push('', details);
            }

            setMessages((prev) => [
                ...prev,
                {
                    role: 'agent',
                    content: summaryLines.join('\n'),
                },
            ]);

            setPendingActions(null);
            setActionStates({});
            onFileChanged?.();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setMessages((prev) => [
                ...prev,
                {
                    role: 'agent',
                    content: `Failed to apply approved actions: ${message}`,
                },
            ]);
        } finally {
            setIsApplying(false);
        }
    };

    const handleAcceptAll = () => {
        if (!pendingActions) {
            return;
        }

        setActionStates(
            pendingActions.reduce<Record<number, ActionDecision>>((next, _action, index) => {
                next[index] = 'accepted';
                return next;
            }, {})
        );
    };

    const handleRejectAll = () => {
        if (!pendingActions) {
            return;
        }

        setActionStates(
            pendingActions.reduce<Record<number, ActionDecision>>((next, _action, index) => {
                next[index] = 'rejected';
                return next;
            }, {})
        );
    };

    const acceptedCount = pendingActions
        ? pendingActions.filter((_, index) => actionStates[index] === 'accepted').length
        : 0;

    return (
        <div className={`h-full flex flex-col bg-[#0B0F0E] border-l border-[#1F2D28] ${isVisible ? '' : 'hidden'}`}>
            <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[#1F2D28] bg-[#111917] shrink-0">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#2EFF7B]" />
                        <span className="text-sm font-semibold text-[#E6F1EC]">AI Agent</span>
                    </div>
                    <p className="text-[10px] text-[#5A7268] mt-1">
                        Plans with `/agent/act`, applies with `/agent/apply`.
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

            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
                {messages.map((message, index) => (
                    <div key={index} className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : ''}`}>
                        {message.role === 'agent' && (
                            <div className="w-6 h-6 rounded-lg bg-[#2EFF7B]/15 flex items-center justify-center shrink-0 mt-0.5">
                                <Bot className="w-3.5 h-3.5 text-[#2EFF7B]" />
                            </div>
                        )}

                        <div
                            className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                                message.role === 'user'
                                    ? 'bg-[#2EFF7B]/15 text-[#E6F1EC]'
                                    : 'bg-[#1A2420] text-[#E6F1EC]'
                            }`}
                        >
                            <div className="whitespace-pre-wrap break-words">{message.content}</div>
                            {message.modelUsed && (
                                <div className="flex items-center gap-1 mt-1.5 text-[10px] text-[#5A7268]">
                                    <Cpu className="w-3 h-3" />
                                    <span>{message.modelUsed}</span>
                                    <span>-</span>
                                    <span>~{message.tokensApprox} tokens</span>
                                </div>
                            )}
                        </div>

                        {message.role === 'user' && (
                            <div className="w-6 h-6 rounded-lg bg-[#1A2420] flex items-center justify-center shrink-0 mt-0.5">
                                <User className="w-3.5 h-3.5 text-[#8FAEA2]" />
                            </div>
                        )}
                    </div>
                ))}

                {isPlanning && (
                    <div className="flex gap-2">
                        <div className="w-6 h-6 rounded-lg bg-[#2EFF7B]/15 flex items-center justify-center shrink-0">
                            <Bot className="w-3.5 h-3.5 text-[#2EFF7B]" />
                        </div>
                        <div className="bg-[#1A2420] rounded-xl px-3 py-2 text-sm text-[#8FAEA2] flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Planning actions from the workspace state...
                        </div>
                    </div>
                )}

                {pendingActions && pendingActions.length > 0 && (
                    <div className="border border-[#1F2D28] rounded-xl overflow-hidden bg-[#111917]">
                        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[#1F2D28]">
                            <div>
                                <span className="text-xs font-semibold text-[#E6F1EC]">
                                    Proposed Actions ({pendingActions.length})
                                </span>
                                <p className="text-[10px] text-[#5A7268] mt-0.5">
                                    Accept the actions you want to send to `/agent/apply`.
                                </p>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    onClick={handleAcceptAll}
                                    className="text-[10px] px-2 py-1 bg-[#2EFF7B]/15 text-[#2EFF7B] rounded hover:bg-[#2EFF7B]/25 transition-colors"
                                >
                                    Accept All
                                </button>
                                <button
                                    onClick={handleRejectAll}
                                    className="text-[10px] px-2 py-1 bg-red-500/15 text-red-400 rounded hover:bg-red-500/25 transition-colors"
                                >
                                    Reject All
                                </button>
                            </div>
                        </div>

                        <div className="divide-y divide-[#1F2D28]">
                            {pendingActions.map((action, index) => (
                                <ActionCard
                                    key={`${action.type}-${action.path || action.command || index}`}
                                    action={action}
                                    state={actionStates[index] || 'pending'}
                                    onAccept={() =>
                                        setActionStates((prev) => ({ ...prev, [index]: 'accepted' }))
                                    }
                                    onReject={() =>
                                        setActionStates((prev) => ({ ...prev, [index]: 'rejected' }))
                                    }
                                />
                            ))}
                        </div>

                        <div className="px-3 py-2 border-t border-[#1F2D28] bg-[#0F1513]">
                            <button
                                onClick={handleApply}
                                disabled={acceptedCount === 0 || isApplying}
                                className="w-full flex items-center justify-center gap-2 py-2 bg-[#2EFF7B] text-[#0B0F0E] text-sm font-semibold rounded-lg hover:bg-[#1ED760] disabled:opacity-50 transition-colors"
                            >
                                {isApplying ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Applying...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 className="w-4 h-4" />
                                        Apply {acceptedCount} Action(s)
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            <div className="shrink-0 p-3 border-t border-[#1F2D28]">
                <div className="flex items-end gap-2">
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
                        placeholder="Ask the agent to inspect or change this workspace..."
                        rows={1}
                        className="flex-1 bg-[#1A2420] border border-[#1F2D28] rounded-xl px-3 py-2 text-sm text-[#E6F1EC] placeholder-[#5A7268] focus:outline-none focus:border-[#2EFF7B]/50 resize-none"
                        style={{ maxHeight: '120px' }}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isPlanning}
                        className="p-2.5 bg-[#2EFF7B] text-[#0B0F0E] rounded-xl hover:bg-[#1ED760] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                        aria-label="Send message"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};

const ActionCard: React.FC<{
    action: AgentAction;
    state: ActionDecision;
    onAccept: () => void;
    onReject: () => void;
}> = ({ action, state, onAccept, onReject }) => {
    const [expanded, setExpanded] = useState(false);

    const typeMeta: Record<
        AgentAction['type'],
        { icon: React.ReactNode; label: string; color: string }
    > = {
        file_edit: {
            icon: <Code2 className="w-3.5 h-3.5" />,
            label: 'Edit',
            color: 'text-[#E6CD69]',
        },
        file_create: {
            icon: <CheckCircle2 className="w-3.5 h-3.5" />,
            label: 'Create',
            color: 'text-[#2EFF7B]',
        },
        file_delete: {
            icon: <Trash2 className="w-3.5 h-3.5" />,
            label: 'Delete',
            color: 'text-red-400',
        },
        run_command: {
            icon: <TerminalSquare className="w-3.5 h-3.5" />,
            label: 'Command',
            color: 'text-[#69B4E6]',
        },
    };

    const meta = typeMeta[action.type];

    return (
        <div className={`px-3 py-2 ${state === 'rejected' ? 'opacity-45' : ''}`}>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={meta.color}>{meta.icon}</span>
                    <span className={`text-[10px] font-semibold uppercase ${meta.color}`}>{meta.label}</span>
                    <span className="text-xs text-[#E6F1EC] truncate">
                        {action.path || action.command || action.description}
                    </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    {action.content && (
                        <button
                            onClick={() => setExpanded((prev) => !prev)}
                            className="p-1 text-[#5A7268] hover:text-[#E6F1EC] rounded"
                            aria-label={expanded ? 'Collapse preview' : 'Expand preview'}
                        >
                            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                    )}

                    <button
                        onClick={onAccept}
                        className={`p-1 rounded transition-colors ${
                            state === 'accepted'
                                ? 'bg-[#2EFF7B]/20 text-[#2EFF7B]'
                                : 'text-[#5A7268] hover:text-[#2EFF7B] hover:bg-[#2EFF7B]/10'
                        }`}
                        title="Accept action"
                    >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                        onClick={onReject}
                        className={`p-1 rounded transition-colors ${
                            state === 'rejected'
                                ? 'bg-red-500/20 text-red-400'
                                : 'text-[#5A7268] hover:text-red-400 hover:bg-red-500/10'
                        }`}
                        title="Reject action"
                    >
                        <XCircle className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            <p className="text-[10px] text-[#8FAEA2] mt-0.5">{action.description}</p>

            {expanded && action.content && (
                <div className="mt-2">
                    <DiffViewer content={action.content} path={action.path || 'untitled'} />
                </div>
            )}
        </div>
    );
};
