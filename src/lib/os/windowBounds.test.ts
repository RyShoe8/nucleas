import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampToViewport } from './clampToViewport';
import { getOsCanvasBounds, OS_INSET_BOTTOM, OS_INSET_TOP } from './viewportBounds';

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
});
