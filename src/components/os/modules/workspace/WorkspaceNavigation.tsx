'use client';
import { Activity, createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { WindowManagerContext } from '@/components/os/state/windowManagerContext';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import { workspaceTarget } from '@/lib/os/workspaceRoutes';
import { useVoiceWorkspace } from '@/components/os/voice/VoiceWorkspace';

/** Reuse canonical editors in-place. Ask, capture and Office retain independent windows. */
const InsideWorkspace = createContext(false);
export default function WorkspaceNavigation(props: { children: ReactNode; companyId?: string; companyName?: string }) {
    const inside = useContext(InsideWorkspace);
    return inside ? props.children : <WorkspaceHost {...props} />;
}
function WorkspaceHost({ children, companyId, companyName }: { children: ReactNode; companyId?: string; companyName?: string }) {
    const parent = useWindowManager();
    const auth = useOsAuth();
    const [stack, setStack] = useState<{ moduleId: string; payload?: Record<string, string> }[]>([]);
    const current = stack.at(-1);
    useVoiceWorkspace({ moduleId: current?.moduleId, companyId: current?.payload?.companyId ?? companyId, companyName: current?.payload?.companyName ?? companyName, section: current?.payload?.section }, 5, Boolean(current));
    const context = useMemo(() => ({ ...parent, open: (moduleId: string, options?: Parameters<typeof parent.open>[1]) => {
        if (['office', 'assistant', 'voice', 'tools'].includes(moduleId)) return parent.open(moduleId, options);
        const target = workspaceTarget(moduleId, { ...options, payload: { ...(companyId ? { companyId, companyName: companyName ?? '' } : {}), ...options?.payload } });
        const mod = ModuleRegistry.get(target.moduleId);
        const admin = auth.isAdmin || auth.role === 'Administrator';
        if (!mod || auth.loading || (mod.permissions === 'admin' && !admin) || (mod.permissions === 'manager' && !admin && !auth.isManagerOrAdmin)) return parent.open(moduleId, options);
        setStack(s => [...s, target]);
        return parent.activeWindowId;
    } }), [parent, companyId, companyName, auth.loading, auth.isAdmin, auth.isManagerOrAdmin, auth.role]);
    return <InsideWorkspace.Provider value><WindowManagerContext.Provider value={context}>
        <Activity mode={current ? 'hidden' : 'visible'}>{children}</Activity>
        {current && <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2">
                <button className="ui-button" onClick={() => setStack(s => s.slice(0, -1))}>← Back</button>
                <span className="min-w-0 flex-1 text-sm">{current.payload?.companyName || companyName} · {ModuleRegistry.get(current.moduleId)?.title}</span>
                <button className="ui-button text-xs" onClick={() => parent.open(current.moduleId, { payload: current.payload })}>Open separately ↗</button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">{stack.map((entry, index) => <Activity key={index} mode={index === stack.length - 1 ? 'visible' : 'hidden'}>{ModuleRegistry.get(entry.moduleId)?.render({ windowId: `workspace-${index}-${entry.moduleId}`, moduleId: entry.moduleId, payload: entry.payload })}</Activity>)}</div>
        </div>}
    </WindowManagerContext.Provider></InsideWorkspace.Provider>;
}
