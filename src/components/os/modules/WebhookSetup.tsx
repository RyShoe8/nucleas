'use client';

import { useState } from 'react';

/** Generates a company's signed event endpoint and shows the secret once, with a sending snippet. */
export default function WebhookSetup({ connectionId, connected, onDone }: { connectionId: string; connected: boolean; onDone: () => void }) {
    const [result, setResult] = useState<{ url: string; secret: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const generate = async () => {
        if (connected && !window.confirm('Generate a new secret? The current one stops working immediately.')) return;
        setBusy(true);
        setError(null);
        const res = await fetch(`/api/os/connections/${connectionId}/webhook`, { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as { url?: string; secret?: string; error?: string };
        setBusy(false);
        if (!res.ok || !body.url || !body.secret) {
            setError(body.error ?? `Failed (${res.status})`);
            return;
        }
        setResult({ url: body.url, secret: body.secret });
    };

    const snippet = result
        ? `// Call after a user signs up. Keep NUCLEAS_EVENTS_SECRET server-side.
import crypto from 'node:crypto';

export async function reportSignup(userId) {
  const body = JSON.stringify({ type: 'user.signed_up', userId: String(userId) });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'sha256=' + crypto.createHmac('sha256', process.env.NUCLEAS_EVENTS_SECRET).update(ts + '.' + body).digest('hex');
  await fetch('${result.url}', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nucleas-timestamp': ts, 'x-nucleas-signature': sig },
    body,
  });
}`
        : '';

    if (!result) {
        return (
            <span className="inline-flex items-center gap-2">
                <button
                    type="button"
                    onClick={generate}
                    disabled={busy}
                    className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card disabled:opacity-60"
                >
                    {busy ? 'Generating…' : connected ? 'Rotate secret' : 'Set up'}
                </button>
                {error ? <span className="text-[11px] text-red-400">{error}</span> : null}
            </span>
        );
    }

    return (
        <div className="mt-2 w-full rounded border border-amber-400/40 p-2 space-y-2 bg-background-elevated">
            <p className="text-[11px] text-amber-400">Copy the secret now. It is shown only once.</p>
            <label className="block text-[11px] text-text-secondary">
                Endpoint
                <input readOnly value={result.url} onFocus={(e) => e.currentTarget.select()} className="mt-0.5 w-full h-7 px-2 rounded border border-border bg-background text-xs font-mono" />
            </label>
            <label className="block text-[11px] text-text-secondary">
                Secret (store as NUCLEAS_EVENTS_SECRET)
                <input readOnly value={result.secret} onFocus={(e) => e.currentTarget.select()} className="mt-0.5 w-full h-7 px-2 rounded border border-border bg-background text-xs font-mono" />
            </label>
            <details>
                <summary className="text-[11px] text-text-secondary cursor-pointer">Example: send a signup event (Node.js)</summary>
                <pre className="mt-1 text-[10px] leading-snug whitespace-pre-wrap font-mono p-2 rounded bg-background border border-border">{snippet}</pre>
            </details>
            <p className="text-[10px] text-text-secondary">Nucleas stores only a one-way hash of the user id, for counting and de-duplication.</p>
            <button
                type="button"
                onClick={() => {
                    setResult(null);
                    onDone();
                }}
                className="text-[11px] px-2 py-0.5 rounded bg-primary text-white"
            >
                I&apos;ve saved it
            </button>
        </div>
    );
}
