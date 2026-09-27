'use client';

import { useEffect, useState } from 'react';
import { useWindowManager } from '@/hooks/os/useWindowManager';

type Notice = { kind: 'notice' | 'error'; text: string };

/**
 * Shows the outcome of an OAuth round-trip (?integration_notice / ?integration_error), reopens the
 * company it started from, then strips the params from the URL.
 */
export default function IntegrationNotice() {
    const wm = useWindowManager();
    const [notice, setNotice] = useState<Notice | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const text = params.get('integration_error') ?? params.get('integration_notice');
        const companyId = params.get('company');
        if (!text && !companyId) return;

        if (text) setNotice({ kind: params.has('integration_error') ? 'error' : 'notice', text: text.slice(0, 300) });
        if (companyId && /^[a-f0-9]{24}$/i.test(companyId)) {
            // Open with the real name so the window matches (and is focused, not duplicated) when
            // the same company is later opened from the switcher.
            void fetch(`/api/os/companies/${companyId}`)
                .then((res) => (res.ok ? res.json() : null))
                .then((data: { company?: { name?: string } } | null) => {
                    if (data?.company?.name) wm.open('company', { payload: { companyId, companyName: data.company.name } });
                })
                .catch(() => {});
        }

        for (const key of ['integration_error', 'integration_notice', 'company']) params.delete(key);
        const rest = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
        // Runs once on mount: the params are consumed and removed above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!notice) return null;
    return (
        <div
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`absolute left-1/2 -translate-x-1/2 top-3 z-[9999] max-w-[min(640px,calc(100%-32px))] px-3 py-2 rounded-md border text-sm shadow-2xl flex items-start gap-3 bg-background-elevated ${
                notice.kind === 'error' ? 'border-red-400/50 text-red-300' : 'border-emerald-400/40 text-text-primary'
            }`}
        >
            <span className="flex-1">{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-text-secondary hover:text-text-primary" aria-label="Dismiss">
                ×
            </button>
        </div>
    );
}
