'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import ModuleRegistry from '@/lib/os/moduleRegistry';
import { visibleInterval } from '@/lib/os/visibleInterval';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import { useOsCompanies } from './CompaniesModule';
import { useActivity } from './jobs/ActivityList';
import type { JobView } from './jobs/JobCard';
import { memberName, memberOf, queueFor } from './jobs/workQueue';
import Character from './office/Character';
import { buildOffice, type Desk, type Room, type TodayMetrics } from './office/officeState';
import styles from './office/Office.module.css';

/**
 * The main Nucleas window: the whole business at a glance, as an office. The lobby board says what needs
 * you; each company is a room with its team at their desks, showing who is working, who is waiting on
 * you and who has nothing assigned, with the company's headline numbers on the wall. Ask, voice and every
 * app are one click away from here.
 */

type DesktopState = { version: string; update: { phase: string; text: string } };

function useDesktop() {
    const desktop = useSyncExternalStore(() => () => {}, () => (typeof window !== 'undefined' ? window.nucleasDesktop ?? null : null), () => null);
    const [state, setState] = useState<DesktopState | null>(null);
    useEffect(() => {
        if (!desktop?.desktopState) return;
        void desktop.desktopState().then(setState).catch(() => undefined);
        return desktop.onDesktopState?.(setState);
    }, [desktop]);
    return { desktop, state };
}

function Bubble({ desk }: { desk: Desk }) {
    if (desk.state === 'waiting') return <span className={`${styles.bubble} absolute -top-1 right-1 z-10 min-w-[18px] rounded-full bg-amber-400 px-1.5 text-center text-[10px] font-semibold text-black`}>{desk.waiting > 1 ? desk.waiting : '!'}</span>;
    if (desk.state === 'away') return <span className={`${styles.zz} absolute right-3 top-1 text-[10px] text-text-secondary`}>z</span>;
    return null;
}

function DeskView({ room, desk, onOpen }: { room: Room; desk: Desk; onOpen: (room: Room, desk: Desk) => void }) {
    const label = `${desk.name}${desk.says ? `: ${desk.says}` : desk.state === 'away' ? ': nothing assigned' : desk.state === 'idle' ? `: ${desk.jobs} job${desk.jobs === 1 ? '' : 's'}, nothing happening now` : ''}`;
    return (
        <button type="button" title={label} aria-label={`${room.name} · ${label}`} onClick={() => onOpen(room, desk)}
            className="group relative flex flex-col items-center rounded-md px-1 pb-1 pt-2 hover:bg-white/5 focus-visible:bg-white/5">
            <Bubble desk={desk} />
            <Character role={desk.role} state={desk.state} size={48} />
            <span className="mt-0.5 max-w-full truncate text-[10px] text-text-secondary group-hover:text-text-primary">{desk.name}</span>
        </button>
    );
}

