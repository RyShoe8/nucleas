/**
 * Local persistence for the Nucleas OS workspace layout.
 *
 * Phase 1 uses localStorage so we can iterate on the shell without backend
 * changes. The adapter shape is intentionally narrow so a future phase can
 * swap it for a DB-backed implementation without touching the reducer or
 * providers.
 *
 * Future:
 *   - Add BroadcastChannel('nucleas-os') sync for multi-window state.
 *   - Add DB adapter writing to a WorkspaceLayout collection.
 */

import { initialLayout } from './windowManager';
import type { PersistedOsState, WorkspaceLayout } from './types';

const STORAGE_VERSION = 1 as const;
const STORAGE_PREFIX = `nucleas-os:v${STORAGE_VERSION}`;

function keyFor(userId: string | null): string {
    return `${STORAGE_PREFIX}:${userId ?? 'anon'}`;
}

function defaultState(): PersistedOsState {
    return {
        schemaVersion: STORAGE_VERSION,
        workspaceId: 'default',
        layout: initialLayout,
        ui: {},
    };
}

export function loadOsState(userId: string | null): PersistedOsState {
    if (typeof window === 'undefined') return defaultState();
    try {
        const raw = window.localStorage.getItem(keyFor(userId));
        if (!raw) return defaultState();
        const parsed = JSON.parse(raw) as PersistedOsState;
        if (!parsed || parsed.schemaVersion !== STORAGE_VERSION) return defaultState();
        if (!parsed.layout || !Array.isArray(parsed.layout.windows)) return defaultState();
        return {
            schemaVersion: STORAGE_VERSION,
            workspaceId: parsed.workspaceId ?? 'default',
            layout: sanitizeLayout(parsed.layout),
            ui: parsed.ui ?? {},
        };
    } catch (err) {
        console.warn('[OS] Failed to load persisted state, using defaults', err);
        return defaultState();
    }
}

export function saveOsState(userId: string | null, state: PersistedOsState): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(keyFor(userId), JSON.stringify(state));
    } catch (err) {
        console.warn('[OS] Failed to persist state', err);
    }
}

function sanitizeLayout(layout: WorkspaceLayout): WorkspaceLayout {
    const windows = layout.windows.map((w) => ({
        ...w,
        poppedOut: Boolean(w.poppedOut),
    }));
    const ids = new Set(windows.map((w) => w.id));
    return {
        windows,
        activeWindowId: layout.activeWindowId && ids.has(layout.activeWindowId)
            ? layout.activeWindowId
            : null,
        nextZIndex: typeof layout.nextZIndex === 'number' ? layout.nextZIndex : 10,
    };
}
