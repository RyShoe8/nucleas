'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { registerOsModules } from '@/components/os/modules/registerModules';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import { windowLabel } from '@/lib/os/windowLabel';
import { subscribePopoutSync } from '@/lib/os/popoutSync';
import WindowManagerProvider from '@/components/os/state/WindowManagerProvider';

registerOsModules();

interface WindowControlsOverlay {
    visible: boolean;
    addEventListener(type: 'geometrychange', listener: () => void): void;
    removeEventListener(type: 'geometrychange', listener: () => void): void;
}

function getWindowControlsOverlay(): WindowControlsOverlay | undefined {
    return (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay }).windowControlsOverlay;
}

function subscribeStandalone(onStoreChange: () => void) {
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener('change', onStoreChange);
    return () => mq.removeEventListener('change', onStoreChange);
}

function getStandaloneSnapshot() {
    return window.matchMedia('(display-mode: standalone)').matches;
}

function subscribeWcoVisible(onStoreChange: () => void) {
    const wco = getWindowControlsOverlay();
    if (!wco) return () => {};
    wco.addEventListener('geometrychange', onStoreChange);
    return () => wco.removeEventListener('geometrychange', onStoreChange);
}

function getWcoVisibleSnapshot() {
    return getWindowControlsOverlay()?.visible ?? false;
}

function usePopoutDisplayMode() {
    const standalone = useSyncExternalStore(subscribeStandalone, getStandaloneSnapshot, () => false);
    const wcoVisible = useSyncExternalStore(subscribeWcoVisible, getWcoVisibleSnapshot, () => false);
    return { standalone, wcoVisible };
}

export default function PopoutRoot() {
    const auth = useOsAuth();

    return (
        <WindowManagerProvider userId={auth.userId}>
            <Suspense fallback={<PopoutLoading />}>
                <PopoutContent />
            </Suspense>
        </WindowManagerProvider>
    );
}

function PopoutLoading() {
    return (
        <div className="min-h-screen bg-background text-text-secondary flex items-center justify-center text-sm">
            Loading module…
        </div>
    );
}

