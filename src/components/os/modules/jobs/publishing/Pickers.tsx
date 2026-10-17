'use client';

import { PLATFORM_LABEL, type PublishPlatform } from '@/lib/publishing/config';

export interface ChannelChoice {
    platform: PublishPlatform;
    selected: boolean;
    mode: 'auto' | 'manual';
    canAuto: boolean;
    note: string | null;
}

/** One row per platform: on or off, then Auto (Nucleas posts it) or Manual (a ready-to-post card for the team). */
export function ChannelPicker({ channels, onChange, disabled = false }: { channels: ChannelChoice[]; onChange: (next: ChannelChoice[]) => void; disabled?: boolean }) {
    const set = (platform: PublishPlatform, change: Partial<ChannelChoice>) => onChange(channels.map((c) => (c.platform === platform ? { ...c, ...change } : c)));
    return (
        <ul className="space-y-2">
            {channels.map((c) => (
                <li key={c.platform} className="space-y-1">
                    <div className="flex items-center gap-2">
                        <label className="flex min-w-[96px] items-center gap-2 text-sm">
                            <input type="checkbox" checked={c.selected} disabled={disabled} onChange={(e) => set(c.platform, { selected: e.target.checked })} />
                            {PLATFORM_LABEL[c.platform]}
                        </label>
                        {c.selected ? (
                            <div className="inline-flex overflow-hidden rounded border border-border text-xs" role="radiogroup" aria-label={`${PLATFORM_LABEL[c.platform]} posting`}>
                                {(['auto', 'manual'] as const).map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        role="radio"
                                        aria-checked={c.mode === mode}
                                        disabled={disabled || (mode === 'auto' && !c.canAuto)}
                                        title={mode === 'auto' && !c.canAuto ? c.note ?? undefined : undefined}
                                        onClick={() => set(c.platform, { mode })}
                                        className={`px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${c.mode === mode ? 'bg-primary text-white' : 'hover:bg-background-card'}`}
                                    >
                                        {mode === 'auto' ? 'Auto' : 'Manual'}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    {c.selected && c.note ? <p className="pl-6 text-[11px] text-text-secondary">{c.note}</p> : null}
                </li>
            ))}
        </ul>
    );
}

/** Who is emailed when a post is ready to post by hand or the job needs attention. */
export function NotifyPicker({ people, value, onChange, disabled = false }: { people: { userId: string; name: string }[]; value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
    const chosen = people.filter((p) => value.includes(p.userId));
    const rest = people.filter((p) => !value.includes(p.userId));
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {chosen.map((p) => (
                <span key={p.userId} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                    {p.name}
                    {!disabled ? <button type="button" className="text-text-secondary hover:text-text-primary" aria-label={`Stop notifying ${p.name}`} onClick={() => onChange(value.filter((id) => id !== p.userId))}>×</button> : null}
                </span>
            ))}
            {!chosen.length ? <span className="text-xs text-text-secondary">Nobody</span> : null}
            {!disabled && rest.length ? (
                <select className="ui-control h-7 text-xs" value="" aria-label="Add a person to notify" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
                    <option value="">+ Add</option>
                    {rest.map((p) => (
                        <option key={p.userId} value={p.userId}>{p.name}</option>
                    ))}
                </select>
            ) : null}
        </div>
    );
}
