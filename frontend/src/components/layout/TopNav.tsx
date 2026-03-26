"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

export default function TopNav() {
    const [searchQuery, setSearchQuery] = useState("");
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const pathname = usePathname();
    const router = useRouter();
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const token = localStorage.getItem("auth_token");
        setIsLoggedIn(!!token);
    }, [pathname]);

    // Global keyboard shortcut (Cmd/Ctrl + K) to focus search
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                searchRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;
        const q = searchQuery.trim();
        // Route to the most relevant page based on current context
        if (pathname.startsWith('/workspace')) {
            router.push(`/workspace?search=${encodeURIComponent(q)}`);
        } else if (pathname.startsWith('/repository')) {
            router.push(`/repository?search=${encodeURIComponent(q)}`);
        } else {
            router.push(`/chat?q=${encodeURIComponent(q)}`);
        }
        setSearchQuery('');
    };

    const handleLogout = () => {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("refresh_token");
        setIsLoggedIn(false);
        setShowUserMenu(false);
        router.push("/login");
    };

    return (
        <header className="fixed top-0 left-0 right-0 h-16 bg-[#0B0F0E] border-b border-[#1F2D28] z-50">
            <div className="h-full flex items-center justify-between px-6 max-w-full">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-3 flex-shrink-0">
                    <div className="w-9 h-9 bg-[#2EFF7B] rounded-xl flex items-center justify-center">
                        <svg className="w-5 h-5 text-[#0B0F0E]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                    </div>
                    <div className="flex flex-col">
                        <span className="font-bold text-lg text-[#E6F1EC] tracking-tight">ICA</span>
                        <span className="text-[10px] text-[#5A7268] -mt-1 tracking-wider uppercase">Coding Agent</span>
                    </div>
                </Link>

                {/* Search */}
                <form onSubmit={handleSearch} className="flex-1 max-w-xl mx-8">
                    <div className="relative">
                        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5A7268]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            ref={searchRef}
                            type="text"
                            placeholder="Search chats, repos, workspaces..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-[#111917] text-[#E6F1EC] placeholder-[#5A7268] rounded-xl px-4 py-2.5 pl-11 pr-16 text-sm border border-[#1F2D28] focus:border-[#2EFF7B] focus:outline-none transition-colors"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 text-[10px] text-[#5A7268] bg-[#1A2420] rounded border border-[#1F2D28]">⌘K</kbd>
                        </div>
                    </div>
                </form>

                {/* Right Actions */}
                <div className="flex items-center gap-3 flex-shrink-0">

                    {/* Notifications */}
                    <button className="p-2 text-[#8FAEA2] hover:text-[#E6F1EC] hover:bg-[#111917] rounded-xl transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                    </button>

                    {/* Settings */}
                    <button className="p-2 text-[#8FAEA2] hover:text-[#E6F1EC] hover:bg-[#111917] rounded-xl transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </button>

                    {/* Divider */}
                    <div className="w-px h-8 bg-[#1F2D28]" />

                    {/* User */}
                    {isLoggedIn ? (
                        <div className="relative z-[100]">
                            <button
                                onClick={() => setShowUserMenu(!showUserMenu)}
                                className="flex items-center gap-2 p-1.5 hover:bg-[#111917] rounded-xl transition-colors"
                            >
                                <div className="w-8 h-8 bg-[#2EFF7B] rounded-lg flex items-center justify-center">
                                    <span className="text-[#0B0F0E] text-sm font-semibold">U</span>
                                </div>
                            </button>

                            {showUserMenu && (
                                <div className="absolute right-0 top-full mt-2 w-44 bg-[#111917] border border-[#1F2D28] rounded-xl shadow-2xl py-1 z-[100]">
                                    <Link
                                        href="/dashboard"
                                        onClick={() => setShowUserMenu(false)}
                                        className="block w-full px-4 py-2 text-sm text-[#8FAEA2] hover:text-[#E6F1EC] hover:bg-[#1A2420] text-left transition-colors"
                                    >
                                        Dashboard
                                    </Link>
                                    <button className="w-full px-4 py-2 text-sm text-[#8FAEA2] hover:text-[#E6F1EC] hover:bg-[#1A2420] text-left transition-colors">
                                        Settings
                                    </button>
                                    <hr className="my-1 border-[#1F2D28]" />
                                    <button onClick={handleLogout} className="w-full px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 text-left transition-colors">
                                        Sign out
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <Link href="/login" className="px-4 py-2 bg-[#2EFF7B] text-[#0B0F0E] text-sm font-semibold rounded-xl hover:bg-[#1ED760] transition-colors">
                            Sign in
                        </Link>
                    )}
                </div>
            </div>
        </header>
    );
}
