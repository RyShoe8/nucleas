import { describe, expect, it } from 'vitest';
import { templateName } from './templates';

describe('Company Overview template names', () => {
  it.each([
    ['/developers/:item', 'Developer details'],
    ['/mods/:item', 'Mod details'],
    ['/play-with-friends/:item', 'Play with friends details'],
    ['/compare/:item', 'Compare details'],
    ['/collections/:item', 'Collection details'],
    ['/games/:item/editions/:item', 'Game edition details'],
    ['/games/:item/controls', 'Game controls'],
    ['/gear/:item/:item', 'Gear details'],
  ])('derives %s as %s', (route, expected) => {
    expect(templateName([route])).toBe(expected);
  });

  it('uses the property route section instead of a generic landing-page label', () => {
    expect(templateName(['/developers/example', '/developers/another'])).toBe('Developers');
    expect(templateName(['/case-studies/example', '/case-studies/another'])).toBe('Case studies');
  });
});
