'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { initialLayout, windowReducer } from '@/lib/os/windowManager';
import { loadOsState, saveOsState } from '@/lib/os/persistence';
import { focusPopoutWindow, openPopoutWindow } from '@/lib/os/popout';
import { subscribePopoutSync } from '@/lib/os/popoutSync';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import type { OpenWindowOptions, PersistedOsState } from '@/lib/os/types';
import {
    clampLayoutWindows,
    getOsCanvasBounds,
    payloadsMatch,
} from '@/lib/os/viewportBounds';
import { WindowManagerContext, type PopOutOptions, type WindowManagerContextValue } from './windowManagerContext';

const SAVE_DEBOUNCE_MS = 300;

interface WindowManagerProviderProps {
    children: ReactNode;
    userId: string | null;
}

export default function WindowManagerProvider({ children, userId }: WindowManagerProviderProps) {
    const [layout, dispatch] = useReducer(windowReducer, initialLayout);
    const hydratedRef = useRef(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const layoutRef = useRef(layout);
    const popoutRefs = useRef<Map<string, globalThis.Window>>(new Map());
    useLayoutEffect(() => {
        layoutRef.current = layout;
    }, [layout]);

    useEffect(() => {
        const persisted = loadOsState(userId);
        if (persisted.layout.windows.length > 0 || persisted.layout.nextZIndex > initialLayout.nextZIndex) {
            const clampedWindows = clampLayoutWindows(
                persisted.layout.windows,
                getOsCanvasBounds()
            );
            dispatch({
                type: 'HYDRATE',
                layout: { ...persisted.layout, windows: clampedWindows },
            });
        }
        hydratedRef.current = true;
    }, [userId]);

    useEffect(() => {
        const sync = subscribePopoutSync((message) => {
            if (message.type === 'POP_IN') {
                dispatch({ type: 'POP_IN', windowId: message.windowId });
                popoutRefs.current.delete(message.windowId);
            } else if (message.type === 'CLOSE') {
                popoutRefs.current.get(message.windowId)?.close();
                popoutRefs.current.delete(message.windowId);
                dispatch({ type: 'CLOSE', windowId: message.windowId });
            }
        });
        return () => sync.close();
    }, []);

    useEffect(() => {
        const onResize = () => {
            const current = layoutRef.current;
            if (current.windows.length === 0) return;
            const clamped = clampLayoutWindows(current.windows, getOsCanvasBounds());
            const changed = clamped.some((w, i) => {
                const prev = current.windows[i];
                return (
                    w.x !== prev.x ||
                    w.y !== prev.y ||
                    w.width !== prev.width ||
                    w.height !== prev.height
                );
            });
            if (changed) {
                dispatch({ type: 'CLAMP_WINDOWS', windows: clamped });
            }
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
        if (!hydratedRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            const next: PersistedOsState = {
                schemaVersion: 1,
                workspaceId: 'default',
                layout,
                ui: {},
            };
            saveOsState(userId, next);
        }, SAVE_DEBOUNCE_MS);
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, [layout, userId]);

    const open = useCallback((moduleId: string, options?: OpenWindowOptions): string | null => {
        const mod = ModuleRegistry.get(moduleId);
        if (!mod) {
            console.warn(`[OS] Tried to open unknown module: ${moduleId}`);
            return null;
        }

        const current = layoutRef.current;
        // A module plus its payload identifies one logical window. Payload-free modules such as
        // Jobs are singletons; opening them again should restore/focus, not create a duplicate.
        const existing = current.windows.find(
            (w) => w.moduleId === moduleId && payloadsMatch(w.payload, options?.payload)
        );
        if (existing) {
            if (existing.poppedOut) {
                focusPopoutWindow(existing.id, existing, mod);
            } else {
                dispatch({ type: 'FOCUS', windowId: existing.id });
            }
            return existing.id;
        }

        dispatch({
            type: 'OPEN',
            moduleId,
            module: mod,
            position: options?.position,
            payload: options?.payload,
        });
        return null;
    }, []);

    const close = useCallback((windowId: string) => {
        popoutRefs.current.get(windowId)?.close();
        popoutRefs.current.delete(windowId);
        dispatch({ type: 'CLOSE', windowId });
    }, []);

    const focus = useCallback((windowId: string) => {
        dispatch({ type: 'FOCUS', windowId });
    }, []);

    const move = useCallback((windowId: string, x: number, y: number) => {
        dispatch({ type: 'MOVE', windowId, x, y });
    }, []);

    const resize = useCallback((windowId: string, width: number, height: number) => {
        dispatch({ type: 'RESIZE', windowId, width, height });
    }, []);

    const minimize = useCallback((windowId: string) => {
        dispatch({ type: 'MINIMIZE', windowId });
    }, []);

    const maximize = useCallback((windowId: string) => {
        dispatch({ type: 'MAXIMIZE', windowId });
    }, []);

    const restore = useCallback((windowId: string) => {
        dispatch({ type: 'RESTORE', windowId });
    }, []);

    const resetLayout = useCallback(() => {
        popoutRefs.current.forEach((popup) => popup.close());
        popoutRefs.current.clear();
        dispatch({ type: 'RESET' });
    }, []);

    const popIn = useCallback((windowId: string) => {
        dispatch({ type: 'POP_IN', windowId });
        popoutRefs.current.get(windowId)?.close();
        popoutRefs.current.delete(windowId);
    }, []);

    const popOut = useCallback((windowId: string, options?: PopOutOptions): boolean => {
        const current = layoutRef.current;
        const target = current.windows.find((w) => w.id === windowId);
        if (!target || target.poppedOut) {
            if (target?.poppedOut) {
                const mod = ModuleRegistry.get(target.moduleId);
                if (mod) focusPopoutWindow(windowId, target, mod);
            }
            return Boolean(target?.poppedOut);
        }
        const mod = ModuleRegistry.get(target.moduleId);
        if (!mod?.canPopout) return false;

        const nextLayout = windowReducer(current, { type: 'POP_OUT', windowId });
        saveOsState(userId, {
            schemaVersion: 1,
            workspaceId: 'default',
            layout: nextLayout,
            ui: {},
        });
        dispatch({ type: 'POP_OUT', windowId });

        const popup = openPopoutWindow(target, mod, { placement: options?.placement });
        if (!popup) {
            const reverted = windowReducer(nextLayout, { type: 'POP_IN', windowId });
            saveOsState(userId, {
                schemaVersion: 1,
                workspaceId: 'default',
                layout: reverted,
                ui: {},
            });
            dispatch({ type: 'POP_IN', windowId });
            return false;
        }
        popoutRefs.current.set(windowId, popup);
        return true;
    }, [userId]);

    const focusPopout = useCallback((windowId: string) => {
        const current = layoutRef.current;
        const target = current.windows.find((w) => w.id === windowId);
        if (!target?.poppedOut) return;
        const mod = ModuleRegistry.get(target.moduleId);
        if (!mod) return;
        focusPopoutWindow(windowId, target, mod);
    }, []);

    const value = useMemo<WindowManagerContextValue>(() => {
        const activeWindow = layout.activeWindowId
            ? layout.windows.find((w) => w.id === layout.activeWindowId) ?? null
            : null;
        return {
            layout,
            windows: layout.windows,
            activeWindowId: layout.activeWindowId,
            activeWindow,
            open,
            close,
            focus,
            move,
            resize,
            minimize,
            maximize,
            restore,
            resetLayout,
            popOut,
            popIn,
            focusPopout,
        };
    }, [
        layout,
        open,
        close,
        focus,
        move,
        resize,
        minimize,
        maximize,
        restore,
        resetLayout,
        popOut,
        popIn,
        focusPopout,
    ]);

    return <WindowManagerContext.Provider value={value}>{children}</WindowManagerContext.Provider>;
}