function PopoutContent() {
    const searchParams = useSearchParams();
    const windowId = searchParams.get('windowId');
    const wm = useWindowManager();
    const syncRef = useRef<ReturnType<typeof subscribePopoutSync> | null>(null);
    const { standalone, wcoVisible } = usePopoutDisplayMode();
    const [fullscreen, setFullscreen] = useState(false);

    useEffect(() => {
        syncRef.current = subscribePopoutSync(() => {});
        return () => syncRef.current?.close();
    }, []);

    useEffect(() => {
        const onBeforeUnload = () => {
            if (!windowId) return;
            syncRef.current?.publish({ type: 'POP_IN', windowId });
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [windowId]);

    useEffect(() => {
        const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, []);

    const target = useMemo(
        () => (windowId ? wm.windows.find((w) => w.id === windowId) : null),
        [wm.windows, windowId]
    );

    const moduleDefinition = target ? ModuleRegistry.get(target.moduleId) : null;

    const title = target ? windowLabel(target, moduleDefinition ?? undefined) : 'Module';

    useEffect(() => {
        document.title = title;
    }, [title]);

    const dockBack = useCallback(() => {
        if (!windowId) return;
        syncRef.current?.publish({ type: 'POP_IN', windowId });
        wm.popIn(windowId);
        window.close();
    }, [windowId, wm]);

    const closeModule = useCallback(() => {
        if (!windowId) return;
        syncRef.current?.publish({ type: 'CLOSE', windowId });
        wm.close(windowId);
        window.close();
    }, [windowId, wm]);

    const toggleFullscreen = useCallback(async () => {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await document.documentElement.requestFullscreen();
            }
        } catch {
            // Fullscreen may be blocked by browser policy.
        }
    }, []);

    if (!windowId) {
        return <PopoutError message="Missing windowId parameter." />;
    }

    if (!target) {
        if (wm.windows.length === 0) {
            return <PopoutLoading />;
        }
        return <PopoutError message="Module window not found. It may have been closed in the main workspace." />;
    }

    if (!moduleDefinition) {
        return <PopoutError message="Unknown module type." />;
    }

    const chromeless = standalone && wcoVisible && !fullscreen;
    const showCustomHeader = !chromeless && !fullscreen;
    const showAppClose = !wcoVisible;

    return (
        <div className="min-h-screen bg-background text-text-primary flex flex-col relative">
            {showCustomHeader && (
                <header className="flex-shrink-0 flex items-center bg-background-card border-b border-border select-none h-8 px-1">
                    <div className="popout-drag flex-1 flex items-center gap-2 min-w-0 h-full px-2">
                        <span className="text-xs opacity-80" aria-hidden>
                            {moduleDefinition.icon}
                        </span>
                        <span className="text-xs font-medium truncate">{title}</span>
                    </div>

                    <div className="popout-no-drag flex items-center h-full">
                        {!standalone && (
                            <TitleBarButton
                                label={fullscreen ? 'Exit borderless' : 'Enter borderless'}
                                onClick={toggleFullscreen}
                                className="hover:bg-background-elevated"
                            >
                                <BorderlessIcon active={fullscreen} />
                            </TitleBarButton>
                        )}
                        <TitleBarButton
                            label="Dock back to workspace"
                            onClick={dockBack}
                            className="hover:bg-background-elevated"
                        >
                            <DockBackIcon />
                        </TitleBarButton>
                        {showAppClose && (
                            <TitleBarButton
                                label="Close"
                                onClick={closeModule}
                                className="hover:bg-red-600 hover:text-white"
                            >
                                <CloseIcon />
                            </TitleBarButton>
                        )}
                    </div>
                </header>
            )}

            {chromeless && (
                <PopoutFloatingControls
                    onDockBack={dockBack}
                    onClose={showAppClose ? closeModule : undefined}
                />
            )}

            <main className="flex-1 min-h-0 overflow-auto">
                {moduleDefinition.render({
                    windowId: target.id,
                    moduleId: target.moduleId,
                    payload: target.payload,
                })}
            </main>
        </div>
    );
}

function PopoutFloatingControls({
    onDockBack,
    onClose,
}: {
    onDockBack: () => void;
    onClose?: () => void;
}) {
    return (
        <div className="popout-floating-controls popout-no-drag" role="toolbar" aria-label="Pop-out window controls">
            <TitleBarButton label="Dock back to workspace" onClick={onDockBack} className="hover:bg-background-elevated">
                <DockBackIcon />
            </TitleBarButton>
            {onClose && (
                <TitleBarButton label="Close" onClick={onClose} className="hover:bg-red-600 hover:text-white">
                    <CloseIcon />
                </TitleBarButton>
            )}
        </div>
    );
}

function TitleBarButton({
    label,
    onClick,
    className,
    children,
}: {
    label: string;
    onClick: () => void;
    className?: string;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className={`popout-no-drag w-11 h-8 inline-flex items-center justify-center text-text-secondary transition-colors ${className ?? ''}`}
        >
            {children}
        </button>
    );
}

function BorderlessIcon({ active }: { active: boolean }) {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="stroke-current fill-none">
            {active ? (
                <>
                    <rect x="1.5" y="3" width="7" height="6" strokeWidth="1" />
                    <path d="M3 1.5h4v1.5H3z" strokeWidth="1" />
                </>
            ) : (
                <rect x="1.5" y="1.5" width="7" height="7" strokeWidth="1" />
            )}
        </svg>
    );
}

function DockBackIcon() {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="stroke-current fill-none">
            <rect x="2" y="2" width="4.5" height="4.5" strokeWidth="1" />
            <path d="M4 5.5h4v2.5H4z" strokeWidth="1" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="stroke-current">
            <path d="M2 2l6 6M8 2l-6 6" strokeWidth="1.2" />
        </svg>
    );
}

function PopoutError({ message }: { message: string }) {
    return (
        <div className="min-h-screen bg-background text-error flex items-center justify-center p-6 text-sm text-center">
            {message}
        </div>
    );
}
