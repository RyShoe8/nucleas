import { expect, it, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
const mocks = vi.hoisted(() => ({ profile: vi.fn(), intake: vi.fn(), inventory: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/companies/companyProfile', () => ({ getCompanyProfile: mocks.profile }));
vi.mock('@/lib/casinoDiscovery/intake', () => ({ casinoIntake: mocks.intake }));
import { readWorkInventory } from './inventory';
const viewer = { userId: 'a'.repeat(24), organizationId: new Types.ObjectId(), role: 'Administrator' as const, employeeId: null };
beforeEach(() => { vi.resetAllMocks(); mocks.profile.mockResolvedValue({ domain: 'frugalgambler.club' }); mocks.intake.mockResolvedValue({ origin: 'https://frugalgambler.club', inventory: mocks.inventory }); });
it('reads only scoped canonical catalog entries and deduplicates targets', async () => {
    mocks.inventory.mockResolvedValue({ casinos: [{ name: 'A', slug: 'casino-a', status: 'published' }, { name: 'A copy', slug: 'casino-a', status: 'published' }, { name: 'Escape', slug: '../admin', status: 'published' }] });
    const result = await readWorkInventory(viewer, 'b'.repeat(24));
    expect(result.targets).toEqual([{ key: 'casino:casino-a', name: 'A', url: 'https://frugalgambler.club/casinos/casino-a', status: 'published' }]);
});
it('refuses inaccessible, unsupported and wrong-origin inventories', async () => {
    mocks.profile.mockResolvedValueOnce(null);
    await expect(readWorkInventory(viewer, 'b'.repeat(24))).rejects.toThrow('not found');
    mocks.profile.mockResolvedValueOnce({ domain: 'tailnote.io' });
    await expect(readWorkInventory(viewer, 'b'.repeat(24))).rejects.toThrow('No catalog adapter');
    mocks.intake.mockResolvedValueOnce({ origin: 'https://another.example', inventory: mocks.inventory });
    await expect(readWorkInventory(viewer, 'b'.repeat(24))).rejects.toThrow('belong');
    expect(mocks.inventory).not.toHaveBeenCalled();
});
