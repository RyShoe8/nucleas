'use client';

import { useEffect, useState } from 'react';
import RecordingToolPanel from '@/components/shared/RecordingToolPanel';
import ScreenshotToolPanel from '@/components/shared/ScreenshotToolPanel';
import type { IProject } from '@/lib/models/Project';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import type { ModuleRenderContext } from '@/lib/os/types';
import { useRecordingUpload } from '@/hooks/useRecordingUpload';
import { setActiveCapture } from '@/lib/os/activeCapture';
import RecentCaptures from './workspace/RecentCaptures';

type Tool = 'screenshot' | 'recording' | 'recent';

const TOOLS: { id: Tool; label: string; icon: string; description: string }[] = [
    { id: 'screenshot', label: 'Screenshot', icon: '📸', description: 'Capture a window, region, or full webpage.' },
    { id: 'recording', label: 'Screen recorder', icon: '⏺️', description: 'Record your screen with system or microphone audio.' },
    { id: 'recent', label: 'Recent captures', icon: '▧', description: 'Your saved screenshots and recordings.' },
];

/** Capture and animation tools share the same desktop/web entry point. */
export default function ToolsModule({ payload, windowId = 'tools' }: Partial<ModuleRenderContext>) {
    const wm = useWindowManager();
    const recording = useRecordingUpload(null);
    const recordingActive = recording.isBusy || recording.isNaming;
    useEffect(() => { setActiveCapture(windowId, recordingActive); }, [windowId, recordingActive]);
    useEffect(() => () => setActiveCapture(windowId, false), [windowId]);
    const [active, setActive] = useState<Tool>(payload?.tool === 'recording' || payload?.tool === 'recent' ? payload.tool : 'screenshot');
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
                        Capture, create and animate media for your companies.
                    </p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3" aria-label="Animation tools">
                        {[
                            { tool: 'create', title: 'Animation Studio', detail: 'Create with your own artwork, rigs, layers and keyframes.' },
                            { tool: 'gif', title: 'GIF & video', detail: 'Export animations with dimensions, timing and transparency controls.' },
                            { tool: 'examples', title: 'Scene examples', detail: 'Explore Hyperdisc’s editable choreography and contact tools.' },
                        ].map(({ tool, title, detail }) => <button key={tool} type="button" onClick={() => wm.open('animation', { payload: { tool, ...(payload?.companyId ? { companyId: payload.companyId } : {}) } })} className="rounded-xl border border-border bg-background-elevated p-3 text-left hover:border-primary"><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs text-text-secondary">{detail}</span></button>)}
                    </div>
                </div>

                <div>{recordingActive && <button className="ui-button-primary" onClick={() => setActive('recording')}>● Recording · {recording.elapsedLabel} · Show controls</button>}</div>
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
                    {active === 'recent' ? <RecentCaptures /> : active === 'screenshot' ? (
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
                            recordingControl={recording}
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
