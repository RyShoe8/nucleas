import type { OpenWindowOptions } from './types';
/** Preserve old office, notification and native-launcher links. */
export function workspaceTarget(moduleId: string, options?: OpenWindowOptions) {
    const payload = options?.payload;
    // Older Team links can target either a Job or a BuildRequest. Keep their polymorphic resolver.
    if (moduleId === 'team' && payload?.jobId) return { moduleId, payload };
    if (moduleId === 'team' && payload?.companyId) return { moduleId: 'company', payload: { ...payload, section: 'people' } };
    if (moduleId === 'today') return { moduleId: 'companies', payload };
    return { moduleId, payload };
}
export function companySection(section?: string): string {
    return ({ performance: 'overview', team: 'people', setup: 'connections' } as Record<string, string>)[section ?? ''] ?? section ?? 'overview';
}
