'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FileTree, CodeViewer, ContextPanel } from '../../components/repo';
import type { FileNode, ChunkResult } from '../../components/repo';

interface Repository {
    id: number;
    name: string;
    description?: string;
    file_count: number;
    indexed_at?: string;
}

interface FileData {
    id: number;
    name: string;
    path: string;
    size: number;
    language?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export default function RepositoryPage() {
    const [repositories, setRepositories] = useState<Repository[]>([]);
    const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
    const [files, setFiles] = useState<FileNode[]>([]);
    const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
    const [fileContent, setFileContent] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [searchResults, setSearchResults] = useState<ChunkResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showRepoDropdown, setShowRepoDropdown] = useState(false);
    const [showActionsDropdown, setShowActionsDropdown] = useState(false);

    const getToken = () => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('auth_token');
        }
        return null;
    };

    const fetchRepositories = useCallback(async () => {
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
            console.error('Failed to fetch repositories:', err);
        }
    }, []);

    const fetchFiles = useCallback(async (repoId: number) => {
        const token = getToken();
        if (!token) return;
        setIsLoading(true);
        try {
            const response = await fetch(`${API_BASE}/repo/${repoId}/files`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (response.ok) {
                const data = await response.json();
                const fileTree = buildFileTree(data.files || []);
                setFiles(fileTree);
            }
        } catch (err) {
            setError('Failed to load repository files');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const buildFileTree = (fileList: FileData[]): FileNode[] => {
        const root: FileNode[] = [];
        const pathMap = new Map<string, FileNode>();

        fileList.forEach((file) => {
            const parts = file.path.split('/');
            let currentPath = '';
            let currentLevel = root;

            parts.forEach((part, index) => {
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                const isFile = index === parts.length - 1;

                let node = pathMap.get(currentPath);
                if (!node) {
                    node = {
                        name: part,
                        path: currentPath,
                        type: isFile ? 'file' : 'folder',
                        language: isFile ? file.language : undefined,
                        children: isFile ? undefined : [],
                    };
                    pathMap.set(currentPath, node);
                    currentLevel.push(node);
                }
                if (!isFile && node.children) {
                    currentLevel = node.children;
                }
            });
        });
        return root;
    };

    const handleFileSelect = async (file: FileNode) => {
        if (file.type !== 'file' || !selectedRepo) return;
        setSelectedFile(file);
        const token = getToken();
        if (!token) return;
        try {
            const response = await fetch(
                `${API_BASE}/repo/${selectedRepo.id}/file?file_path=${encodeURIComponent(file.path)}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (response.ok) {
                const data = await response.json();
                setFileContent(data.content || '');
            }
        } catch (err) {
            setError('Failed to load file');
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim() || !selectedRepo) return;
        setIsSearching(true);
        const token = getToken();
        if (!token) return;
        try {
            const response = await fetch(
                `${API_BASE}/repo/${selectedRepo.id}/search?query=${encodeURIComponent(searchQuery)}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (response.ok) {
                const data = await response.json();
                setSearchResults(data.results || []);
            }
        } catch (err) {
            setError('Search failed');
        } finally {
            setIsSearching(false);
        }
    };

    const handleChunkClick = (chunk: ChunkResult) => {
        if (chunk.file_path) {
            const fileNode: FileNode = {
                name: chunk.file_name || 'Unknown',
                path: chunk.file_path,
                type: 'file',
            };
            handleFileSelect(fileNode);
        }
    };

    useEffect(() => {
        fetchRepositories();
    }, [fetchRepositories]);

    useEffect(() => {
        if (selectedRepo) {
            fetchFiles(selectedRepo.id);
            setSelectedFile(null);
            setFileContent('');
            setSearchResults([]);
        }
    }, [selectedRepo, fetchFiles]);

    return (
        <div className="h-screen flex flex-col bg-[#0B0F0E] text-[#E6F1EC] overflow-hidden">
            {/* Header Bar */}
            <div className="flex items-center gap-4 px-4 py-3 bg-[#111917] border-b border-[#1F2D28]">
                {/* Repository Dropdown */}
                <div className="relative">
                    <button
                        onClick={() => setShowRepoDropdown(!showRepoDropdown)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-[#1A2420] border border-[#1F2D28] rounded-xl text-sm hover:border-[#2EFF7B]/50 transition-colors min-w-[200px]"
                    >
                        <svg className="w-4 h-4 text-[#2EFF7B]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span className="flex-1 text-left truncate">
                            {selectedRepo ? selectedRepo.name : 'Select Repository'}
                        </span>
                        <svg className={`w-4 h-4 text-[#5A7268] transition-transform ${showRepoDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>

                    {showRepoDropdown && (
                        <div className="absolute top-full left-0 mt-2 w-72 bg-[#111917] border border-[#1F2D28] rounded-xl shadow-xl z-50 overflow-hidden">
                            <div className="p-2 border-b border-[#1F2D28]">
                                <div className="text-xs text-[#5A7268] uppercase tracking-wider px-2 py-1">Repositories</div>
                            </div>
                            <div className="max-h-64 overflow-y-auto">
                                {repositories.length === 0 ? (
                                    <div className="px-4 py-3 text-sm text-[#5A7268]">No repositories found</div>
                                ) : (
                                    repositories.map((repo) => (
                                        <button
                                            key={repo.id}
                                            onClick={() => {
                                                setSelectedRepo(repo);
                                                setShowRepoDropdown(false);
                                            }}
                                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#1A2420] transition-colors ${selectedRepo?.id === repo.id ? 'bg-[#2EFF7B]/10' : ''}`}
                                        >
                                            <div className="w-8 h-8 rounded-lg bg-[#1A2420] flex items-center justify-center">
                                                <svg className="w-4 h-4 text-[#2EFF7B]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                                </svg>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm text-[#E6F1EC] truncate">{repo.name}</div>
                                                <div className="text-xs text-[#5A7268]">{repo.file_count} files</div>
                                            </div>
                                            {selectedRepo?.id === repo.id && (
                                                <div className="w-2 h-2 rounded-full bg-[#2EFF7B]" />
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Actions Dropdown */}
                {selectedRepo && (
                    <div className="relative">
                        <button
                            onClick={() => setShowActionsDropdown(!showActionsDropdown)}
                            className="flex items-center gap-2 px-3 py-2.5 bg-[#1A2420] border border-[#1F2D28] rounded-xl text-sm hover:border-[#2EFF7B]/50 transition-colors"
                        >
                            <span className="text-[#8FAEA2]">Actions</span>
                            <svg className={`w-4 h-4 text-[#5A7268] transition-transform ${showActionsDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {showActionsDropdown && (
                            <div className="absolute top-full left-0 mt-2 w-48 bg-[#111917] border border-[#1F2D28] rounded-xl shadow-xl z-50 py-1">
                                <button
                                    onClick={async () => {
                                        if (!selectedRepo) return;
                                        const token = getToken();
                                        if (!token) return;
                                        setShowActionsDropdown(false);
                                        try {
                                            const res = await fetch(`${API_BASE}/repo/${selectedRepo.id}/reindex`, {
                                                method: 'POST',
                                                headers: { Authorization: `Bearer ${token}` },
                                            });
                                            if (res.ok) {
                                                setError(null);
                                                alert('Re-indexing started! RAG data will be updated shortly.');
                                            } else {
                                                setError('Failed to start re-indexing');
                                            }
                                        } catch (err) {
                                            setError('Failed to start re-indexing');
                                        }
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#8FAEA2] hover:text-[#E6F1EC] hover:bg-[#1A2420] transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Re-index for RAG
                                </button>
                                <button
                                    onClick={() => {
                                        setShowActionsDropdown(false);
                                        window.location.href = '/upload';
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#8FAEA2] hover:text-[#E6F1EC] hover:bg-[#1A2420] transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                    </svg>
                                    Upload Files
                                </button>
                                <hr className="my-1 border-[#1F2D28]" />
                                <button
                                    onClick={async () => {
                                        if (!selectedRepo) return;
                                        if (!confirm(`Delete repository "${selectedRepo.name}" and all its files? This cannot be undone.`)) return;
                                        const token = getToken();
                                        if (!token) return;
                                        setShowActionsDropdown(false);
                                        try {
                                            const res = await fetch(`${API_BASE}/repo/${selectedRepo.id}`, {
                                                method: 'DELETE',
                                                headers: { Authorization: `Bearer ${token}` },
                                            });
                                            if (res.ok || res.status === 204) {
                                                setRepositories(prev => prev.filter(r => r.id !== selectedRepo.id));
                                                setSelectedRepo(null);
                                                setFiles([]);
                                                setSelectedFile(null);
                                                setFileContent('');
                                            } else {
                                                setError('Failed to delete repository');
                                            }
                                        } catch (err) {
                                            setError('Failed to delete repository');
                                        }
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    Delete
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Search */}
                {selectedRepo && (
                    <div className="flex-1 max-w-md">
                        <div className="flex">
                            <input
                                type="text"
                                placeholder="Search code..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                className="flex-1 px-4 py-2.5 bg-[#1A2420] border border-[#1F2D28] rounded-l-xl text-sm text-[#E6F1EC] placeholder-[#5A7268] focus:border-[#2EFF7B] focus:outline-none transition-colors"
                            />
                            <button
                                onClick={handleSearch}
                                disabled={isSearching}
                                className="px-4 py-2.5 bg-[#2EFF7B] text-[#0B0F0E] font-medium rounded-r-xl hover:bg-[#1ED760] disabled:opacity-50 transition-colors"
                            >
                                {isSearching ? '...' : 'Search'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Main Content */}
            {selectedRepo ? (
                <div className="flex-1 grid grid-cols-1 lg:grid-cols-[250px_1fr_280px] min-h-0 overflow-hidden">
                    <div className="border-r border-[#1F2D28] overflow-y-auto">
                        <FileTree files={files} onFileSelect={handleFileSelect} selectedPath={selectedFile?.path} />
                    </div>
                    <div className="p-4 overflow-auto">
                        {selectedFile ? (
                            <CodeViewer code={fileContent} language={selectedFile.language} fileName={selectedFile.name} filePath={selectedFile.path} />
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-[#5A7268]">
                                <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <p className="text-sm">Select a file to view</p>
                            </div>
                        )}
                    </div>
                    <div className="border-l border-[#1F2D28] overflow-y-auto">
                        <ContextPanel chunks={searchResults} query={searchQuery || undefined} isLoading={isSearching} onChunkClick={handleChunkClick} />
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-[#5A7268]">
                    <div className="w-20 h-20 rounded-2xl bg-[#111917] border border-[#1F2D28] flex items-center justify-center mb-6">
                        <svg className="w-10 h-10 text-[#2EFF7B]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                    </div>
                    <h3 className="text-xl font-semibold text-[#E6F1EC] mb-2">No Repository Selected</h3>
                    <p className="text-sm">Select a repository from the dropdown to browse files</p>
                </div>
            )}

            {error && (
                <div className="fixed bottom-4 right-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3 text-red-400">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">×</button>
                </div>
            )}
        </div>
    );
}
