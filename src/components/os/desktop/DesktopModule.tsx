'use client';
import { Activity, useEffect, useSyncExternalStore } from 'react';
import { useActiveCapture } from '@/lib/os/activeCapture';
import { usePageVisible } from '@/hooks/os/usePageVisible';
import { useSearchParams } from 'next/navigation';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import { registerOsModules } from '@/components/os/modules/registerModules';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import WindowManagerProvider from '@/components/os/state/WindowManagerProvider';
import { openPagesInOwnWindow, shareWindowEvents } from '@/lib/os/desktopWindows';
import { OsIntentLayer } from '@/components/os/OsRoot';
import { useVoice } from '@/components/voice/VoiceProvider';
import { VoiceButton } from '@/components/voice/VoiceOverlay';
import styles from './DesktopModule.module.css';
import { TITLE_SLOT_ID } from '@/lib/os/titleSlot';

/** The launcher starts listening in Ask; company windows also support deliberate, scoped push-to-talk. */
function VoiceFromMainWindow() {
    const voice = useVoice();
    const start = voice.startListening;
    useEffect(() => window.nucleasDesktop?.onVoiceStart?.(() => { void start(); }), [start]);
    return null;
}
registerOsModules();

export default function DesktopModule() {
    const visible=usePageVisible();
    const capturing = useActiveCapture();
    const params = useSearchParams();
    // Present only inside the desktop app; false while rendering on the server so the first paint matches.
    const hasLauncher = useSyncExternalStore(() => () => {}, () => Boolean(window.nucleasDesktop?.showLauncher), () => false);
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
    useEffect(() => shareWindowEvents(), []);
    useEffect(() => openPagesInOwnWindow(), []);
    const admin = auth.isAdmin || auth.role === 'Administrator';
    const denied = definition && ((definition.permissions === 'admin' && !admin) || (definition.permissions === 'manager' && !admin && !auth.isManagerOrAdmin));
    const content = auth.loading ? <p role="status">Opening {title}…</p>
        : !auth.userId ? <><p>Sign in to open your Nucleas apps.</p><a className="ui-button" href="/login">Sign in</a></>
        : !definition ? <p>This app is unavailable. Update Nucleas and try again.</p>
        : denied ? <p>Your account does not have access to this app.</p> : null;
    // Confirmations and Ctrl+K remain available in every window. Ask owns inline microphone and wake controls;
    // the main desktop window can also start listening there through the existing voice bridge.
    // Ask owns inline microphone/wake controls. Never float them over its composer.
    const talksHere = !hasLauncher && moduleId !== 'assistant';
    return <Activity mode={visible || capturing ?'visible':'hidden'}><WindowManagerProvider userId={auth.userId}><OsIntentLayer voiceControls={talksHere} moduleContext={{ moduleId, companyId: payload?.companyId, companyName: payload?.companyName, section: payload?.section }}>
        {hasLauncher && moduleId === 'assistant' ? <VoiceFromMainWindow /> : null}
        <div className={styles.window}>
            <header className={styles.header}>
                {hasLauncher ? <button type="button" className={styles.launcher} title="Open the main Nucleas window" onClick={() => void window.nucleasDesktop?.showLauncher?.()} aria-label="Open the main Nucleas window">
                    <span className={styles.mark} aria-hidden>n</span> Nucleas apps
                </button> : <span className={styles.mark} aria-hidden>n</span>}
                {/* An app can put its own control here (the Company window puts its company picker); the plain title then hides. */}
                <span className={styles.titleBar}><span className={styles.title}>{title}</span><span id={TITLE_SLOT_ID} data-window-id={`desktop-${moduleId}`} className={styles.titleSlot} /></span>
                {hasLauncher && !['office', 'assistant'].includes(moduleId) && <VoiceButton inline />}
            </header>
            <main className={`${styles.body} nucleas-app-content ${moduleId === 'office' ? '' : 'nucleas-workflow'}`} aria-label={title}>
                {content ? <div className={styles.message}>{content}</div> : definition!.render({ windowId: `desktop-${moduleId}`, moduleId, payload })}
            </main>
        </div>
    </OsIntentLayer></WindowManagerProvider></Activity>;
}
