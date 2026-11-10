'use client';

import { useCallback, useEffect, useState } from 'react';
import { dollarsToMicros, microsToDollars } from '@/lib/ai/settingsSchema';

const DEFAULT_ITEM_CAP_MICROS = 2_000_000;
type View = {
    settings: { revision: number; value: { limitMicros: number | null; paused: boolean; itemCapMicros?: number | null } };
    /** The most the platform allows this organization in a month. */
    ceilingMicros: number;
    effectiveLimitMicros: number;
    usage: { period: string; spentMicros: number; reservedMicros: number; remainingMicros: number };
};
const usd = (micros: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(micros / 1_000_000);

/** An organization's two spending limits: its monthly budget, and the cap on any single piece of work. */
export default function AiBudgetsModule() {
    const [view, setView] = useState<View | null>(null);
    const [monthly, setMonthly] = useState('');
    const [item, setItem] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);

    const show = (next: View) => {
        setView(next);
        setMonthly(microsToDollars(next.settings.value.limitMicros ?? next.effectiveLimitMicros));
        setItem(microsToDollars(next.settings.value.itemCapMicros ?? DEFAULT_ITEM_CAP_MICROS));
    };
    const load = useCallback(async () => {
        setError('');
        try {
            const res = await fetch('/api/ai/budgets', { cache: 'no-store' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(res.status === 403 ? 'An organization manager or administrator sets these limits.' : body.error ?? `Unable to load budgets (${res.status}).`);
            show(body as View);
        } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load budgets.'); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!view || busy) return;
        setBusy(true); setError(''); setMessage('');
        try {
            const limitMicros = dollarsToMicros(monthly);
            const itemCapMicros = dollarsToMicros(item);
            if (itemCapMicros <= 0) throw new Error('Set a cap above $0 for a single piece of work.');
            if (itemCapMicros > limitMicros) throw new Error('The cap on a single piece of work cannot be more than the monthly budget.');
            if (limitMicros > view.ceilingMicros) throw new Error(`The most this organization can be given in a month is ${usd(view.ceilingMicros)}.`);
            const res = await fetch('/api/ai/budgets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: view.settings.revision, value: { limitMicros, itemCapMicros, paused: view.settings.value.paused } }) });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error ?? `Unable to save budgets (${res.status}).`);
            show(body as View);
            setMessage('Saved. Work that starts from now uses these limits.');
        } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save budgets.'); }
        finally { setBusy(false); }
    };

    return <div className="h-full overflow-y-auto p-4 space-y-4 text-sm text-text-primary">
        <h2 className="font-semibold">AI budgets</h2>
        <p>Two limits control all of your organization&rsquo;s AI spending. Nothing else sets a budget.</p>
        {error ? <div role="alert" className="space-y-2 text-red-400"><p>{error}</p><button type="button" className="ui-button" disabled={busy} onClick={() => void load()}>Reload budgets</button></div> : null}
        {message ? <p role="status" className="text-emerald-300">{message}</p> : null}
        {!view && !error ? <p>Loading budgets…</p> : null}
        {view ? <>
            <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-text-secondary">Spent in {view.usage.period}</p>
                <p className="text-xl font-semibold tabular-nums">{usd(view.usage.spentMicros)} <span className="text-sm font-normal text-text-secondary">of {usd(view.effectiveLimitMicros)}</span></p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-background-elevated" role="img" aria-label={`${usd(view.usage.spentMicros)} of ${usd(view.effectiveLimitMicros)} spent`}><div className={`h-full ${view.usage.remainingMicros <= 0 ? 'bg-red-400' : 'bg-primary'}`} style={{ width: `${Math.min(100, view.effectiveLimitMicros ? (view.usage.spentMicros / view.effectiveLimitMicros) * 100 : 0)}%` }} /></div>
                <p className="mt-1 text-xs text-text-secondary">{usd(view.usage.remainingMicros)} left{view.usage.reservedMicros ? ` · ${usd(view.usage.reservedMicros)} held for work in progress` : ''}</p>
            </div>
            <form onSubmit={save} className="space-y-4">
                <fieldset disabled={busy} className="space-y-4">
                    <label className="block space-y-1"><span>Monthly budget (USD)</span><span className="block text-xs text-text-secondary">All paid AI work for your organization stops when this is reached, until next month or until you raise it.</span>
                        <input required inputMode="decimal" className="ui-control w-full" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></label>
                    <label className="block space-y-1"><span>Most any single piece of work may spend (USD)</span><span className="block text-xs text-text-secondary">One question, one run, one plan or one code change, including every team member, intern and review inside it. Once reached, no more paid calls start for that piece of work; free models can still finish it.</span>
                        <input required inputMode="decimal" className="ui-control w-full" value={item} onChange={(e) => setItem(e.target.value)} /></label>
                    <p className="text-xs text-text-secondary">Each cost level also has a price ceiling per 1M tokens, set in AI Engine, which decides which models may be chosen.</p>
                    <button type="submit" className="ui-button-primary">{busy ? 'Saving…' : 'Save budgets'}</button>
                </fieldset>
            </form>
        </> : null}
    </div>;
}
