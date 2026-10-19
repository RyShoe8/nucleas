import { expect, it } from 'vitest';
import { isReadOnlyFormLookup } from './adminLookups';

const component = (method = 'getSearchResultsForJs', updates = {}) => ({ updates, calls: [{ method: 'callSchemaComponentMethod', params: ['form.vendor', method, { search: 'Vendor' }] }] });
it('permits choice lookups but refuses saves, updates and mixed calls', () => {
  expect(isReadOnlyFormLookup({ components: [component()] })).toBe(true);
  expect(isReadOnlyFormLookup({ components: [component('getUploadedFiles')] })).toBe(true);
  expect(isReadOnlyFormLookup({ components: [component('save')] })).toBe(false);
  expect(isReadOnlyFormLookup({ components: [component('getOptionsForJs', { 'form.title': 'changed' })] })).toBe(false);
  expect(isReadOnlyFormLookup({ components: [component(), { updates: {}, calls: [{ method: 'create' }] }] })).toBe(false);
  expect(isReadOnlyFormLookup({ components: [] })).toBe(false);
  expect(isReadOnlyFormLookup(null)).toBe(false);
});
