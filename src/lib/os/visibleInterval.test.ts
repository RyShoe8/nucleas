import { afterEach, expect, it, vi } from 'vitest';
import { visibleInterval } from './visibleInterval';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('stops scheduling while hidden, refreshes once on return, and removes its listener on cleanup', () => {
    vi.useFakeTimers();
    const page = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', page);
    vi.stubGlobal('window', { setInterval, clearInterval });
    const refresh = vi.fn();
    const dispose = visibleInterval(refresh, 1000);
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    page.hidden = true;
    page.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(8 * 60 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    page.hidden = false;
    page.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(3);
    dispose();
    page.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(3);
});
