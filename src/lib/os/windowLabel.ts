import type { ModuleDefinition, WindowState } from './types';

/** Label for a window everywhere it appears: the module's per-window title, else the module title. */
export function windowLabel(w: Pick<WindowState, 'moduleId' | 'payload'>, mod: ModuleDefinition | undefined): string {
    return mod?.windowTitle?.(w.payload) || mod?.title || w.moduleId;
}