export function RoomView({ room, onOpenRoom, onOpenDesk }: { room: Room; onOpenRoom: (room: Room) => void; onOpenDesk: (room: Room, desk: Desk) => void }) {
    const talking = room.desks.filter((d) => d.says).slice(0, 2);
    return (
        <section className="overflow-hidden rounded-xl border border-border bg-background-card/60" aria-label={`${room.name} office`}>
            <button type="button" onClick={() => onOpenRoom(room)} className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left hover:bg-white/5" style={{ boxShadow: `inset 3px 0 0 ${room.color}` }}>
                <strong className="min-w-0 flex-1 truncate text-sm">{room.name}</strong>
                {room.working ? <span className="text-[10px] text-sky-300">{room.working} working</span> : null}
                {room.waiting ? <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">{room.waiting} need{room.waiting === 1 ? 's' : ''} you</span> : <span className="text-[10px] text-text-secondary">All clear</span>}
            </button>
            {room.screens.length ? (
                <div className="flex gap-2 px-3 pt-2">
                    {room.screens.map((screen) => (
                        <div key={screen.label} className="min-w-0 flex-1 rounded border border-border bg-black/30 px-2 py-1 font-mono text-[10px]">
                            <span className="block truncate text-text-secondary">{screen.label} · 7 days</span>
                            <span className="text-text-primary">{screen.value}</span>
                            {screen.change !== null ? <span className={`ml-1 ${screen.change >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{screen.change >= 0 ? '▲' : '▼'}{Math.abs(Math.round(screen.change))}%</span> : null}
                        </div>
                    ))}
                </div>
            ) : null}
            <div className={`${styles.floor} grid grid-cols-3 gap-1 p-2`}>
                {room.desks.map((desk) => <DeskView key={desk.role} room={room} desk={desk} onOpen={onOpenDesk} />)}
            </div>
            {talking.length ? (
                <ul className="space-y-0.5 border-t border-border px-3 py-2 text-[11px]">
                    {talking.map((d) => <li key={d.role} className="truncate"><span className={d.state === 'waiting' ? 'text-amber-300' : 'text-sky-300'}>{d.name}</span><span className="text-text-secondary"> · {d.says}</span></li>)}
                </ul>
            ) : null}
        </section>
    );
}

export function AppsDrawer({ onClose }: { onClose: () => void }) {
    const wm = useWindowManager();
    const auth = useOsAuth();
    const [query, setQuery] = useState('');
    const admin = auth.isAdmin || auth.role === 'Administrator';
    const apps = ModuleRegistry.list().filter((m) => !m.launcherHidden && m.id !== 'office' && m.id !== 'assistant'
        && (m.permissions !== 'admin' || admin) && (m.permissions !== 'manager' || admin || auth.isManagerOrAdmin)
        && m.title.toLowerCase().includes(query.trim().toLowerCase()));
    return (
        <div className="rounded-xl border border-border bg-background-card p-3">
            <div className="mb-2 flex items-center gap-2">
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && apps[0]) { wm.open(apps[0].id); onClose(); } }} placeholder="Find an app…" aria-label="Find an app" className="ui-control min-w-0 flex-1" />
                <button type="button" className="ui-button" onClick={onClose}>Close</button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {apps.map((app) => (
                    <button key={app.id} type="button" onClick={() => { wm.open(app.id); onClose(); }} className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-left text-sm hover:bg-white/5">
                        <span aria-hidden="true" className="w-5 text-center">{app.icon}</span>
                        <span className="truncate">{app.title}</span>
                    </button>
                ))}
                {!apps.length ? <p className="col-span-full text-xs text-text-secondary">No apps match that search.</p> : null}
            </div>
        </div>
    );
}

export default function OfficeModule() {
    const wm = useWindowManager();
    const { desktop, state: desktopState } = useDesktop();
    const { companies } = useOsCompanies();
    const [jobs, setJobs] = useState<JobView[] | null>(null);
    const [today, setToday] = useState<TodayMetrics[]>([]);
    const [reloadKey, setReloadKey] = useState(0);
    const [appsOpen, setAppsOpen] = useState(false);
    const [voiceError, setVoiceError] = useState<string | null>(null);
    const activity = useActivity(reloadKey);
    const reload = useCallback(() => setReloadKey((k) => k + 1), []);

    useEffect(() => {
        let cancelled = false;
        void fetch('/api/os/jobs', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((body: { jobs?: JobView[] } | null) => { if (!cancelled && body?.jobs) setJobs(body.jobs); }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [reloadKey]);
    // The wall numbers are last-7-day totals: they change slowly, so they refresh every five minutes, not with the jobs.
    useEffect(() => {
        let cancelled = false;
        const load = () => { void fetch('/api/os/today', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((body: { rows?: TodayMetrics[] } | null) => { if (!cancelled && body?.rows) setToday(body.rows); }).catch(() => undefined); };
        load();
        const stop = visibleInterval(load, 5 * 60_000);
        return () => { cancelled = true; stop(); };
    }, []);
    useEffect(() => {
        window.addEventListener('nucleas:jobs-changed', reload);
        const stop = visibleInterval(reload, 20_000);
        return () => { window.removeEventListener('nucleas:jobs-changed', reload); stop(); };
    }, [reload]);

    const rooms = useMemo(() => buildOffice({
        companies: (companies ?? []).map((c) => ({ id: c.id, name: c.name, color: c.color })),
        jobs: jobs ?? [],
        activity: activity?.items ?? [],
        today,
    }), [companies, jobs, activity, today]);
    const queue = useMemo(() => (jobs ?? []).flatMap((job) => queueFor(job).map((item) => ({ item, job }))).sort((a, b) => a.item.since.localeCompare(b.item.since)), [jobs]);
    const otherWaiting = (activity?.items ?? []).filter((item) => item.group === 'you' || item.group === 'failed');
    const waitingTotal = queue.length + otherWaiting.length;
    const workingTotal = rooms.reduce((n, r) => n + r.working, 0);

    const openWork = () => wm.open('work');
    const openRoom = (room: Room) => wm.open('company', { payload: { companyId: room.companyId, companyName: room.name } });
    const openDesk = (room: Room, desk: Desk) => (desk.state === 'waiting' ? openWork() : wm.open('team', { payload: { companyId: room.companyId, companyName: room.name } }));
    const startVoice = async () => {
        setVoiceError(null);
        if (desktop?.startVoice) {
            try { await desktop.startVoice(); } catch { setVoiceError('Could not start voice. Open Ask and try again.'); }
        } else wm.open('assistant');
    };

    return (
        <div className="touch-comfort h-full overflow-y-auto text-text-primary">
            <div className="sticky top-0 z-20 space-y-2 border-b border-border bg-background-card/95 px-3 py-2 backdrop-blur">
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => wm.open('assistant')} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-border px-3 py-2 text-left hover:bg-white/5">
                        <span aria-hidden="true" className="text-primary">✦</span>
                        <span className="min-w-0 flex-1"><strong className="block text-sm">What’s next?</strong><span className="block truncate text-[11px] text-text-secondary">Set direction. Give your team an outcome.</span></span>
                        <span aria-hidden="true">↗</span>
                    </button>
                    <button type="button" onClick={() => void startVoice()} className="ui-button h-11 w-11 justify-center" aria-label="Talk to Nucleas" title="Talk to Nucleas">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 11a7 7 0 01-14 0M12 18v4M8 22h8M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z" /></svg>
                    </button>
                    <button type="button" onClick={() => setAppsOpen((v) => !v)} aria-expanded={appsOpen} className="ui-button h-11">Apps</button>
                </div>
                {voiceError ? <p role="alert" className="text-xs text-red-400">{voiceError}</p> : null}
                {appsOpen ? <AppsDrawer onClose={() => setAppsOpen(false)} /> : null}
            </div>

            <div className="space-y-3 p-3">
                <section aria-label="Lobby board" className={`rounded-xl border px-3 py-2.5 ${waitingTotal ? 'border-amber-400/40 bg-amber-400/5' : 'border-border'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                        <strong className="min-w-0 flex-1 text-sm">{waitingTotal ? `${waitingTotal} thing${waitingTotal === 1 ? '' : 's'} need${waitingTotal === 1 ? 's' : ''} you` : 'Nothing needs you right now'}</strong>
                        {workingTotal ? <span className="text-[11px] text-sky-300">{workingTotal} working now</span> : null}
                        <button type="button" className="ui-button" onClick={openWork}>Open the queue</button>
                    </div>
                    {queue.length ? (
                        <ul className="mt-2 space-y-1">
                            {queue.slice(0, 4).map(({ item, job }) => (
                                <li key={item.key}>
                                    <button type="button" onClick={openWork} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-white/5">
                                        <span className="hidden w-28 shrink-0 truncate text-text-secondary sm:block">{job.companyName} · {memberName(memberOf(job))}</span>
                                        <span className="min-w-0 flex-1"><span className="block truncate">{item.label}</span><span className="block truncate text-[10px] text-text-secondary sm:hidden">{job.companyName} · {memberName(memberOf(job))}</span></span>
                                    </button>
                                </li>
                            ))}
                            {queue.length + otherWaiting.length > 4 ? <li className="px-1 text-[11px] text-text-secondary">and {queue.length + otherWaiting.length - 4} more in the queue</li> : null}
                        </ul>
                    ) : null}
                </section>

                {!jobs || !companies ? <p className="text-sm text-text-secondary" role="status">Opening the office…</p> : !rooms.length ? (
                    <div className="rounded-xl border border-border p-4 text-sm">
                        <p className="font-medium">Your office is empty</p>
                        <p className="mt-1 text-text-secondary">Add a company and its team moves in.</p>
                        <button type="button" className="ui-button mt-2" onClick={() => wm.open('companies')}>Add a company</button>
                    </div>
                ) : (
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))]">
                        {rooms.map((room) => <RoomView key={room.companyId} room={room} onOpenRoom={openRoom} onOpenDesk={openDesk} />)}
                    </div>
                )}

                <p className="text-[11px] text-text-secondary">Typing: working now · hopping with a badge: waiting on you · resting: has jobs, nothing running · faded: nothing assigned. Click a person to open their team, a room to open the company.</p>
                {desktopState ? (
                    <button type="button" className="text-[11px] text-text-secondary underline" onClick={() => void (desktopState.update.phase === 'ready' ? desktop?.installUpdate?.() : desktop?.checkUpdate?.())}>
                        Nucleas {desktopState.version} · {desktopState.update.text}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
