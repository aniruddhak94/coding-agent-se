"use client";
import { useEffect, useState, useCallback } from "react";
import { apiClient, AdminStatsResponse } from "@/lib/api";

interface StatCard {
    label: string;
    value: number;
    icon: string;
    color: string;
    description: string;
}

export default function AdminStatsPage() {
    const [stats, setStats] = useState<AdminStatsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const fetchStats = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await apiClient.getAdminStats();
            setStats(res);
        } catch (e: any) {
            setError(e.message || "Failed to load stats");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStats();
        // Auto-refresh every 30s
        const interval = setInterval(fetchStats, 30_000);
        return () => clearInterval(interval);
    }, [fetchStats]);

    const cards: StatCard[] = stats ? [
        {
            label: "Total Users",
            value: stats.total_users,
            icon: "👥",
            color: "border-[#2EFF7B]/30 bg-[#2EFF7B]/5",
            description: `${stats.active_users} active`,
        },
        {
            label: "Repositories",
            value: stats.total_repos,
            icon: "📁",
            color: "border-blue-500/30 bg-blue-500/5",
            description: "total imported",
        },
        {
            label: "Workspaces",
            value: stats.total_workspaces,
            icon: "🖥️",
            color: "border-purple-500/30 bg-purple-500/5",
            description: "total created",
        },
        {
            label: "Active Containers",
            value: stats.active_containers,
            icon: "🐳",
            color: "border-cyan-500/30 bg-cyan-500/5",
            description: "running now",
        },
    ] : [];

    return (
        <div className="p-8 text-[#E6F1EC]">
            {/* Header */}
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white mb-1">Stats</h1>
                    <p className="text-[#4A6355] text-sm">Auto-refreshes every 30 seconds</p>
                </div>
                <button
                    onClick={fetchStats}
                    disabled={loading}
                    className="px-4 py-2 bg-[#111917] border border-[#1A2820] rounded-lg text-sm text-[#8BA89A] hover:text-white hover:border-[#2EFF7B]/30 transition-colors disabled:opacity-50"
                >
                    {loading ? "Refreshing..." : "↻ Refresh"}
                </button>
            </div>

            {error && (
                <div className="mb-6 px-4 py-3 bg-red-900/20 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>
            )}

            {loading && !stats ? (
                <div className="flex items-center justify-center py-32">
                    <div className="w-8 h-8 border-2 border-[#2EFF7B] border-t-transparent rounded-full animate-spin" />
                </div>
            ) : (
                <>
                    {/* Stat cards */}
                    <div className="grid grid-cols-2 gap-4 mb-8">
                        {cards.map((card) => (
                            <div
                                key={card.label}
                                className={`bg-[#0D1210] border ${card.color} rounded-xl p-6 transition-all hover:scale-[1.01]`}
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <span className="text-3xl">{card.icon}</span>
                                    <span className="text-[#4A6355] text-xs">{card.description}</span>
                                </div>
                                <div className="text-4xl font-bold text-white mb-1">
                                    {card.value.toLocaleString()}
                                </div>
                                <div className="text-[#8BA89A] text-sm">{card.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Active Users ratio */}
                    {stats && (
                        <div className="bg-[#0D1210] border border-[#1A2820] rounded-xl p-6">
                            <h2 className="text-sm font-semibold text-[#8BA89A] uppercase tracking-wider mb-4">User Activity</h2>
                            <div className="flex items-center gap-4 mb-2">
                                <span className="text-sm text-[#4A6355]">Active users</span>
                                <span className="text-sm font-semibold text-white ml-auto">
                                    {stats.active_users} / {stats.total_users}
                                </span>
                                <span className="text-sm text-[#2EFF7B]">
                                    {stats.total_users > 0
                                        ? `${Math.round((stats.active_users / stats.total_users) * 100)}%`
                                        : "0%"}
                                </span>
                            </div>
                            <div className="w-full bg-[#1A2820] rounded-full h-2">
                                <div
                                    className="bg-[#2EFF7B] h-2 rounded-full transition-all"
                                    style={{
                                        width: stats.total_users > 0
                                            ? `${(stats.active_users / stats.total_users) * 100}%`
                                            : "0%",
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
