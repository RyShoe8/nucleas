'use client';

import { useEffect, useState } from 'react';
import { useWindowManager } from '@/hooks/os/useWindowManager';

interface ProjectSummary {
    _id: string;
    name: string;
    status?: string;
}

export default function ProjectsModule() {
    const wm = useWindowManager();
    const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const res = await fetch('/api/projects');
                if (!res.ok) {
                    if (!cancelled) setError(`HTTP ${res.status}`);
                    return;
                }
                const data = (await res.json()) as ProjectSummary[];
                if (!cancelled) setProjects(data);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'unknown');
            }
        }
        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const openProject = (project: ProjectSummary) => {
        wm.open('project-detail', {
            payload: {
                projectId: project._id,
                projectName: project.name,
            },
        });
    };

    if (error) {
        return (
            <div className="p-4 text-sm text-red-400">
                Failed to load projects: {error}
            </div>
        );
    }

    if (projects === null) {
        return <div className="p-4 text-sm text-zinc-500">Loading projects…</div>;
    }

    if (projects.length === 0) {
        return <div className="p-4 text-sm text-zinc-500">No projects yet.</div>;
    }

    return (
        <ul className="divide-y divide-zinc-800">
            {projects.map((p) => (
                <li key={p._id}>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            openProject(p);
                        }}
                        className="w-full px-4 py-2 hover:bg-background-card cursor-pointer flex items-center justify-between text-left"
                    >
                        <span className="text-sm text-zinc-100 truncate">{p.name}</span>
                        {p.status && (
                            <span className="text-[11px] text-zinc-500 uppercase tracking-wide ml-2 flex-shrink-0">
                                {p.status}
                            </span>
                        )}
                    </button>
                </li>
            ))}
        </ul>
    );
}
