import { describe, expect, it } from 'vitest';
import { observedWindows, renderObservedPage } from './observedPage';

const page = ['Game servers', 'Search', 'Tiberian Dawn', 'OpenRA', 'Editions', 'OpenHV', 'Red Alert', 'Other games', 'OpenHV', 'Halo', 'Owner jane@example.com card 4111 1111 1111 1111', 'Billing', 'a', 'b', 'c', 'Card ending 4242'].join('\n');

describe('observedWindows', () => {
  it('keeps only the lines around the request names, marks matches and drops unrelated data', () => {
    const { windows, matches, missing } = observedWindows(page, ['openhv', 'openra', 'zzz']);
    expect(matches).toBe(3);
    expect(missing).toEqual(['zzz']);
    expect(windows).toContain('> OpenHV');
    expect(windows).toContain('> OpenRA');
    expect(windows).toContain('  Editions');
    expect(windows).not.toContain('4242');
    expect(windows).not.toContain('jane@example.com');
    expect(windows).not.toContain('4111');
    expect(windows).toContain('[email]');
  });

  it('says so when the names are not on the page', () => {
    const r = observedWindows('Login\nWelcome', ['openhv']);
    expect(r.matches).toBe(0);
    expect(renderObservedPage({ url: 'https://x.test/a', title: null, ...r })).toContain('No line on the page mentions openhv');
  });
});
