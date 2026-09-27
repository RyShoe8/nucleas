/**
 * Nucleas OS type definitions.
 *
 * The OS shell is a modular workspace at os.nucleas.app. Every major surface
 * (Projects, Tasks, Content, etc.) is a Module that can be opened in a
 * draggable, resizable window. Window state is fully serializable so it can
 * later be persisted to the database and synced across pop-out windows.
 */

import type { ReactNode } from 'react';

type OsPermissionLevel = 'admin' | 'manager' | 'member' | 'client';

interface ModuleSize {
    width: number;
    height: number;
}

interface ModulePosition {
    x: number;
    y: number;
}

export interface ModuleDefinition {
    id: string;
    title: string;
    /** Short emoji or single character used in launchers/tray. */
    icon: string;
    defaultSize: ModuleSize;
    minSize: ModuleSize;
    /** Future pop-out support; reserved for Phase 4. */
    canPopout: boolean;
    /** Minimum role allowed to open this module. */
    permissions: OsPermissionLevel;
    /** When true, hidden from the module launcher and palette open commands. */
    launcherHidden?: boolean;
    /** Per-window label (title bar, tray, popout) derived from the payload, e.g. the company name. */
    windowTitle?: (payload?: Record<string, string>) => string | undefined;
    /** Render the module body. Receives the owning window id for self-control. */
    render: (ctx: ModuleRenderContext) => ReactNode;
}

export interface ModuleRenderContext {
    windowId: string;
    moduleId: string;
    payload?: Record<string, string>;
}

export interface WindowState {
    id: string;
    moduleId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    minimized: boolean;
    maximized: boolean;
    /** Reserved for Phase 4 pop-out support. Never true in Phase 1. */
    poppedOut: boolean;
    /** Module-specific serializable data (e.g. projectId). */
    payload?: Record<string, string>;
}

export interface OpenWindowOptions {
    position?: { x: number; y: number };
    payload?: Record<string, string>;
}

export interface WorkspaceLayout {
    windows: WindowState[];
    activeWindowId: string | null;
    /** Monotonic counter so newly focused windows always sit on top. */
    nextZIndex: number;
}

export interface PersistedOsState {
    schemaVersion: 1;
    workspaceId: 'default';
    layout: WorkspaceLayout;
    ui: {
        paletteHintDismissed?: boolean;
    };
}

/** Snapshot of the OS UI used by voice + command palette context. */
export interface OsContextSnapshot {
    openModuleIds: string[];
    focusedModuleId: string | null;
    focusedWindowId: string | null;
}
