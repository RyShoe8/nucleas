'use client';

import { useSyncExternalStore } from 'react';

/** Phones and narrow windows: the OS shows one full-screen window instead of floating, draggable ones. */
export const NARROW_VIEWPORT_QUERY = '(max-width: 640px)';

function subscribe(onChange: () => void) {
    const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
}

export function useNarrowViewport(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia(NARROW_VIEWPORT_QUERY).matches,
        () => false
    );
}
