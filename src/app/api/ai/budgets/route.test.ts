import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ access: vi.fn(), save: vi.fn(), view: vi.fn() }));
vi.mock('@/lib/ai/control/budgetSettings', () => ({ requireBudgetAccess: mocks.access, saveBudgetSettings: mocks.save, budgetSettingsView: mocks.view }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
import { PUT } from './route';
const request = (value: unknown) => new NextRequest('https://nucleas.test/api/ai/budgets', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 2, value }),
});
beforeEach(() => {
  vi.resetAllMocks(); mocks.access.mockResolvedValue({ userId: 'manager', organizationId: 'org' });
  mocks.view.mockResolvedValue({});
});
describe('budget pause mutation', () => {
  it('requires explicit pause state so an old client cannot silently unpause', async () => {
    expect((await PUT(request({ limitMicros: null }))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('passes explicit pause state and expected revision to the audited save', async () => {
    expect((await PUT(request({ limitMicros: null, paused: true }))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith({ userId: 'manager', organizationId: 'org' }, 2, { limitMicros: null, itemCapMicros: null, paused: true });
  });
});
