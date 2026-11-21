import { expect, it } from 'vitest';
import { proposeWork } from './drafts';
import { workAgreementSchema } from './agreements';
const company = { id: 'c', name: 'Company' };
it('keeps a recurring request as an incomplete proposal until timing is confirmed', () => {
    const draft = proposeWork(company, 'Every week publish our new articles.');
    expect(draft.mode).toBe('repeating'); expect(draft.schedule).toBeUndefined();
    expect(workAgreementSchema.safeParse(draft).success).toBe(false);
});
it('preserves a planning model’s structured cadence and excludes its unknown fields', () => {
    const schedule = { kind: 'weekly' as const, weekdays: [1, 3, 5], time: '09:00', timezone: 'America/Chicago' };
    const draft = proposeWork(company, 'Create useful signature concepts.', { mode: 'repeating', role: 'marketing', schedule, standard: 'Verified company brand and public evidence.' });
    expect(draft.schedule).toEqual(schedule); expect(draft.role).toBe('marketing');
    expect(proposeWork(company, 'Improve every page until each meets our standard.').mode).toBe('ongoing');
});
