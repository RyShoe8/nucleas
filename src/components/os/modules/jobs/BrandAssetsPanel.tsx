'use client';

import { useEffect, useRef, useState } from 'react';

interface AssetView { kind: 'logo' | 'icon'; url: string; fileName: string | null; sizeBytes: number }

const SLOTS: { kind: 'logo' | 'icon'; label: string; hint: string }[] = [
    { kind: 'logo', label: 'Logo', hint: 'Your highest quality logo. PNG, JPG or WebP, up to 10 MB. A transparent PNG works best.' },
    { kind: 'icon', label: 'Icon', hint: 'The small square mark, for avatars and tight spaces. PNG, JPG or WebP, up to 10 MB.' },
];

const size = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

/** Marketing → Assets: the company's own logo and icon. Both optional; every image or video job starts from them. */
export default function BrandAssetsPanel({ companyId, companyName }: { companyId: string; companyName: string }) {
    const [assets, setAssets] = useState<AssetView[] | null>(null);
    const [canManage, setCanManage] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/companies/${companyId}/assets`, { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as { assets?: AssetView[]; canManage?: boolean; error?: string };
            if (cancelled) return;
            if (!res.ok) return setError(body.error ?? `Failed (${res.status})`);
            setError(null);
            setAssets(body.assets ?? []);
            setCanManage(Boolean(body.canManage));
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId, reload]);

    const upload = async (kind: 'logo' | 'icon', file: File) => {
        setBusy(kind);
        setError(null);
        const form = new FormData();
        form.set('kind', kind);
        form.set('file', file);
        const res = await fetch(`/api/os/companies/${companyId}/assets`, { method: 'POST', body: form });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setBusy(null);
        if (!res.ok) return setError(body.error ?? `Upload failed (${res.status})`);
        setReload((n) => n + 1);
    };

    const remove = async (kind: 'logo' | 'icon') => {
        if (!window.confirm(`Remove the ${kind}?`)) return;
        setBusy(kind);
        const res = await fetch(`/api/os/companies/${companyId}/assets?kind=${kind}`, { method: 'DELETE' });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setBusy(null);
        setError(res.ok ? null : body.error ?? `Failed (${res.status})`);
        setReload((n) => n + 1);
    };

    if (!assets) return <p className="text-sm text-text-secondary">{error ?? 'Loading…'}</p>;
    return (
        <section className="space-y-3">
            <div>
                <h3 className="text-sm font-semibold">{companyName} assets</h3>
                <p className="text-xs text-text-secondary">Both files are optional. When Nucleas writes a brief or makes an image or video for {companyName}, it starts from these files instead of inventing a look.</p>
            </div>
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
                {SLOTS.map((slot) => {
                    const asset = assets.find((a) => a.kind === slot.kind);
                    return (
                        <div key={slot.kind} className="ui-card space-y-2 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <span className="ui-kicker">{slot.label}</span>
                                {asset ? <span className="min-w-0 truncate text-[11px] text-text-secondary">{asset.fileName ?? 'Uploaded'} · {size(asset.sizeBytes)}</span> : <span className="text-[11px] text-text-secondary">Not added</span>}
                            </div>
                            <div className="flex h-32 items-center justify-center overflow-hidden rounded border border-border bg-[repeating-conic-gradient(rgba(255,255,255,0.06)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
                                {asset ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={asset.url} alt={`${companyName} ${slot.label.toLowerCase()}`} className="max-h-full max-w-full object-contain" />
                                ) : (
                                    <span className="px-3 text-center text-xs text-text-secondary">{slot.hint}</span>
                                )}
                            </div>
                            {canManage ? <SlotButtons label={slot.label} hasAsset={Boolean(asset)} busy={busy === slot.kind} onFile={(file) => void upload(slot.kind, file)} onRemove={() => void remove(slot.kind)} /> : null}
                        </div>
                    );
                })}
            </div>
            {!canManage ? <p className="text-[11px] text-text-secondary">Managers and administrators can change these files.</p> : null}
        </section>
    );
}

function SlotButtons({ label, hasAsset, busy, onFile, onRemove }: { label: string; hasAsset: boolean; busy: boolean; onFile: (file: File) => void; onRemove: () => void }) {
    const input = useRef<HTMLInputElement>(null);
    return (
        <div className="flex gap-2">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label={`${label} file`} onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = ''; }} />
            <button type="button" className="ui-button-primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : hasAsset ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}</button>
            {hasAsset ? <button type="button" className="ui-button" disabled={busy} onClick={onRemove}>Remove</button> : null}
        </div>
    );
}
