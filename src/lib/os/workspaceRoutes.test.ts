import { expect, it } from 'vitest';
import { companySection, workspaceTarget } from './workspaceRoutes';
it('keeps company bookmarks compatible without confusing build IDs with jobs', () => {
    expect(companySection('setup')).toBe('connections'); expect(companySection('performance')).toBe('overview'); expect(companySection('team')).toBe('people');
    expect(workspaceTarget('team', { payload: { companyId: 'c' } })).toEqual({ moduleId: 'company', payload: { companyId: 'c', section: 'people' } });
    const payload = { companyId: 'c', jobId: 'legacy-build', deliveryId: 'd' };
    expect(workspaceTarget('team', { payload })).toEqual({ moduleId: 'team', payload });
});
