'use client';

import { useWindowManager } from '@/hooks/os/useWindowManager';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import { windowLabel } from '@/lib/os/windowLabel';

export default function WindowsTray() {
    const wm = useWindowManager();

    return (
        <footer className="relative z-10 h-14 flex-shrink-0 flex items-center gap-2 px-3 border-t border-border bg-background overflow-x-auto">
            {wm.windows.length === 0 ? (
                <span className="text-xs text-text-muted">No open modules. Use the Modules menu or press ⌘K.</span>
            ) : (
                wm.windows.map((w) => {
                    const mod = ModuleRegistry.get(w.moduleId);
                    const label = windowLabel(w, mod);
                    const isActive = wm.activeWindowId === w.id && !w.minimized;
                    return (
                        <button
                            key={w.id}
                            type="button"
                            onClick={() => {
                                if (w.poppedOut) {
                                    wm.focusPopout(w.id);
                                    return;
                                }
                                if (w.minimized) wm.restore(w.id);
                                else wm.focus(w.id);
                            }}
                            className={`flex items-center gap-2 h-9 px-3 rounded border text-xs transition-colors ${
                                isActive
                                    ? 'bg-primary/20 border-primary/40 text-text-primary'
                                    : w.minimized
                                      ? 'bg-background-elevated border-border text-text-muted hover:text-text-secondary'
                                      : 'bg-background-elevated border-border text-text-secondary hover:bg-background-card'
                            }`}
                            aria-pressed={isActive}
                        >
                            <span aria-hidden>{mod?.icon ?? '•'}</span>
                            <span className="truncate max-w-[140px]">{label}</span>
                            {w.minimized && <span className="text-[10px] text-text-muted">min</span>}
                            {w.poppedOut && <span className="text-[10px] text-text-muted">pop</span>}
                        </button>
                    );
                })
            )}
        </footer>
    );
}
