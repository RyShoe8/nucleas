import { describe, expect, it } from 'vitest';
import { workAgreementSchema, constrainDesign } from './agreements';
import { jobDesignSchema } from '@/lib/jobs/schema';
const base = { outcome: 'Improve our casino reviews.', standard: 'Primary evidence supports every claim.', role: 'marketing' };
describe('work agreements', () => {
    it('keeps a one-off one-off even when the model invents a recurring publishing job', () => {
        const agreement = workAgreementSchema.parse({ ...base, mode: 'once' });
        const design = jobDesignSchema.parse({ title: 'Review upgrade', category: 'content', instructions: 'Inspect a page and improve its review.', skill: 'social_publish', schedule: { kind: 'daily' }, fields: [{ key: 'draft', label: 'Draft', type: 'long_text' }], delivery: { method: 'integration' } });
        const bounded = constrainDesign(design, agreement);
        expect(bounded.schedule.kind).toBe('once'); expect(bounded.skill).toBeUndefined(); expect(bounded.delivery.method).toBe('nucleas'); expect(bounded.recommendedCompletion).toBe('review');
        expect(bounded.instructions).toContain(base.standard); expect(jobDesignSchema.safeParse(bounded).success).toBe(true);
    });
    it('preserves the agreed repeating schedule and rejects invalid clock/timezone inputs', () => {
        const schedule = { kind: 'weekly', weekdays: [1, 3, 5], time: '09:00', timezone: 'America/Chicago' };
        expect(workAgreementSchema.parse({ ...base, mode: 'repeating', schedule }).schedule).toEqual(schedule);
        expect(workAgreementSchema.safeParse({ ...base, mode: 'repeating', schedule: { ...schedule, time: '29:99' } }).success).toBe(false);
        expect(workAgreementSchema.safeParse({ ...base, mode: 'repeating', schedule: { ...schedule, timezone: 'invented' } }).success).toBe(false);
        expect(workAgreementSchema.safeParse({ ...base, mode: 'repeating' }).success).toBe(false);
    });
    it('blocks inactive testers, non-web targets, and unbounded queues', () => {
        for (const extra of [{ role: 'tester' }, { targets: ['file:///etc/passwd'] }, { maxPending: 11 }]) expect(workAgreementSchema.safeParse({ ...base, mode: 'ongoing', ...extra }).success).toBe(false);
    });
});
