import { expect, it } from 'vitest';
import { applyAdminFieldRules } from './adminRules';

it('publishes records and opts into site sharing only above the verified threshold', () => {
  const config = { adminFieldRules: [
    { field: 'status', value: 'published' },
    { field: 'facebook', value: true, otherwise: false, whenValueOverPct: 30 },
    { field: 'bluesky', value: true, otherwise: false, whenValueOverPct: 30 },
    { field: 'reddit', value: false },
  ] };
  for (const pct of [undefined, NaN, 29, 30, 30.000000000000004]) {
    expect(applyAdminFieldRules(config, { status: 'draft', facebook: true, bluesky: true }, pct)).toMatchObject({ status: 'published', facebook: false, bluesky: false, reddit: false });
  }
  expect(applyAdminFieldRules(config, {}, 33.42)).toMatchObject({ status: 'published', facebook: true, bluesky: true, reddit: false });
});

it('writes verified percentage points rather than an AI-generated ratio', () => {
  expect(applyAdminFieldRules({ adminValueField: 'value' }, { value: '0.24' }, (18 / 14.49 - 1) * 100).value).toBe('24.22');
  expect(applyAdminFieldRules({ adminValueField: 'value' }, { value: '0.24' }).value).toBeUndefined();
});
