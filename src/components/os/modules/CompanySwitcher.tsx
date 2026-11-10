'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOsCompanies } from './CompaniesModule';
import { RELATIONSHIP_LABEL, type OsCompanySummary } from './companyTypes';

/**
 * The company name on a company screen, which is also how you change company: click it (or press the
 * arrows beside it) and the whole screen moves to the one you pick, staying on the same tab.
 */
export default function CompanySwitcher({ current, onSwitch }: { current: { id: string; name: string; color?: string }; onSwitch: (company: OsCompanySummary) => void }) {
    const { companies } = useOsCompanies();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const root = useRef<HTMLDivElement>(null);
    const search = useRef<HTMLInputElement>(null);

    const ordered = useMemo(() => [...(companies ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [companies]);
    const matches = useMemo(() => ordered.filter((c) => `${c.name} ${c.domain ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())), [ordered, query]);
    const index = ordered.findIndex((c) => c.id === current.id);
    const step = (by: number) => { if (ordered.length > 1 && index >= 0) onSwitch(ordered[(index + by + ordered.length) % ordered.length]); };

    useEffect(() => {
        if (!open) return;
        search.current?.focus();
        const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', away);
        return () => document.removeEventListener('mousedown', away);
    }, [open]);

    const choose = (company: OsCompanySummary) => { setOpen(false); setQuery(''); if (company.id !== current.id) onSwitch(company); };
    const several = ordered.length > 1;

    return <div ref={root} className="relative flex items-center gap-1">
        <button type="button" aria-haspopup="listbox" aria-expanded={open} disabled={!several} onClick={() => { setOpen(!open); setActive(Math.max(0, matches.findIndex((c) => c.id === current.id))); }}
            className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 -ml-2 text-left hover:bg-background-card disabled:hover:bg-transparent" title={several ? 'Switch company' : undefined}>
            <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: current.color ?? '#64748b' }} />
            <h2 className="min-w-0 truncate text-lg font-semibold leading-tight">{current.name}</h2>
            {several ? <span aria-hidden className="text-text-secondary">▾</span> : null}
        </button>
        {several ? <>
            <button type="button" className="rounded-md px-1.5 py-1 text-text-secondary hover:bg-background-card hover:text-text-primary" aria-label="Previous company" title={`Previous: ${ordered[(index - 1 + ordered.length) % ordered.length]?.name ?? ''}`} onClick={() => step(-1)}>‹</button>
            <button type="button" className="rounded-md px-1.5 py-1 text-text-secondary hover:bg-background-card hover:text-text-primary" aria-label="Next company" title={`Next: ${ordered[(index + 1) % ordered.length]?.name ?? ''}`} onClick={() => step(1)}>›</button>
        </> : null}
        {open ? <div className="absolute left-0 top-full z-30 mt-1 w-80 max-w-[90vw] rounded-xl border border-border bg-background p-2 shadow-2xl">
            <input ref={search} value={query} placeholder="Find a company…" aria-label="Find a company" className="mb-2 w-full rounded-lg border border-border bg-background-card px-3 py-2 text-sm"
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(matches.length - 1, i + 1)); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
                    else if (e.key === 'Enter' && matches[active]) { e.preventDefault(); choose(matches[active]); }
                    else if (e.key === 'Escape') setOpen(false);
                }} />
            <ul role="listbox" aria-label="Companies" className="max-h-72 overflow-y-auto">
                {matches.map((company, i) => <li key={company.id} role="option" aria-selected={company.id === current.id}>
                    <button type="button" onMouseEnter={() => setActive(i)} onClick={() => choose(company)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${i === active ? 'bg-background-card' : ''}`}>
                        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: company.color ?? '#64748b' }} />
                        <span className="min-w-0 flex-1"><span className="block truncate">{company.name}</span><span className="block truncate text-[11px] text-text-secondary">{[RELATIONSHIP_LABEL[company.relationship], company.domain].filter(Boolean).join(' · ')}</span></span>
                        {company.id === current.id ? <span className="text-xs text-primary">Open</span> : null}
                    </button>
                </li>)}
                {!matches.length ? <li className="px-2 py-3 text-sm text-text-secondary">No company matches.</li> : null}
            </ul>
        </div> : null}
    </div>;
}
