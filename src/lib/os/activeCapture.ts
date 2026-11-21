'use client';
import { useSyncExternalStore } from 'react';
let owner: string | null = null;
const listeners = new Set<() => void>();
export function setActiveCapture(id: string, active: boolean) {
    const next = active ? id : owner === id ? null : owner;
    if (next === owner) return;
    owner = next;
    for (const listener of listeners) listener();
    void window.nucleasDesktop?.captureState?.(Boolean(owner)).catch(() => {});
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useActiveCapture() { return useSyncExternalStore(subscribe, () => owner, () => null); }
