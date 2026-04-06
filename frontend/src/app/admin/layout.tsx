"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

/** Decode JWT payload without a library (client-side only). */
function getJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(atob(base64));
    } catch {
        return null;
    }
}

const NAV_ITEMS = [
    { href: "/admin/users", label: "Users", icon: "👥" },
    { href: "/admin/stats", label: "Stats", icon: "📊" },
    { href: "/admin/logs",  label: "Logs",  icon: "📋" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const token = localStorage.getItem("auth_token");
        if (!token) { router.replace("/login"); return; }

        const payload = getJwtPayload(token);
        if (!payload || payload.role !== "admin") {
            router.replace("/dashboard");
            return;
        }
        setReady(true);
    }, [router]);

    if (!ready) {
        return (
            <div className="min-h-screen bg-[#0B0F0E] flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-[#2EFF7B] border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0B0F0E] flex" style={{ fontFamily: "'Inter', sans-serif" }}>
            {/* Sidebar */}
            <aside className="w-56 shrink-0 bg-[#0D1210] border-r border-[#1A2820] flex flex-col">
                <div className="px-5 py-6 border-b border-[#1A2820]">
                    <span className="text-[#2EFF7B] font-bold text-sm tracking-widest uppercase">ICA Admin</span>
                </div>
                <nav className="flex-1 py-4 space-y-1 px-3">
                    {NAV_ITEMS.map((item) => {
                        const active = pathname.startsWith(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                                    active
                                        ? "bg-[#2EFF7B]/10 text-[#2EFF7B] font-medium"
                                        : "text-[#8BA89A] hover:text-[#E6F1EC] hover:bg-[#111917]"
                                }`}
                            >
                                <span>{item.icon}</span>
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>
                <div className="px-5 py-4 border-t border-[#1A2820]">
                    <Link href="/dashboard" className="text-xs text-[#4A6355] hover:text-[#8BA89A] transition-colors">
                        ← Back to App
                    </Link>
                </div>
            </aside>

            {/* Main content */}
            <main className="flex-1 overflow-auto">
                {children}
            </main>
        </div>
    );
}
