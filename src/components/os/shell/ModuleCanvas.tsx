'use client';

import styles from './DesktopShell.module.css';

import { useWindowManager } from '@/hooks/os/useWindowManager';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import { AppLauncherPanel } from './ModuleLauncher';
import FloatingWindow from '../windows/FloatingWindow';

export default function ModuleCanvas() {
    const wm = useWindowManager();
    const canvasWindows = wm.windows.filter((w) => !w.poppedOut);
    const visibleWindows = canvasWindows.filter((w) => !w.minimized);

    if (wm.windows.length === 0) {
        return (
            <div className="absolute inset-0 flex overflow-auto p-4 sm:p-6">
                <div className={styles.welcome}><AppLauncherPanel /></div>
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
