import type { WorkspaceIntentContextPayload } from '@/lib/voice/workspaceIntentContext';
import type { OsContextSnapshot } from '@/lib/os/types';

function localTodayIso(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Build the workspace intent context payload from OS shell state. The shape
 * matches `WorkspaceIntentContextPayload` so the existing voice/palette
 * pipeline (parser, confirmation modal, intent executor) works unchanged.
 * The explicit OS scope follows the visible company/editor. OS commands use
 * deterministic navigation or the existing Ask engine, rather than the legacy parser.
 */
export function buildOsVoiceContext(snapshot: OsContextSnapshot, scope?: WorkspaceIntentContextPayload['os']): WorkspaceIntentContextPayload {
    return {
        projectId: null,
        projectName: null,
        phase: null,
        view: {
            lens: 'os',
            pathname: '/os',
        },
        referenceDate: localTodayIso(),
        projects: [],
        os: { moduleId: snapshot.focusedModuleId ?? undefined, ...scope },
        // Preserve shell hints for older context consumers.
        ...({
            osOpenModuleIds: snapshot.openModuleIds,
            osFocusedModuleId: snapshot.focusedModuleId,
        } as Record<string, unknown>),
    };
}
