'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOsCompanies } from './CompaniesModule';
import { RELATIONSHIP_LABEL, type OsCompanySummary } from './companyTypes';

type Group = 'companies' | 'clients';
const GROUP_LABEL: Record<Group, string> = { companies: 'Companies', clients: 'Clients' };
const groupOf = (company: OsCompanySummary): Group => (company.relationship === 'client' ? 'clients' : 'companies');

/**
 * The company's name, which is also how you change company. Click it and pick in two steps (Companies or
 * Clients, then the one you want), or start typing to search them all. The screen moves in place,
 * staying on the same tab.
 */
export default function CompanySwitcher({ current, onSwitch, compact = false }: { current: { id: string; name: string; color?: string }; onSwitch: (company: OsCompanySummary) => void; /** In a window's title bar: smaller text. */ compact?: boolean }) {
    const { companies } = useOsCompanies();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [group, setGroup] = useState<Group | null>(null);
    const [active, setActive] = useState(0);
    const root = useRef<HTMLDivElement>(null);
    const search = useRef<HTMLInputElement>(null);

    const ordered = useMemo(() => [...(companies ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [companies]);
    const counts = useMemo(() => ({ companies: ordered.filter((c) => groupOf(c) === 'companies').length, clients: ordered.filter((c) => groupOf(c) === 'clients').length }), [ordered]);
    const typed = query.trim().toLowerCase();
    // Typing searches everything; otherwise the second step lists the chosen group.
    const matches = useMemo(() => typed
        ? ordered.filter((c) => `${c.name} ${(c.websites ?? [c.domain]).filter(Boolean).join(' ')}`.toLowerCase().includes(typed))
        : group ? ordered.filter((c) => groupOf(c) === group) : [], [ordered, typed, group]);
    const several = ordered.length > 1;

    useEffect(() => {
        if (!open) return;
        search.current?.focus();
        const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', away);
        return () => document.removeEventListener('mousedown', away);
    }, [open]);

    const reset = () => { setQuery(''); setGroup(null); setActive(0); };
    const choose = (company: OsCompanySummary) => { setOpen(false); reset(); if (company.id !== current.id) onSwitch(company); };
    const groups = (Object.keys(GROUP_LABEL) as Group[]).filter((g) => counts[g] > 0);
    const showGroups = !typed && !group && groups.length > 1;
    // One group only: skip straight to its list.
    const listing = typed || group || groups.length <= 1 ? (matches.length || typed || group ? matches : ordered) : [];

    return <div ref={root} className="relative flex min-w-0 items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button type="button" aria-haspopup="listbox" aria-expanded={open} disabled={!several} onClick={() => { setOpen(!open); reset(); }}
            className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 -ml-2 text-left hover:bg-background-card disabled:hover:bg-transparent ${compact ? 'text-sm' : ''}`} title={several ? 'Switch company' : undefined}>
            <span aria-hidden className={`${compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} shrink-0 rounded-full`} style={{ backgroundColor: current.color ?? '#64748b' }} />
            {compact ? <span className="min-w-0 truncate font-semibold">{current.name}</span> : <h2 className="min-w-0 truncate text-lg font-semibold leading-tight">{current.name}</h2>}
            {several ? <span aria-hidden className="text-text-secondary">▾</span> : null}
        </button>
        {open ? <div className="absolute left-0 top-full z-50 mt-1 w-80 max-w-[90vw] rounded-xl border border-border bg-background p-2 text-sm shadow-2xl">
            <input ref={search} value={query} placeholder="Type a name or website…" aria-label="Find a company or client" className="mb-2 w-full rounded-lg border border-border bg-background-card px-3 py-2"
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(Math.max(listing.length, showGroups ? groups.length : 0) - 1, i + 1)); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
                    else if (e.key === 'Enter') { e.preventDefault(); if (showGroups && groups[active]) { setGroup(groups[active]); setActive(0); } else if (listing[active]) choose(listing[active]); }
                    else if (e.key === 'Escape') { if (group && !typed) setGroup(null); else setOpen(false); }
                    else if (e.key === 'Backspace' && !query && group) setGroup(null);
                }} />
            {showGroups ? <ul aria-label="Choose companies or clients" className="space-y-1">
                {groups.map((g, i) => <li key={g}>
                    <button type="button" onMouseEnter={() => setActive(i)} onClick={() => { setGroup(g); setActive(0); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left ${i === active ? 'bg-background-card' : ''}`}>
                        <span className="font-medium">{GROUP_LABEL[g]}</span>
                        <span className="text-xs text-text-secondary">{counts[g]} ›</span>
                    </button>
                </li>)}
            </ul> : <>
                {group && !typed ? <button type="button" className="mb-1 px-2 text-xs text-text-secondary hover:text-text-primary" onClick={() => { setGroup(null); setActive(0); }}>‹ {GROUP_LABEL[group]}</button> : null}
                <ul role="listbox" aria-label={group ? GROUP_LABEL[group] : 'Companies and clients'} className="max-h-72 overflow-y-auto">
                    {listing.map((company, i) => <li key={company.id} role="option" aria-selected={company.id === current.id}>
                        <button type="button" onMouseEnter={() => setActive(i)} onClick={() => choose(company)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${i === active ? 'bg-background-card' : ''}`}>
                            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: company.color ?? '#64748b' }} />
                            <span className="min-w-0 flex-1"><span className="block truncate">{company.name}</span><span className="block truncate text-[11px] text-text-secondary">{[RELATIONSHIP_LABEL[company.relationship], (company.websites ?? [])[0] ?? company.domain].filter(Boolean).join(' · ')}</span></span>
                            {company.id === current.id ? <span className="text-xs text-primary">Open</span> : null}
                        </button>
                    </li>)}
                    {!listing.length ? <li className="px-2 py-3 text-text-secondary">Nothing matches “{query.trim()}”.</li> : null}
                </ul>
            </>}
        </div> : null}
    </div>;
}
