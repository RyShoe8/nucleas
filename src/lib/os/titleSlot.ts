'use client';

import { useSyncExternalStore } from 'react';

/** Where a desktop app window lets the app put its own control in the title bar. */
export const TITLE_SLOT_ID = 'nucleas-window-title-slot';

const noSubscription = () => () => {};

/** This window's title-bar slot, when the app runs in its own desktop window; otherwise null. */
export function useTitleSlot(windowId: string): HTMLElement | null {
    return useSyncExternalStore(
        noSubscription,
        () => {
            const el = document.getElementById(TITLE_SLOT_ID);
            return el && el.dataset.windowId === windowId ? el : null;
        },
        () => null,
    );
}
