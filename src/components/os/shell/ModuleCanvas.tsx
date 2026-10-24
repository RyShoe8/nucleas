'use client';

import { useWindowManager } from '@/hooks/os/useWindowManager';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import FloatingWindow from '../windows/FloatingWindow';

export default function ModuleCanvas() {
    const wm = useWindowManager();
    const canvasWindows = wm.windows.filter((w) => !w.poppedOut);
    const visibleWindows = canvasWindows.filter((w) => !w.minimized);

    if (wm.windows.length === 0) {
        return (
            <div className="absolute inset-0 flex items-center justify-center text-center px-6">
                <div className="max-w-lg text-text-secondary">
                    <h1 className="text-xl text-text-primary font-medium">What would you like to work on?</h1>
                    <p className="mt-2 text-sm">Start with a company, review work in progress, or create content.</p>
                    <div className="mt-5 grid gap-2 text-left sm:grid-cols-3">
                        {[{ id: 'companies', title: 'Companies', hint: 'Your businesses, accounts and setup' }, { id: 'jobs', title: 'All jobs', hint: 'Running work and items needing review' }, { id: 'content', title: 'Content', hint: 'Write articles and update posts' }].map(item => (
                            <button key={item.id} type="button" onClick={() => wm.open(item.id)} className="ui-card-interactive p-4">
                                <span className="block text-sm font-medium text-text-primary">{item.title}</span>
                                <span className="mt-1 block text-xs">{item.hint}</span>
                            </button>
                        ))}
                    </div>
                    <p className="mt-4 text-xs">Use Apps in the top bar for other tools.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="absolute inset-0">
            {visibleWindows.map((w) => {
                const mod = ModuleRegistry.get(w.moduleId);
                if (!mod) return null;
                return (
                    <FloatingWindow key={w.id} window={w} module={mod}>
                        {mod.render({ windowId: w.id, moduleId: w.moduleId, payload: w.payload })}
                    </FloatingWindow>
                );
            })}
        </div>
    );
}
