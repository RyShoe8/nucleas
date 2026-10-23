'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import VoiceProvider from '@/components/voice/VoiceProvider';
import VoiceOverlay from '@/components/voice/VoiceOverlay';
import { IntentConfirmationProvider } from '@/components/intent/IntentConfirmationContext';
import CommandPalette from '@/components/workspace/CommandPalette';
import CommandRegistry from '@/lib/commands/CommandRegistry';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import type { ParsedIntent } from '@/lib/voice/IntentParser';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { buildOsVoiceContext } from './voice/buildOsVoiceContext';
import { registerOsModules } from './modules/registerModules';
import { registerOsCommands } from './commands/registerOsCommands';
import WindowManagerProvider from './state/WindowManagerProvider';
import OsShell from './shell/OsShell';
import { OsInstallProvider } from './shell/OsInstallProvider';
import { OsCommandPaletteProvider } from './shell/OsCommandPaletteContext';
import { warmPopoutScreenCache } from '@/lib/os/popoutPlacement';
import { registerOsServiceWorker } from '@/lib/os/pwaServiceWorker';

// Register modules once at module load so the registry is ready before any
// render. `registerOsModules` itself is idempotent.
registerOsModules();

interface OsRootProps {
    children?: ReactNode;
}

export default function OsRoot({ children }: OsRootProps) {
    const auth = useOsAuth();

    useEffect(() => {
        void registerOsServiceWorker();
        warmPopoutScreenCache().catch(() => {});
    }, []);

    return (
        <WindowManagerProvider userId={auth.userId}>
            <OsInstallProvider>
                <OsIntentLayer>
                    <OsShell>{children}</OsShell>
                </OsIntentLayer>
            </OsInstallProvider>
        </WindowManagerProvider>
    );
}

/**
 * Inner layer that wires intent confirmation + voice. Must live inside
 * WindowManagerProvider so it can read window state for voice context.
 */
function OsIntentLayer({ children }: { children: ReactNode }) {
    const auth = useOsAuth();
    const wm = useWindowManager();
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [paletteNlError, setPaletteNlError] = useState<string | null>(null);

    // Keep the latest window-manager handle on a ref so stable callbacks
    // (voice, command palette, registered commands) can read fresh state
    // without re-binding their identity every render.
    const wmRef = useRef(wm);
    useEffect(() => {
        wmRef.current = wm;
    }, [wm]);

    const getOsVoiceContext = useCallback(() => {
        const current = wmRef.current;
        return buildOsVoiceContext({
            openModuleIds: current.windows.map((w) => w.moduleId),
            focusedModuleId: current.activeWindow?.moduleId ?? null,
            focusedWindowId: current.activeWindowId,
        });
    }, []);

    const handleOsIntent = useCallback((intent: ParsedIntent) => {
        const current = wmRef.current;

        if (intent.type === 'RUN_COMMAND') {
            const id = intent.slots.commandId;
            if (id && CommandRegistry.execute(id)) {
                return { success: true, message: `Ran command ${id}` };
            }
            return { success: false, message: 'Command not found' };
        }

        if (intent.type === 'NAVIGATE') {
            const target = (intent.slots.target || intent.slots.destination || intent.slots.place || '').toLowerCase();
            if (!target) {
                return { success: false, message: 'No navigation target' };
            }
            const mod = ModuleRegistry.list().find((m) =>
                target.includes(m.id.toLowerCase()) ||
                target.includes(m.title.toLowerCase())
            );
            if (mod) {
                current.open(mod.id);
                return { success: true, message: `Opened ${mod.title}` };
            }
            return { success: false, message: `No module matches "${target}"` };
        }

        return {
            success: false,
            message: 'OS Phase 1 cannot execute that yet. Try opening a module or running a command.',
        };
    }, []);

    const onPaletteExecuted = useCallback(
        (r: { success: boolean; message: string }) => {
            setPaletteNlError(r.success ? null : r.message);
        },
        []
    );

    const openPalette = useCallback(() => {
        setPaletteOpen(true);
        setPaletteNlError(null);
    }, []);

    const togglePalette = useCallback(() => {
        setPaletteOpen((open) => {
            if (!open) setPaletteNlError(null);
            return !open;
        });
    }, []);

    useEffect(() => {
        if (!auth.isAdmin) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                togglePalette();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [auth.isAdmin, togglePalette]);

    useEffect(() => {
        const cleanup = registerOsCommands({
            openModule: (id) => wmRef.current.open(id),
            focusNextWindow: () => {
                const list = wmRef.current.windows.filter((w) => !w.minimized);
                if (list.length === 0) return;
                const activeIdx = list.findIndex((w) => w.id === wmRef.current.activeWindowId);
                const next = list[(activeIdx + 1) % list.length];
                wmRef.current.focus(next.id);
            },
            closeAll: () => {
                wmRef.current.windows.forEach((w) => wmRef.current.close(w.id));
            },
            resetLayout: () => wmRef.current.resetLayout(),
            openPalette,
        });
        return cleanup;
    }, [openPalette]);

    // Recompute the palette's context payload whenever the underlying window
    // state changes. Reads `wm` directly (not the ref) so React tracks the dep.
    const voiceContextSnapshot = useMemo(
        () =>
            buildOsVoiceContext({
                openModuleIds: wm.windows.map((w) => w.moduleId),
                focusedModuleId: wm.activeWindow?.moduleId ?? null,
                focusedWindowId: wm.activeWindowId,
            }),
        [wm.windows, wm.activeWindow, wm.activeWindowId]
    );

    return (
        <IntentConfirmationProvider executeIntent={handleOsIntent} onExecuted={onPaletteExecuted}>
            <VoiceProvider
                isPlatformAdmin={auth.isAdmin}
                getWorkspaceContext={getOsVoiceContext}
            >
                <OsCommandPaletteProvider
                    openCommandPalette={openPalette}
                    toggleCommandPalette={togglePalette}
                >
                    {children}
                </OsCommandPaletteProvider>
                {auth.isAdmin ? (
                <CommandPalette
                    isOpen={paletteOpen}
                    onClose={() => setPaletteOpen(false)}
                    workspaceIntentContext={voiceContextSnapshot}
                    nlError={paletteNlError}
                />
                ) : null}
                <VoiceOverlay />
            </VoiceProvider>
        </IntentConfirmationProvider>
    );
}
