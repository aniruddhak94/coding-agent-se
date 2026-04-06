'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

interface UserData {
    id: number;
    email: string;
    full_name: string | null;
    role: string;
    is_active: boolean;
    created_at: string;
}

export default function DashboardPage() {
    const [user, setUser] = useState<UserData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const router = useRouter();

    useEffect(() => {
        const token = localStorage.getItem('auth_token');
        if (!token) {
            router.push('/login');
            return;
        }
        fetchUserData(token);
    }, [router]);

    const fetchUserData = async (token: string) => {
        try {
            const response = await fetch(`${API_BASE}/auth/me`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });

            if (response.ok) {
                const data = await response.json();
                setUser(data);
            } else if (response.status === 401) {
                // Token expired or invalid
                handleLogout();
            }
        } catch (error) {
            console.error('Failed to fetch user data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('refresh_token');
        router.push('/login');
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-10 h-10 border-2 border-[#2EFF7B] border-t-transparent rounded-full animate-spin" />
                    <p className="text-[#5A7268]">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen p-6 md:p-10">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-[#E6F1EC] mb-2">Dashboard</h1>
                    <p className="text-[#5A7268]">Manage your account and preferences</p>
                </div>

                <div className="grid gap-6">
                    {/* Profile Card */}
                    <div className="bg-[#111917] border border-[#1F2D28] rounded-2xl p-6 md:p-8">
                        <div className="flex flex-col md:flex-row md:items-center gap-6">
                            {/* Avatar */}
                            <div className="w-20 h-20 bg-gradient-to-br from-[#2EFF7B] to-[#1ED760] rounded-2xl flex items-center justify-center shadow-lg shadow-[#2EFF7B]/20">
                                <span className="text-3xl font-bold text-[#0B0F0E]">
                                    {user?.full_name?.[0] || user?.email?.[0]?.toUpperCase() || 'U'}
                                </span>
                            </div>

                            {/* Info */}
                            <div className="flex-1">
                                <h2 className="text-2xl font-bold text-[#E6F1EC] mb-1">
                                    {user?.full_name || 'User'}
                                </h2>
                                <p className="text-[#8FAEA2] mb-3">{user?.email}</p>
                                <div className="flex flex-wrap gap-2">
                                    <span className="px-3 py-1 bg-[#2EFF7B]/10 text-[#2EFF7B] text-sm font-medium rounded-lg border border-[#2EFF7B]/30">
                                        {user?.role?.toUpperCase() || 'USER'}
                                    </span>
                                    {user?.is_active && (
                                        <span className="px-3 py-1 bg-[#1A2420] text-[#8FAEA2] text-sm rounded-lg border border-[#1F2D28]">
                                            Active Account
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Quick Actions */}
                            <div className="flex flex-col gap-2">
                                <Link
                                    href="/chat"
                                    className="px-6 py-2.5 bg-[#2EFF7B] text-[#0B0F0E] font-semibold rounded-xl hover:bg-[#1ED760] transition-colors text-center"
                                >
                                    Go to Chat
                                </Link>
                                {user?.role === 'admin' && (
                                    <Link
                                        href="/admin"
                                        className="px-6 py-2.5 bg-[#2EFF7B]/10 border border-[#2EFF7B]/30 text-[#2EFF7B] font-semibold rounded-xl hover:bg-[#2EFF7B]/20 transition-colors text-center text-sm"
                                    >
                                        ⚙️ Admin Panel
                                    </Link>
                                )}
                                <button
                                    onClick={() => setShowLogoutConfirm(true)}
                                    className="px-6 py-2.5 bg-transparent border border-[#1F2D28] text-[#8FAEA2] font-medium rounded-xl hover:border-red-500/50 hover:text-red-400 transition-colors"
                                >
                                    Sign Out
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid md:grid-cols-3 gap-4">
                        <div className="bg-[#111917] border border-[#1F2D28] rounded-xl p-5">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 bg-[#1A2420] rounded-lg flex items-center justify-center">
                                    <svg className="w-5 h-5 text-[#2EFF7B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                </div>
                                <span className="text-sm text-[#5A7268]">Member Since</span>
                            </div>
                            <p className="text-lg font-semibold text-[#E6F1EC]">
                                {user?.created_at ? formatDate(user.created_at) : 'N/A'}
                            </p>
                        </div>

                        <div className="bg-[#111917] border border-[#1F2D28] rounded-xl p-5">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 bg-[#1A2420] rounded-lg flex items-center justify-center">
                                    <svg className="w-5 h-5 text-[#2EFF7B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                    </svg>
                                </div>
                                <span className="text-sm text-[#5A7268]">Chat Sessions</span>
                            </div>
                            <p className="text-lg font-semibold text-[#E6F1EC]">Coming Soon</p>
                        </div>

                        <div className="bg-[#111917] border border-[#1F2D28] rounded-xl p-5">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 bg-[#1A2420] rounded-lg flex items-center justify-center">
                                    <svg className="w-5 h-5 text-[#2EFF7B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                    </svg>
                                </div>
                                <span className="text-sm text-[#5A7268]">Repositories</span>
                            </div>
                            <p className="text-lg font-semibold text-[#E6F1EC]">Coming Soon</p>
                        </div>
                    </div>

                    {/* Quick Links */}
                    <div className="bg-[#111917] border border-[#1F2D28] rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-[#E6F1EC] mb-4">Quick Links</h3>
                        <div className="grid md:grid-cols-2 gap-3">
                            <Link
                                href="/chat"
                                className="flex items-center gap-3 p-4 bg-[#1A2420] rounded-xl hover:bg-[#1F2D28] transition-colors group"
                            >
                                <div className="w-10 h-10 bg-[#0B0F0E] rounded-lg flex items-center justify-center group-hover:bg-[#2EFF7B]/10 transition-colors">
                                    <svg className="w-5 h-5 text-[#2EFF7B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="font-medium text-[#E6F1EC]">Chat</p>
                                    <p className="text-sm text-[#5A7268]">Start a new conversation</p>
                                </div>
                            </Link>

                            <Link
                                href="/repository"
                                className="flex items-center gap-3 p-4 bg-[#1A2420] rounded-xl hover:bg-[#1F2D28] transition-colors group"
                            >
                                <div className="w-10 h-10 bg-[#0B0F0E] rounded-lg flex items-center justify-center group-hover:bg-[#2EFF7B]/10 transition-colors">
                                    <svg className="w-5 h-5 text-[#2EFF7B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="font-medium text-[#E6F1EC]">Repositories</p>
                                    <p className="text-sm text-[#5A7268]">Manage your code repos</p>
                                </div>
                            </Link>

                            <Link
                                href="/upload"
                                className="flex items-center gap-3 p-4 bg-[#1A2420] rounded-xl hover:bg-[#1F2D28] transition-colors group"
                            >
                                <div className="w-10 h-10 bg-[#0B0F0E] rounded-lg flex items-center justify-center group-hover:bg-[#2EFF7B]/10 transition-colors">
                                    <svg className="w-5 h-5 text-[#2EFF7B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="font-medium text-[#E6F1EC]">Upload</p>
                                    <p className="text-sm text-[#5A7268]">Upload files and documents</p>
                                </div>
                            </Link>

                            {user?.role === 'admin' && (
                                <Link
                                    href="/admin"
                                    className="flex items-center gap-3 p-4 bg-[#2EFF7B]/5 border border-[#2EFF7B]/20 rounded-xl hover:bg-[#2EFF7B]/10 hover:border-[#2EFF7B]/40 transition-colors group"
                                >
                                    <div className="w-10 h-10 bg-[#0B0F0E] rounded-lg flex items-center justify-center group-hover:bg-[#2EFF7B]/10 transition-colors">
                                        <svg className="w-5 h-5 text-[#2EFF7B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p className="font-medium text-[#2EFF7B]">Admin Panel</p>
                                        <p className="text-sm text-[#4A7A60]">Users, stats &amp; logs</p>
                                    </div>
                                </Link>
                            )}

                            <button
                                onClick={() => setShowLogoutConfirm(true)}
                                className="flex items-center gap-3 p-4 bg-[#1A2420] rounded-xl hover:bg-red-500/10 transition-colors group text-left"
                            >
                                <div className="w-10 h-10 bg-[#0B0F0E] rounded-lg flex items-center justify-center group-hover:bg-red-500/10 transition-colors">
                                    <svg className="w-5 h-5 text-[#8FAEA2] group-hover:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                    </svg>
                                </div>
                                <div>
                                    <p className="font-medium text-[#E6F1EC] group-hover:text-red-400">Sign Out</p>
                                    <p className="text-sm text-[#5A7268]">Logout from your account</p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Logout Confirmation Modal */}
            {showLogoutConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-[#111917] border border-[#1F2D28] rounded-2xl p-6 max-w-sm w-full animate-fadeIn shadow-2xl">
                        <div className="text-center">
                            <div className="w-14 h-14 mx-auto mb-4 bg-red-500/10 rounded-full flex items-center justify-center">
                                <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-semibold text-[#E6F1EC] mb-2">Sign Out?</h3>
                            <p className="text-[#5A7268] mb-6">Are you sure you want to sign out of your account?</p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowLogoutConfirm(false)}
                                    className="flex-1 py-2.5 bg-[#1A2420] text-[#8FAEA2] font-medium rounded-xl hover:bg-[#1F2D28] transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleLogout}
                                    className="flex-1 py-2.5 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-colors"
                                >
                                    Sign Out
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
