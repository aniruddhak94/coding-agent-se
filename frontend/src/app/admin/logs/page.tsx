"use client";
import { useEffect, useState, useCallback } from "react";
import { apiClient, AdminLogItem } from "@/lib/api";

const ACTION_OPTIONS = [
    "USER_LOGIN",
    "USER_BANNED",
    "USER_ROLE_CHANGED",
    "USER_DELETED",
    "REPO_CREATED",
    "REPO_DELETED",
    "AGENT_RUN",
    "WORKSPACE_CREATED",
    "WORKSPACE_DELETED",
    "ERROR",
];

const ACTION_COLORS: Record<string, string> = {
    USER_LOGIN: "text-blue-400 bg-blue-900/20",
    USER_BANNED: "text-orange-400 bg-orange-900/20",
    USER_ROLE_CHANGED: "text-yellow-400 bg-yellow-900/20",
    USER_DELETED: "text-red-400 bg-red-900/20",
    REPO_CREATED: "text-emerald-400 bg-emerald-900/20",
    REPO_DELETED: "text-red-400 bg-red-900/20",
    AGENT_RUN: "text-purple-400 bg-purple-900/20",
    WORKSPACE_CREATED: "text-cyan-400 bg-cyan-900/20",
    WORKSPACE_DELETED: "text-red-400 bg-red-900/20",
    ERROR: "text-red-500 bg-red-900/30",
};

export default function AdminLogsPage() {
    const [logs, setLogs] = useState<AdminLogItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [actionFilter, setActionFilter] = useState("");
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const LIMIT = 50;

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await apiClient.getAdminLogs({
                action: actionFilter || undefined,
                page,
                limit: LIMIT,
            });
            setLogs(res.logs);
            setTotal(res.total);
        } catch (e: any) {
            setError(e.message || "Failed to load logs");
        } finally {
            setLoading(false);
        }
    }, [actionFilter, page]);

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    const totalPages = Math.ceil(total / LIMIT);

    return (
        <div className="p-8 text-[#E6F1EC]">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-white mb-1">Activity Logs</h1>
                <p className="text-[#4A6355] text-sm">{total} total events</p>
            </div>

            {/* Filters */}
            <div className="mb-6 flex gap-3 flex-wrap">
                <select
                    value={actionFilter}
                    onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
                    className="bg-[#111917] border border-[#1F2D28] rounded-lg px-4 py-2 text-sm text-[#E6F1EC] focus:outline-none focus:border-[#2EFF7B]/50 appearance-none"
                >
                    <option value="">All Actions</option>
                    {ACTION_OPTIONS.map((a) => (
                        <option key={a} value={a}>{a}</option>
                    ))}
                </select>

                {actionFilter && (
                    <button
                        onClick={() => { setActionFilter(""); setPage(1); }}
                        className="px-4 py-2 bg-[#111917] border border-[#1F2D28] text-[#8BA89A] rounded-lg text-sm hover:text-white transition-colors"
                    >
                        Clear Filter
                    </button>
                )}
            </div>

            {error && (
                <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>
            )}

            {/* Log table */}
            <div className="bg-[#0D1210] border border-[#1A2820] rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-[#1A2820] text-[#4A6355] text-xs uppercase tracking-wider">
                            <th className="text-left px-5 py-3">Timestamp</th>
                            <th className="text-left px-5 py-3">User</th>
                            <th className="text-left px-5 py-3">Action</th>
                            <th className="text-right px-5 py-3">Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={4} className="py-16 text-center">
                                    <div className="w-6 h-6 border-2 border-[#2EFF7B] border-t-transparent rounded-full animate-spin mx-auto" />
                                </td>
                            </tr>
                        ) : logs.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="py-16 text-center text-[#4A6355]">No logs found</td>
                            </tr>
                        ) : (
                            logs.map((log) => (
                                <>
                                    <tr
                                        key={log.id}
                                        className="border-b border-[#111917] hover:bg-[#111917]/60 transition-colors cursor-pointer"
                                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                                    >
                                        <td className="px-5 py-3 text-[#4A6355] text-xs whitespace-nowrap">
                                            {new Date(log.created_at).toLocaleString()}
                                        </td>
                                        <td className="px-5 py-3 text-[#8BA89A] text-xs">
                                            {log.user_email || (log.user_id ? `#${log.user_id}` : "System")}
                                        </td>
                                        <td className="px-5 py-3">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[log.action] || "text-[#8BA89A] bg-[#1A2820]"}`}>
                                                {log.action}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-right text-[#4A6355] text-xs">
                                            {Object.keys(log.metadata).length > 0 ? (
                                                <span className="hover:text-[#8BA89A]">
                                                    {expandedId === log.id ? "▲ hide" : "▼ show"}
                                                </span>
                                            ) : "—"}
                                        </td>
                                    </tr>
                                    {expandedId === log.id && Object.keys(log.metadata).length > 0 && (
                                        <tr key={`${log.id}-expanded`} className="border-b border-[#111917] bg-[#0A0F0D]">
                                            <td colSpan={4} className="px-5 py-3">
                                                <pre className="text-xs text-[#8BA89A] font-mono overflow-x-auto">
                                                    {JSON.stringify(log.metadata, null, 2)}
                                                </pre>
                                            </td>
                                        </tr>
                                    )}
                                </>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm text-[#4A6355]">
                    <span>Page {page} of {totalPages} · {total} events</span>
                    <div className="flex gap-2">
                        <button
                            disabled={page === 1}
                            onClick={() => setPage(p => p - 1)}
                            className="px-3 py-1 rounded bg-[#111917] border border-[#1A2820] hover:border-[#2EFF7B]/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            ← Prev
                        </button>
                        <button
                            disabled={page === totalPages}
                            onClick={() => setPage(p => p + 1)}
                            className="px-3 py-1 rounded bg-[#111917] border border-[#1A2820] hover:border-[#2EFF7B]/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            Next →
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
