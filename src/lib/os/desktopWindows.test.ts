import { describe, expect, it, vi } from 'vitest';
import { desktopPayload, pageLinkToOpen, shareWindowEvents } from './desktopWindows';

describe('window context for the desktop app', () => {
  it('leaves only what the app accepts, so an absent value or long text cannot stop a window opening', () => {
    expect(desktopPayload(undefined)).toBeUndefined();
    expect(desktopPayload({ companyId: 'c1', companyName: undefined, note: null, count: 3, open: true, nested: { a: 1 } })).toEqual({ companyId: 'c1', count: '3', open: 'true' });
    expect(desktopPayload({ watchBrief: 'x'.repeat(5000) })!.watchBrief).toHaveLength(2000);
    expect(Object.keys(desktopPayload(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v'])))!)).toHaveLength(30);
  });
});

describe('links inside a desktop app window', () => {
  const page = 'https://nucleas.app/os/desktop?module=work';

  it('opens full pages in their own window, so the app stays put', () => {
    expect(pageLinkToOpen({ href: '/recordings/abc' }, page)).toBe('https://nucleas.app/recordings/abc');
    expect(pageLinkToOpen({ href: 'https://nucleas.app/assets?projectId=p1', target: '_self' }, page)).toBe('https://nucleas.app/assets?projectId=p1');
  });

  it('leaves everything else alone', () => {
    for (const link of [
      { href: '/api/os/mail/attachments/1/2' },
      { href: '/login' },
      { href: '#section' },
      { href: '/os/desktop?module=work&x=1' },
      { href: 'https://example.com/page' },
      { href: '/recordings/abc', target: '_blank' },
      { href: '/recordings/abc', hasDownload: true },
    ]) expect(pageLinkToOpen(link, page)).toBeNull();
  });
});

describe('sharing refresh events between desktop windows', () => {
  const pair = () => {
    const one = new EventTarget() as unknown as Window;
    const two = new EventTarget() as unknown as Window;
    const name = `test-${Math.random()}`;
    const channelOne = new BroadcastChannel(name);
    const channelTwo = new BroadcastChannel(name);
    return { one, two, stop: [shareWindowEvents(one, channelOne), shareWindowEvents(two, channelTwo)] };
  };

  it('tells the other window once, and never echoes it back', async () => {
    const { one, two, stop } = pair();
    const inOne = vi.fn();
    const inTwo = vi.fn();
    one.addEventListener('nucleas:jobs-changed', inOne);
    two.addEventListener('nucleas:jobs-changed', inTwo);
    one.dispatchEvent(new Event('nucleas:jobs-changed'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(inTwo).toHaveBeenCalledTimes(1);
    expect(inOne).toHaveBeenCalledTimes(1);
    stop.forEach((s) => s());
  });

  it('ignores other events and other messages', async () => {
    const { one, two, stop } = pair();
    const inTwo = vi.fn();
    two.addEventListener('nucleas:unrelated', inTwo);
    one.dispatchEvent(new Event('nucleas:unrelated'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(inTwo).not.toHaveBeenCalled();
    stop.forEach((s) => s());
  });
});
