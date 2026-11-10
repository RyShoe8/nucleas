'use client';

import { useRef, useState } from 'react';
import { useModuleRegistry } from '@/hooks/os/useModuleRegistry';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import { setAssistantFocus } from '@/lib/os/assistantFocus';
import styles from './DesktopShell.module.css';

const order = ['companies', 'team', 'work', 'today', 'mail', 'agenda', 'settings'];
const descriptions: Record<string, string> = { companies: 'Performance & context', team: 'Delegate & guide', work: 'Decisions & results', today: 'Portfolio briefing', mail: 'Conversations', agenda: 'Your schedule', settings: 'Engine & connections' };
const icons: Record<string, string> = { team: '◈', today: '◷', companies: '▦', work: '▤', growth: '↗', mail: '✉', agenda: '▤', settings: '⚙' };

export function AppLauncherPanel({ onOpen }: { onOpen?: () => void }) {
    const modules = useModuleRegistry();
    const wm = useWindowManager();
    const auth = useOsAuth();
    const [query, setQuery] = useState('');
    const isAdmin = auth.isAdmin || auth.role === 'Administrator';
    const available = modules.filter(m => !m.launcherHidden && (
        m.permissions === 'admin' ? isAdmin : m.permissions === 'manager' ? isAdmin || auth.isManagerOrAdmin : true
    ));
    const apps = available.filter(m => m.id !== 'assistant' && m.title.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => (order.indexOf(a.id) < 0 ? 99 : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? 99 : order.indexOf(b.id)));
    const open = (id: string) => {
        if (id === 'assistant') setAssistantFocus(null);
        onOpen?.();
        wm.open(id);
    };
    return <div className={styles.panel}>
        <div className={styles.brand}><span className={styles.orb}>n</span><div><strong>nucleas<span className={styles.dot}>.</span></strong><small>YOUR COMPANIES. YOUR TEAM.</small></div></div>
        {available.some(m => m.id === 'assistant') && <button type="button" className={styles.ask} onClick={() => open('assistant')}>
            <span aria-hidden>✦</span><span><strong>What’s next?</strong><small>Set direction. Give your team an outcome.</small></span><span aria-hidden>↗</span>
        </button>}
        <label className={styles.search}><span aria-hidden>⌕</span><input type="search" aria-label="Find a workspace" placeholder="Find a workspace…" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className={styles.sectionTitle}><span>YOUR WORKSPACE</span><span>COMPANIES → TEAM → WORK</span></div>
        <div className={styles.apps}>{apps.map(app => <button key={app.id} type="button" className={styles.app} onClick={() => open(app.id)}>
            <span className={styles.glyph} aria-hidden>{icons[app.id] ?? '◇'}</span><span>{app.title}</span><small className={styles.appDescription}>{descriptions[app.id]}</small>
            {wm.windows.some(w => w.moduleId === app.id) && <span className={styles.running} role="img" aria-label="Running" />}
        </button>)}</div>
        {apps.length === 0 && <p className={styles.empty}>No workspaces match that search.</p>}
    </div>;
}

export default function ModuleLauncher({ onOpen }: { onOpen?: () => void } = {}) {
    const dialog = useRef<HTMLDialogElement>(null);
    return <>
        <button type="button" onClick={() => dialog.current?.showModal()} className={styles.trigger} aria-haspopup="dialog">▦ <span>Nucleas</span></button>
        <dialog ref={dialog} className={styles.dialog} aria-label="Nucleas apps" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
            <button type="button" className={styles.close} aria-label="Close apps" onClick={() => dialog.current?.close()}>×</button>
            <AppLauncherPanel onOpen={() => { dialog.current?.close(); onOpen?.(); }} />
        </dialog>
    </>;
}
