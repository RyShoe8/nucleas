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
                <div className="max-w-md text-zinc-500">
                    <p className="text-lg text-zinc-300 font-medium">Empty workspace</p>
                    <p className="mt-2 text-sm">
                        Tap ＋ in the top bar to open a module<span className="hidden sm:inline">, or press ⌘K / Ctrl+K to launch one with the command palette</span>.
                    </p>
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
