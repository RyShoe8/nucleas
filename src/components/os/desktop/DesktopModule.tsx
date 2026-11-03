'use client';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import { registerOsModules } from '@/components/os/modules/registerModules';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import WindowManagerProvider from '@/components/os/state/WindowManagerProvider';
registerOsModules();

export default function DesktopModule() {
    const params = useSearchParams();
    const auth = useOsAuth();
    const moduleId = params.get('module') ?? 'assistant';
    const definition = ModuleRegistry.get(moduleId);
    let payload: Record<string, string> | undefined;
    try {
        const parsed: unknown = JSON.parse(params.get('payload') ?? '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.values(parsed).every(value => typeof value === 'string')) payload = parsed as Record<string, string>;
    } catch { /* Invalid context must not execute code or break the shell. */ }
    const title = definition?.windowTitle?.(payload) || definition?.title || 'Nucleas';
    useEffect(() => { document.title = title; }, [title]);
    if (auth.loading) return <div className="p-8 text-text-secondary">Opening {title}…</div>;
    if (!auth.userId) return <div className="p-8"><p>Sign in to open your Nucleas apps.</p><a className="ui-button mt-4" href="/login">Sign in</a></div>;
    if (!definition) return <div className="p-8">This app is unavailable. Update Nucleas and try again.</div>;
    const admin = auth.isAdmin || auth.role === 'Administrator';
    if ((definition.permissions === 'admin' && !admin) || (definition.permissions === 'manager' && !admin && !auth.isManagerOrAdmin)) return <div className="p-8">Your account does not have access to this app.</div>;
    return <WindowManagerProvider userId={auth.userId}><main className="h-screen overflow-auto bg-background text-text-primary">{definition.render({ windowId: `desktop-${moduleId}`, moduleId, payload })}</main></WindowManagerProvider>;
}
