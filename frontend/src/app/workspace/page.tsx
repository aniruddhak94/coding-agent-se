'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, WorkspaceResponse } from '@/lib/api';
import { 
    FolderGit2, 
    Trash2, 
    Loader2,
    ExternalLink,
    AlertCircle
} from 'lucide-react';

export default function WorkspaceListPage() {
    const router = useRouter();
    const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

    useEffect(() => {
        loadWorkspaces();
    }, []);

    const loadWorkspaces = async () => {
        setLoading(true);
        try {
            const data = await apiClient.listWorkspaces();
            setWorkspaces(data.workspaces);
        } catch (err) {
            console.error('Failed to load workspaces:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (e: React.MouseEvent, id: number) => {
        e.stopPropagation(); // prevent navigating into the workspace
        if (confirmDeleteId !== id) {
            setConfirmDeleteId(id);
            return;
        }
        setDeletingId(id);
        setConfirmDeleteId(null);
        try {
            await apiClient.destroyWorkspace(id);
            setWorkspaces((prev) => prev.filter((ws) => ws.id !== id));
        } catch (err) {
            console.error('Failed to delete workspace:', err);
        } finally {
            setDeletingId(null);
        }
    };

    const cancelConfirm = (e: React.MouseEvent) => {
        e.stopPropagation();
        setConfirmDeleteId(null);
    };

    const statusColors: Record<string, string> = {
        running: 'bg-[#2EFF7B]',
        stopped: 'bg-gray-500',
        creating: 'bg-yellow-500 animate-pulse',
        error: 'bg-red-500',
    };

    return (
        <div className="min-h-[calc(100vh-3.5rem)] bg-[#0B0F0E] p-6">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-[#E6F1EC]">Workspaces</h1>
                        <p className="text-sm text-[#5A7268] mt-1">Your sandbox development environments</p>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-[#2EFF7B]" />
                    </div>
                ) : workspaces.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-[#5A7268]">
                        <FolderGit2 className="w-16 h-16 mb-4 opacity-50" />
                        <h3 className="text-lg font-medium text-[#E6F1EC] mb-2">No Workspaces Yet</h3>
                        <p className="text-sm">Go to Repositories and click &quot;Open Workspace&quot; to create one.</p>
                    </div>
                ) : (
                    <div className="grid gap-4">
                        {workspaces.map((ws) => (
                            <div
                                key={ws.id}
                                className="bg-[#111917] border border-[#1F2D28] rounded-xl p-4 hover:border-[#2EFF7B]/30 transition-colors cursor-pointer group relative"
                                onClick={() => router.push(`/workspace/${ws.id}`)}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-[#1A2420] border border-[#1F2D28] flex items-center justify-center">
                                            <FolderGit2 className="w-5 h-5 text-[#2EFF7B]" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-[#E6F1EC] group-hover:text-[#2EFF7B] transition-colors">{ws.name}</div>
                                            <div className="text-xs text-[#5A7268] flex items-center gap-2 mt-0.5">
                                                <span className="flex items-center gap-1">
                                                    <span className={`w-1.5 h-1.5 rounded-full ${statusColors[ws.status] || 'bg-gray-500'}`} />
                                                    <span className="capitalize">{ws.status}</span>
                                                </span>
                                                <span>•</span>
                                                <span>{ws.base_image}</span>
                                                <span>•</span>
                                                <span>{new Date(ws.created_at).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                        {confirmDeleteId === ws.id ? (
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-[#FF6B6B] flex items-center gap-1">
                                                    <AlertCircle className="w-3 h-3" /> Confirm?
                                                </span>
                                                <button
                                                    onClick={(e) => handleDelete(e, ws.id)}
                                                    className="px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/40 border border-red-500/30 rounded-lg transition-colors"
                                                >
                                                    Delete
                                                </button>
                                                <button
                                                    onClick={cancelConfirm}
                                                    className="px-2 py-1 text-xs bg-[#1A2420] text-[#8FAEA2] hover:bg-[#253530] border border-[#1F2D28] rounded-lg transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : deletingId === ws.id ? (
                                            <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                                        ) : (
                                            <>
                                                <button
                                                    onClick={(e) => handleDelete(e, ws.id)}
                                                    title="Delete workspace"
                                                    className="p-1.5 text-[#5A7268] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                                <ExternalLink className="w-4 h-4 text-[#5A7268] group-hover:text-[#2EFF7B] transition-colors" />
                                            </>
                                        )}
                                    </div>
                                </div>
                                {ws.error_message && (
                                    <div className="mt-3 text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">
                                        {ws.error_message}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
