'use client';

import { Activity, useState, type ReactNode } from 'react';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import { windowLabel } from '@/lib/os/windowLabel';
import ModuleLauncher, { AppLauncherPanel } from './ModuleLauncher';
import OsAccountMenu from './OsAccountMenu';
import OsInstallButton from './OsInstallButton';
import IntegrationNotice from './IntegrationNotice';
import { VoiceButton } from '@/components/voice/VoiceOverlay';
import { setAssistantFocus } from '@/lib/os/assistantFocus';
import styles from './DesktopShell.module.css';

/** A focused web workspace. The native desktop owns its independent OS windows. */
export default function OsShell({ children }: { children?: ReactNode }) {
    const wm = useWindowManager();
    const auth = useOsAuth();
    const [homeFor, setHomeFor] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const admin = auth.isAdmin || auth.role === 'Administrator';
    const allowed = wm.windows.filter(w => {
        const mod = ModuleRegistry.get(w.moduleId);
        return mod && (mod.permissions === 'admin' ? admin : mod.permissions === 'manager' ? admin || auth.isManagerOrAdmin : true);
    });
    const active = allowed.find(w => w.id === wm.activeWindowId && !w.poppedOut && !w.minimized);
    const atHome = !active || homeFor === wm.activeWindowId;
    const definition = active ? ModuleRegistry.get(active.moduleId) : undefined;
    const title = active ? windowLabel(active, definition) : 'Your workspace';
    const select = (id: string) => {
        setHomeFor(null);
        setError(null);
        const target = wm.windows.find(w => w.id === id);
        if (target?.poppedOut) wm.focusPopout(id);
        else wm.focus(id);
    };
    return <div className={styles.workspace}>
        <header className={styles.workspaceHeader}>
            <button type="button" className={styles.wordmark} onClick={() => setHomeFor(wm.activeWindowId)} aria-label="Nucleas home">nucleas<span>.</span></button>
            <div className={styles.breadcrumb}>{atHome ? 'YOUR COMPANY. IN REACH.' : title}</div>
            <div className={styles.headerActions}>
                {!atHome && active && <div className={styles.viewActions}>
                    {definition?.canPopout && <button type="button" onClick={() => { if (!wm.popOut(active.id)) setError('Allow pop-ups for Nucleas to open this app in a separate window.'); }} aria-label="Open in a separate window" title="Open in a separate window">↗</button>}
                    <button type="button" onClick={() => wm.close(active.id)} aria-label={'Close ' + title} title="Close app">×</button>
                </div>}
                <OsInstallButton /><OsAccountMenu />
            </div>
        </header>
        <main className={styles.stage}>
            {atHome && <div className={styles.landing}>
                <div className={styles.intro}><span className={styles.eyebrow}>A LITTLE LESS FRICTION. A LOT MORE POSSIBLE.</span><h1>Your next move,<br />{' '}<em>within reach.</em></h1><p>One place to think, create, and move your companies forward.</p></div>
                <div className={styles.launcherHome}><AppLauncherPanel onOpen={() => setHomeFor(null)} /></div>
            </div>}
            {allowed.filter(w => !w.poppedOut).map(w => {
                const mod = ModuleRegistry.get(w.moduleId)!;
                const visible = !atHome && active?.id === w.id;
                return <Activity key={w.id} mode={visible ? 'visible' : 'hidden'}>
                    <section hidden={!visible} aria-label={windowLabel(w, mod)} className={styles.appSurface}>
                        <div className={`${styles.appBody} nucleas-app-content`}>{mod.render({ windowId: w.id, moduleId: w.moduleId, payload: w.payload })}</div>
                    </section>
                </Activity>;
            })}
            <IntegrationNotice />
            {error && <div role="alert" className={styles.notice}>{error}<button type="button" aria-label="Dismiss" onClick={() => setError(null)}>×</button></div>}
            {children}
        </main>
        <div className={styles.dockArea}>
            <nav className={styles.dock} aria-label="Workspace apps">
                <ModuleLauncher onOpen={() => setHomeFor(null)} />
                <button type="button" className={styles.dockAsk} onClick={() => { setHomeFor(null); setAssistantFocus(null); wm.open('assistant'); }}><span aria-hidden>✦</span> Ask</button>
                {allowed.length > 0 && <div className={styles.appSwitches}>{allowed.map(w => <button type="button" key={w.id} aria-pressed={!atHome && active?.id === w.id} title={windowLabel(w, ModuleRegistry.get(w.moduleId))} onClick={() => select(w.id)}>
                    <span className={styles.switchDot} aria-hidden />{windowLabel(w, ModuleRegistry.get(w.moduleId))}{w.poppedOut ? ' ↗' : ''}
                </button>)}</div>}
                <VoiceButton />
            </nav>
        </div>
    </div>;
}
