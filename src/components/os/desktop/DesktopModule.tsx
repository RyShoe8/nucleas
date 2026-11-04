'use client';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import { registerOsModules } from '@/components/os/modules/registerModules';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import WindowManagerProvider from '@/components/os/state/WindowManagerProvider';
import styles from './DesktopModule.module.css';
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
    const admin = auth.isAdmin || auth.role === 'Administrator';
    const denied = definition && ((definition.permissions === 'admin' && !admin) || (definition.permissions === 'manager' && !admin && !auth.isManagerOrAdmin));
    const content = auth.loading ? <p role="status">Opening {title}…</p>
        : !auth.userId ? <><p>Sign in to open your Nucleas apps.</p><a className="ui-button" href="/login">Sign in</a></>
        : !definition ? <p>This app is unavailable. Update Nucleas and try again.</p>
        : denied ? <p>Your account does not have access to this app.</p> : null;
    return <WindowManagerProvider userId={auth.userId}>
        <div className={styles.window}>
            <header className={styles.header}><span className={styles.mark} aria-hidden>n</span><span className={styles.title}>{title}</span></header>
            <main className={`${styles.body} nucleas-app-content`} aria-label={title}>
                {content ? <div className={styles.message}>{content}</div> : definition!.render({ windowId: `desktop-${moduleId}`, moduleId, payload })}
            </main>
        </div>
    </WindowManagerProvider>;
}
