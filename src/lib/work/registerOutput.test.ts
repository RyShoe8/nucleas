import { expect, it } from 'vitest';
import { workRegisterOutput } from './registerOutput';
it('retains valid JSON and reports omitted work for a large portfolio', () => {
    const result = workRegisterOutput({ scope: 'all companies', jobs: Array.from({ length: 20 }, (_, i) => ({ company: `Company ${i}`, count: 10, jobs: Array.from({ length: 10 }, () => ({ name: 'Long detailed assignment '.repeat(20) })) })), responsibilities: [{ outcome: 'Improve every review' }] });
    expect(result.length).toBeLessThanOrEqual(16_000);
    const body = JSON.parse(result); expect(body.coverage.partial).toBe(true); expect(body.coverage.availableJobs).toBe(200);
    expect(body.jobs).toHaveLength(20); expect(body.coverage.includedJobs).toBeLessThan(200);
});
it('reports the source limit even when the small output fits', () => {
    const body = JSON.parse(workRegisterOutput({ scope: 'Company', jobs: [], responsibilities: [], registerLimitReached: true }));
    expect(body.coverage.partial).toBe(true); expect(body.coverage.registerLimitReached).toBe(true);
});
