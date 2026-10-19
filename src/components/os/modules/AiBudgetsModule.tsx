'use client';

import { useCallback, useEffect, useState } from 'react';
import { dollarsToMicros, microsToDollars, type PlatformAiSettings } from '@/lib/ai/settingsSchema';

const fields = [
    ['reservationMicros', 'Hold per paid request'],
    ['organizationLimitMicros', 'Monthly ceiling per organization'],
    ['projectLimitMicros', 'Monthly ceiling per project'],
] as const;
type Snapshot = { revision: number; value: PlatformAiSettings };

/** Uses the existing platform-admin API and revision checks, without navigating away from OS. */
export default function AiBudgetsModule() {
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [amounts, setAmounts] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        setError('');
        try {
            const res = await fetch('/api/admin/ai', { cache: 'no-store' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(res.status === 403 ? 'These shared spending limits require a platform administrator. Organization spending is available in AI Spend.' : body.error ?? `Unable to load budgets (${res.status}).`);
            const next = body.settings as Snapshot;
            setSnapshot(next);
            setAmounts(Object.fromEntries(fields.map(([key]) => [key, microsToDollars(next.value[key])])));
        } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load budgets.'); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!snapshot || busy) return;
        setBusy(true); setError(''); setMessage('');
        try {
            const value = { ...snapshot.value, ...Object.fromEntries(fields.map(([key]) => [key, dollarsToMicros(amounts[key])])) };
            const res = await fetch('/api/admin/ai', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: snapshot.revision, value }) });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error ?? `Unable to save budgets (${res.status}).`);
            setSnapshot(body.settings);
            setMessage('Saved. New requests use these limits. Existing holds are unchanged.');
        } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save budgets.'); }
        finally { setBusy(false); }
    };

    return <div className="h-full overflow-y-auto p-4 space-y-4 text-sm text-text-primary">
        <h2 className="font-semibold">AI budgets</h2>
        <p>These shared limits apply across Nucleas. Individual jobs can have smaller monthly budgets.</p>
        <p className="text-xs text-text-secondary">A reservation is an internal hold, not a provider charge. With a $1 hold and a confirmed $0.04 cost, $0.04 becomes spent and $0.96 is released. If usage cannot be confirmed, the hold stays pending until reconciled. Available budget is the monthly limit minus spending and pending holds.</p>
        {error ? <div role="alert" className="space-y-2 text-red-400"><p>{error}</p><button type="button" className="ui-button" disabled={busy} onClick={() => void load()}>Reload budgets</button></div> : null}
        {message ? <p role="status">{message}</p> : null}
        {!snapshot && !error ? <p>Loading budgets…</p> : null}
        {snapshot ? <form onSubmit={save} className="space-y-4">
            <fieldset disabled={busy} className="space-y-3">
                {fields.map(([key, label]) => <label key={key} className="block space-y-1"><span>{label} (USD)</span><input required inputMode="decimal" className="ui-control w-full" value={amounts[key] ?? ''} onChange={(e) => setAmounts({ ...amounts, [key]: e.target.value })} /></label>)}
                <p className="text-xs text-text-secondary">The hold must fit within the project ceiling, which cannot exceed the organization ceiling. A hold limits admission of concurrent calls; it is not a hard cap on a provider’s final charge.</p>
                <button type="submit" className="ui-button-primary">{busy ? 'Saving…' : 'Save budgets'}</button>
            </fieldset>
        </form> : null}
    </div>;
}
