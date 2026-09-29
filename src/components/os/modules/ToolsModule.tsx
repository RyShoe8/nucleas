'use client';

import { useEffect, useState } from 'react';
import RecordingToolPanel from '@/components/shared/RecordingToolPanel';
import ScreenshotToolPanel from '@/components/shared/ScreenshotToolPanel';
import type { IProject } from '@/lib/models/Project';

type Tool = 'screenshot' | 'recording';

const TOOLS: { id: Tool; label: string; icon: string; description: string }[] = [
    { id: 'screenshot', label: 'Screenshot', icon: '📸', description: 'Capture a window, region, or full webpage.' },
    { id: 'recording', label: 'Screen recorder', icon: '⏺️', description: 'Record your screen with system or microphone audio.' },
];

/** Built-in capture tools, available directly from the OS module launcher. */
export default function ToolsModule() {
    const [active, setActive] = useState<Tool>('screenshot');
    const [projects, setProjects] = useState<IProject[]>([]);
    const [projectError, setProjectError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        void fetch('/api/projects', { cache: 'no-store', signal: controller.signal })
            .then(async (response) => {
                const body = await response.json().catch(() => []);
                if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Failed (${response.status})`);
                if (!controller.signal.aborted) setProjects(Array.isArray(body) ? body : []);
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) setProjectError(error instanceof Error ? error.message : 'Projects could not be loaded.');
            });
        return () => controller.abort();
    }, []);

    return (
        <div className="h-full overflow-y-auto p-4 text-text-primary">
            <div className="mx-auto max-w-2xl space-y-4">
                <div>
                    <h2 className="text-base font-semibold">Tools</h2>
                    <p className="mt-1 text-xs text-text-secondary">
                        Capture locally or save media to Nucleas and attach it to your work.
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Capture tools">
                    {TOOLS.map((tool) => (
                        <button
                            key={tool.id}
                            type="button"
                            role="tab"
                            aria-selected={active === tool.id}
                            onClick={() => setActive(tool.id)}
                            className={`rounded-lg border p-3 text-left transition-colors ${
                                active === tool.id
                                    ? 'border-primary bg-primary/10'
                                    : 'border-border bg-background-elevated hover:bg-background-card'
                            }`}
                        >
                            <span className="mr-2" aria-hidden>{tool.icon}</span>
                            <span className="text-sm font-medium">{tool.label}</span>
                            <span className="mt-1 block text-[11px] text-text-secondary">{tool.description}</span>
                        </button>
                    ))}
                </div>

                {projectError ? (
                    <p className="rounded border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
                        Project links are temporarily unavailable: {projectError} You can still capture and download media.
                    </p>
                ) : null}

                <section role="tabpanel" className="rounded-lg border border-border bg-background-elevated p-4">
                    {active === 'screenshot' ? (
                        <ScreenshotToolPanel
                            key="screenshot"
                            target={null}
                            projects={projects}
                            allowAssignment
                            description="Choose a capture method, then save it to Nucleas, attach it to work, or download it."
                        />
                    ) : (
                        <RecordingToolPanel
                            key="recording"
                            target={null}
                            projects={projects}
                            allowAssignment
                            description="Choose an audio source, share your screen, then save the recording to Nucleas or download it."
                        />
                    )}
                </section>
            </div>
        </div>
    );
}
