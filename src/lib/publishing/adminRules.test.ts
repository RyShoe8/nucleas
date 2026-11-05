import { expect, it } from 'vitest';
import { applyAdminFieldRules, paidOfferCalledFree, withDealAmounts, withDefaultEndDate } from './adminRules';

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

it('copies the exact original offer link and refuses fabricated or unsafe replacements', () => {
  const config = { adminLinkField: 'offer_url' };
  const url = 'https://offers.example.com/click?offer=123&code=MONDAY';
  expect(applyAdminFieldRules(config, { offer_url: 'https://invented.example' }, undefined, url).offer_url).toBe(url);
  expect(applyAdminFieldRules(config, { offer_url: 'https://invented.example' }, undefined, null).offer_url).toBeUndefined();
  expect(applyAdminFieldRules(config, {}, undefined, 'javascript:alert(1)').offer_url).toBeUndefined();
});

const field = (key: string, label: string, type: 'date' | 'datetime-local' | 'text' = 'date') => ({ key, label, type, selector: `#${key}`, required: false, options: [] }) as never;

it('ends a deal one day after it starts when the source gives no end date', () => {
  const fields = [field('title', 'Title', 'text'), field('start_date', 'Start date'), field('end_date', 'End date*')];
  expect(withDefaultEndDate(fields, { start_date: '2026-10-20' })).toEqual({ start_date: '2026-10-20', end_date: '2026-10-21' });
  // Month and year boundaries.
  expect(withDefaultEndDate(fields, { start_date: '2026-12-31' }).end_date).toBe('2027-01-01');
  expect(withDefaultEndDate(fields, { start_date: '2026-02-28' }).end_date).toBe('2026-03-01');
});

it('keeps an end date the source gave, and does nothing without a start date or an end field', () => {
  const fields = [field('start_date', 'Start date'), field('end_date', 'End date')];
  expect(withDefaultEndDate(fields, { start_date: '2026-10-20', end_date: '2026-10-25' }).end_date).toBe('2026-10-25');
  expect(withDefaultEndDate(fields, {})).toEqual({});
  expect(withDefaultEndDate([field('start_date', 'Start date')], { start_date: '2026-10-20' })).toEqual({ start_date: '2026-10-20' });
  expect(withDefaultEndDate([field('published', 'Published on'), field('expires', 'Expires')], { published: '2026-10-20' })).toEqual({ published: '2026-10-20' });
});

it('keeps the start time on date-time fields', () => {
  const fields = [field('starts_at', 'Starts at', 'datetime-local'), field('ends_at', 'Ends at', 'datetime-local')];
  expect(withDefaultEndDate(fields, { starts_at: '2026-10-20T09:30' }).ends_at).toBe('2026-10-21T09:30');
});

const typed = (key: string, label: string, type: 'number' | 'text') => ({ key, label, type, selector: `#${key}`, required: false, options: [] }) as never;
const dealForm = [typed('title', 'Title', 'text'), typed('slug', 'Slug', 'text'), typed('spend', 'Spend', 'number'), typed('get', 'Get', 'number'), typed('value', 'Value', 'number')];

it('never opts a lesser package into site sharing, whatever its value', () => {
  const config = { adminFieldRules: [{ field: 'status', value: 'published' }, { field: 'facebook', value: true, otherwise: false, whenValueOverPct: 30 }] };
  expect(applyAdminFieldRules(config, {}, 50, null, false)).toMatchObject({ status: 'published', facebook: false });
  expect(applyAdminFieldRules(config, {}, 50, null)).toMatchObject({ status: 'published', facebook: true });
});

it('keeps spend and get on the same package as the value when an email lists several', () => {
  const chosenByModel = { title: 'Winfinite Wednesday', spend: '25', get: '30', value: '26' };
  expect(withDealAmounts(dealForm, chosenByModel, { pay: 50, credit: 63 })).toMatchObject({ spend: '50', get: '63', value: '26' });
});

it('leaves the amounts alone when there is no deal, an amount is unknown, or a field is ambiguous', () => {
  const values = { spend: '25', get: '30' };
  expect(withDealAmounts(dealForm, values)).toEqual(values);
  expect(withDealAmounts(dealForm, values, { pay: 50 })).toEqual({ spend: '50', get: '30' });
  expect(withDealAmounts([typed('title', 'Title', 'text')], { title: 'Spend and get' }, { pay: 50, credit: 63 })).toEqual({ title: 'Spend and get' });
  expect(withDealAmounts([typed('a', 'Price', 'number'), typed('b', 'Cost', 'number')], {}, { pay: 50 })).toEqual({});
});

it('finds a paid offer called free in its title or slug, and nowhere else', () => {
  const values = { title: 'Winfinite Wednesday: 63 SC Free', slug: 'winfinite-wednesday-63-sc-free', notes: 'free text' };
  expect(paidOfferCalledFree(dealForm, values, { pay: 50, credit: 63 })).toEqual(['Title', 'Slug']);
  expect(paidOfferCalledFree(dealForm, values, { credit: 63 })).toEqual([]);
  expect(paidOfferCalledFree(dealForm, values)).toEqual([]);
  expect(paidOfferCalledFree(dealForm, { title: '$50 gets 63 SC', slug: 'freedom-deal' }, { pay: 50 })).toEqual([]);
});
