"use client";
import { useEffect, useState, useCallback } from "react";
import { apiClient, AdminUser } from "@/lib/api";

type Action = "ban" | "unban" | "promote" | "demote" | "delete";

export default function AdminUsersPage() {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<number | null>(null);
    const [error, setError] = useState("");
    const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);
    const LIMIT = 20;

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await apiClient.getAdminUsers({ search, page, limit: LIMIT });
            setUsers(res.users);
            setTotal(res.total);
        } catch (e: any) {
            setError(e.message || "Failed to load users");
        } finally {
            setLoading(false);
        }
    }, [search, page]);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const act = async (userId: number, action: Action) => {
        setActionLoading(userId);
        try {
            if (action === "ban") await apiClient.banUser(userId, true);
            else if (action === "unban") await apiClient.banUser(userId, false);
            else if (action === "promote") await apiClient.changeUserRole(userId, "admin");
            else if (action === "demote") await apiClient.changeUserRole(userId, "user");
            else if (action === "delete") {
                await apiClient.deleteAdminUser(userId);
                setConfirmDelete(null);
            }
            await fetchUsers();
        } catch (e: any) {
            setError(e.message || "Action failed");
        } finally {
            setActionLoading(null);
        }
    };

    const totalPages = Math.ceil(total / LIMIT);

    return (
        <div className="p-8 text-[#E6F1EC]">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-white mb-1">Users</h1>
                <p className="text-[#4A6355] text-sm">{total} total users</p>
            </div>

            {/* Search */}
            <div className="mb-6 flex gap-3">
                <input
                    type="text"
                    placeholder="Search by email..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
                    className="bg-[#111917] border border-[#1F2D28] rounded-lg px-4 py-2 text-sm text-[#E6F1EC] placeholder-[#4A6355] focus:outline-none focus:border-[#2EFF7B]/50 w-80"
                />
                <button
                    onClick={() => { setSearch(searchInput); setPage(1); }}
                    className="px-4 py-2 bg-[#2EFF7B] text-[#0B0F0E] rounded-lg text-sm font-semibold hover:bg-[#25CC62] transition-colors"
                >
                    Search
                </button>
                {search && (
                    <button
                        onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}
                        className="px-4 py-2 bg-[#111917] border border-[#1F2D28] text-[#8BA89A] rounded-lg text-sm hover:text-white transition-colors"
                    >
                        Clear
                    </button>
                )}
            </div>

            {error && (
                <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>
            )}

            {/* Table */}
            <div className="bg-[#0D1210] border border-[#1A2820] rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-[#1A2820] text-[#4A6355] text-xs uppercase tracking-wider">
                            <th className="text-left px-5 py-3">Email</th>
                            <th className="text-left px-5 py-3">Name</th>
                            <th className="text-left px-5 py-3">Role</th>
                            <th className="text-left px-5 py-3">Status</th>
                            <th className="text-left px-5 py-3">Joined</th>
                            <th className="text-right px-5 py-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={6} className="py-16 text-center text-[#4A6355]">
                                    <div className="w-6 h-6 border-2 border-[#2EFF7B] border-t-transparent rounded-full animate-spin mx-auto" />
                                </td>
                            </tr>
                        ) : users.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="py-16 text-center text-[#4A6355]">No users found</td>
                            </tr>
                        ) : (
                            users.map((user) => (
                                <tr key={user.id} className="border-b border-[#111917] hover:bg-[#111917]/60 transition-colors">
                                    <td className="px-5 py-3 font-medium text-[#E6F1EC]">{user.email}</td>
                                    <td className="px-5 py-3 text-[#8BA89A]">{user.full_name || "—"}</td>
                                    <td className="px-5 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                            user.role === "admin"
                                                ? "bg-[#2EFF7B]/10 text-[#2EFF7B]"
                                                : "bg-[#1A2820] text-[#8BA89A]"
                                        }`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                            user.is_active
                                                ? "bg-emerald-900/30 text-emerald-400"
                                                : "bg-red-900/30 text-red-400"
                                        }`}>
                                            {user.is_active ? "Active" : "Banned"}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-[#4A6355] text-xs">
                                        {new Date(user.created_at).toLocaleDateString()}
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {actionLoading === user.id ? (
                                                <div className="w-4 h-4 border-2 border-[#2EFF7B] border-t-transparent rounded-full animate-spin" />
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => act(user.id, user.is_active ? "ban" : "unban")}
                                                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                                                            user.is_active
                                                                ? "bg-orange-900/30 text-orange-400 hover:bg-orange-900/50"
                                                                : "bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50"
                                                        }`}
                                                    >
                                                        {user.is_active ? "Ban" : "Unban"}
                                                    </button>
                                                    <button
                                                        onClick={() => act(user.id, user.role === "admin" ? "demote" : "promote")}
                                                        className="px-2.5 py-1 rounded text-xs font-medium bg-[#1A2820] text-[#8BA89A] hover:text-white transition-colors"
                                                    >
                                                        {user.role === "admin" ? "Demote" : "Promote"}
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmDelete(user)}
                                                        className="px-2.5 py-1 rounded text-xs font-medium bg-red-900/20 text-red-400 hover:bg-red-900/40 transition-colors"
                                                    >
                                                        Delete
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm text-[#4A6355]">
                    <span>Page {page} of {totalPages}</span>
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

            {/* Delete confirmation modal */}
            {confirmDelete && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-[#0D1210] border border-[#1A2820] rounded-xl p-6 w-96">
                        <h3 className="text-white font-semibold mb-2">Delete User</h3>
                        <p className="text-[#8BA89A] text-sm mb-6">
                            This will permanently delete <strong className="text-white">{confirmDelete.email}</strong> and all their data.
                            This action cannot be undone.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setConfirmDelete(null)}
                                className="px-4 py-2 rounded-lg text-sm bg-[#111917] text-[#8BA89A] hover:text-white border border-[#1A2820] transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => act(confirmDelete.id, "delete")}
                                className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 transition-colors font-medium"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
