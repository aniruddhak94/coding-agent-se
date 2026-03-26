"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";

const navItems = [
    { icon: "💬", label: "Chat", href: "/chat" },
    { icon: "▶️", label: "Execution", href: "/execute" },
    { icon: "📁", label: "Repository", href: "/repository" },
    { icon: "🖥️", label: "Workspace", href: "/workspace" },
    { icon: "📤", label: "Upload", href: "/upload" },
];

export interface RecentChat {
    id: string;
    title: string;
    timestamp: number;
}

/** Reads recent chats from localStorage (stored by the chat page). */
function loadRecentChats(): RecentChat[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem("recent_chats");
        if (!raw) return [];
        return JSON.parse(raw) as RecentChat[];
    } catch {
        return [];
    }
}

export default function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [recentChats, setRecentChats] = useState<RecentChat[]>([]);

    // Load on mount and refresh when pathname changes (new chat created)
    useEffect(() => {
        setRecentChats(loadRecentChats().slice(0, 5));
    }, [pathname]);

    // Also listen for storage events so sidebar updates across tabs
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === "recent_chats") {
                setRecentChats(loadRecentChats().slice(0, 5));
            }
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    return (
        <>
            {/* Mobile Toggle Button */}
            <button
                onClick={() => setIsMobileOpen(!isMobileOpen)}
                className="fixed top-4 left-4 z-50 md:hidden w-10 h-10 bg-[#111917] border border-[#1F2D28] rounded-xl flex items-center justify-center"
            >
                <svg className="w-5 h-5 text-[#2EFF7B]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {isMobileOpen ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    )}
                </svg>
            </button>

            {/* Mobile Overlay */}
            {isMobileOpen && (
                <div
                    className="fixed inset-0 bg-black/60 z-30 md:hidden"
                    onClick={() => setIsMobileOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`fixed left-0 top-14 h-[calc(100vh-3.5rem)] w-56 bg-[#111917] border-r border-[#1F2D28] flex flex-col z-40 transition-transform duration-300 ${isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
                {/* New Chat */}
                <div className="p-4">
                    <Link
                        href="/chat"
                        className="flex items-center justify-center gap-2 w-full py-3 bg-[#2EFF7B] hover:bg-[#1ED760] text-[#0B0F0E] font-semibold rounded-xl transition-colors"
                        onClick={() => setIsMobileOpen(false)}
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        New Chat
                    </Link>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 overflow-y-auto">
                    <div className="text-xs font-medium text-[#5A7268] uppercase tracking-wider px-3 mb-2">Navigation</div>
                    <ul className="space-y-1">
                        {navItems.map((item) => {
                            const isActive = pathname === item.href;
                            return (
                                <li key={item.href}>
                                    <Link
                                        href={item.href}
                                        onClick={() => setIsMobileOpen(false)}
                                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${isActive
                                                ? "bg-[#2EFF7B]/10 text-[#2EFF7B] border border-[#2EFF7B]/30"
                                                : "text-[#8FAEA2] hover:text-[#E6F1EC] hover:bg-[#1A2420]"
                                            }`}
                                    >
                                        <span className="text-base">{item.icon}</span>
                                        <span>{item.label}</span>
                                        {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#2EFF7B]" />}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>

                    {/* Recent Chats - dynamic from localStorage */}
                    <div className="mt-6">
                        <div className="text-xs font-medium text-[#5A7268] uppercase tracking-wider px-3 mb-2">Recent</div>
                        {recentChats.length === 0 ? (
                            <p className="px-3 text-xs text-[#3D5249] italic">No recent chats</p>
                        ) : (
                            <ul className="space-y-1">
                                {recentChats.map((chat) => (
                                    <li key={chat.id}>
                                        <button
                                            onClick={() => {
                                                setIsMobileOpen(false);
                                                router.push(`/chat?session=${chat.id}`);
                                            }}
                                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[#8FAEA2] hover:text-[#E6F1EC] hover:bg-[#1A2420] rounded-xl transition-colors text-left"
                                        >
                                            <span className="w-1.5 h-1.5 rounded-full bg-[#5A7268] flex-shrink-0" />
                                            <span className="truncate">{chat.title}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </nav>

                {/* Footer */}
                <div className="p-4 border-t border-[#1F2D28]">
                    <div className="flex items-center justify-between text-xs text-[#5A7268]">
                        <span>ICA v1.0</span>
                        <span className="px-2 py-0.5 bg-[#1A2420] rounded-lg">Phase 4</span>
                    </div>
                </div>
            </aside>
        </>
    );
}
