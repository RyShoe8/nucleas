import { getOsCanvasBounds, getOsViewportBounds } from './viewportBounds';

const EDGE_THRESHOLD = 24;

/** True when the pointer released outside the OS canvas usable area. */
export function isPointerOutsideOsViewport(clientX: number, clientY: number): boolean {
    const bounds = getOsViewportBounds();
    const insetTop = bounds.insetTop ?? 0;
    const insetBottom = bounds.insetBottom ?? 0;
    const maxY = bounds.height - insetBottom;

    return clientX < 0 || clientX > bounds.width || clientY < insetTop || clientY > maxY;
}

/**
 * True while dragging when the window is near or past the left, right or bottom canvas edge
 * (tear-off hint). The top edge is excluded so windows can be parked flush under the top bar;
 * tearing off upward requires dragging the pointer out of the canvas (isPointerOutsideOsViewport).
 */
export function isNearPopoutEdge(x: number, y: number, width: number, height: number): boolean {
    // Window x/y are canvas-relative.
    const bounds = getOsCanvasBounds();
    const insetBottom = bounds.insetBottom ?? 0;
    const maxX = bounds.width - width;
    const maxY = bounds.height - insetBottom - height;

    return (
        x <= EDGE_THRESHOLD ||
        x >= maxX - EDGE_THRESHOLD ||
        y >= maxY - EDGE_THRESHOLD
    );
}

/** True when a drag release should tear off into a pop-out window. */
export function shouldTriggerTearOffPopout(
    clientX: number,
    clientY: number,
    windowX: number,
    windowY: number,
    width: number,
    height: number,
    wasNearEdge: boolean
): boolean {
    if (isPointerOutsideOsViewport(clientX, clientY)) return true;
    return wasNearEdge && isNearPopoutEdge(windowX, windowY, width, height);
}

/** Map window canvas position to screen coordinates for window.open placement. */
export function windowToScreenPlacement(
    windowX: number,
    windowY: number
): { screenLeft: number; screenTop: number } {
    return {
        screenLeft: window.screenX + windowX,
        screenTop: window.screenY + windowY,
    };
}
/** Map pointer + grab offset to screen coordinates for window.open placement. */
export function pointerToScreenPlacement(
    clientX: number,
    clientY: number,
    grabOffsetX: number,
    grabOffsetY: number
): { screenLeft: number; screenTop: number } {
    return {
        screenLeft: window.screenX + clientX - grabOffsetX,
        screenTop: window.screenY + clientY - grabOffsetY,
    };
}
