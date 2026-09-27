import { clampToViewport, type ViewportBounds } from './clampToViewport';
import type { WindowState } from './types';

/** TopBar height (h-12). */
export const OS_INSET_TOP = 48;

/** WindowsTray height (h-14). */
export const OS_INSET_BOTTOM = 56;

/**
 * Page-relative bounds (pointer clientX/clientY space). Only for detecting a drag that leaves the
 * canvas; window positions are canvas-relative, so use getOsCanvasBounds for those.
 */
export function getOsViewportBounds(): ViewportBounds {
    return {
        width: window.innerWidth,
        height: window.innerHeight,
        insetTop: OS_INSET_TOP,
        insetBottom: OS_INSET_BOTTOM,
    };
}

/**
 * Canvas-relative bounds: window x/y are measured from the top-left of the canvas, which already
 * sits below the top bar and above the tray, so no further insets apply.
 */
export function getOsCanvasBounds(): ViewportBounds {
    return {
        width: window.innerWidth,
        height: Math.max(0, window.innerHeight - OS_INSET_TOP - OS_INSET_BOTTOM),
        insetTop: 0,
        insetBottom: 0,
    };
}

function clampWindowToViewport(window: WindowState, bounds: ViewportBounds): WindowState {
    if (window.maximized) return window;
    const clamped = clampToViewport(
        { x: window.x, y: window.y, width: window.width, height: window.height },
        bounds
    );
    return { ...window, x: clamped.x, y: clamped.y, width: clamped.width, height: clamped.height };
}

export function clampLayoutWindows(windows: WindowState[], bounds: ViewportBounds): WindowState[] {
    return windows.map((w) => clampWindowToViewport(w, bounds));
}

export function payloadsMatch(
    a?: Record<string, string>,
    b?: Record<string, string>
): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => a[key] === b[key]);
}
