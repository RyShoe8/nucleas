import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampToViewport } from './clampToViewport';
import { getOsCanvasBounds, OS_INSET_BOTTOM, OS_INSET_TOP } from './viewportBounds';
import { isNearPopoutEdge, isPointerOutsideOsViewport } from './tearOffPopout';

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 1600, innerHeight: 1000 });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OS window bounds', () => {
  it('lets a window sit flush under the top bar (canvas y = 0)', () => {
    const bounds = getOsCanvasBounds();
    expect(bounds.height).toBe(1000 - OS_INSET_TOP - OS_INSET_BOTTOM);
    expect(clampToViewport({ x: 100, y: -50, width: 600, height: 400 }, bounds).y).toBe(0);
  });

  it('parking at the top edge does not tear off; side and bottom edges still do', () => {
    expect(isNearPopoutEdge(400, 0, 600, 400)).toBe(false);
    expect(isNearPopoutEdge(0, 200, 600, 400)).toBe(true);
    expect(isNearPopoutEdge(1600 - 600, 200, 600, 400)).toBe(true);
    expect(isNearPopoutEdge(400, 1000 - OS_INSET_TOP - OS_INSET_BOTTOM - 400, 600, 400)).toBe(true);
  });

  it('dragging the pointer up into the top bar still counts as leaving the canvas', () => {
    expect(isPointerOutsideOsViewport(500, OS_INSET_TOP - 5)).toBe(true);
    expect(isPointerOutsideOsViewport(500, OS_INSET_TOP + 5)).toBe(false);
  });
});
