import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { AiBudget, AiBudgetReservation, AiRun } from '@/lib/models/AiControl';
import { reserveRunBudget, settleRunBudget } from './budgets';

const runId = new Types.ObjectId(); const budgetId = new Types.ObjectId();
beforeEach(() => {
  vi.spyOn(mongoose, 'startSession').mockResolvedValue({
    withTransaction: async (callback: () => Promise<unknown>) => callback(), endSession: vi.fn(),
  } as unknown as mongoose.ClientSession);
  vi.spyOn(AiRun, 'exists').mockReturnValue({ session: async () => ({ _id: runId }) } as unknown as ReturnType<typeof AiRun.exists>);
  vi.spyOn(AiBudgetReservation, 'findOne').mockReturnValue({ session: async () => null } as unknown as ReturnType<typeof AiBudgetReservation.findOne>);
  vi.spyOn(AiBudgetReservation, 'create').mockResolvedValue([] as never);
});
afterEach(() => vi.restoreAllMocks());
describe('transactional budget repository', () => {
  it('uses an atomic conditional increment, not read-then-write arithmetic', async () => {
    const update = vi.spyOn(AiBudget, 'updateOne').mockResolvedValue({ matchedCount: 1 } as Awaited<ReturnType<typeof AiBudget.updateOne>>);
    await reserveRunBudget('org-a', runId, [budgetId], 25);
    expect(update).toHaveBeenCalledWith({ _id: budgetId, organizationId: 'org-a',
      $expr: { $lte: [{ $add: ['$spentMicros', '$reservedMicros', 25] }, '$limitMicros'] },
    }, { $inc: { reservedMicros: 25 } }, expect.objectContaining({ session: expect.anything() }));
  });
  it('does not create a reservation if the conditional budget update fails', async () => {
    vi.spyOn(AiBudget, 'updateOne').mockResolvedValue({ matchedCount: 0 } as Awaited<ReturnType<typeof AiBudget.updateOne>>);
    vi.spyOn(AiBudget, 'findOne').mockReturnValue({ session: () => ({ lean: async () => ({ limitMicros: 25000000, spentMicros: 5344680, reservedMicros: 19000000 }) }) } as unknown as ReturnType<typeof AiBudget.findOne>);
    await expect(reserveRunBudget('org-a', runId, [budgetId], 25)).rejects.toThrow('AI budget cannot reserve');
    expect(AiBudgetReservation.create).not.toHaveBeenCalled();
  });
  it('rejects missing scopes before opening a transaction', async () => {
    await expect(reserveRunBudget('org-a', runId, [], 25)).rejects.toThrow();
    expect(mongoose.startSession).not.toHaveBeenCalled();
  });
  it('retains reservations when usage is unknown', async () => {
    await settleRunBudget('org-a', runId, null);
    expect(mongoose.startSession).not.toHaveBeenCalled();
  });
  it('no-ops settling zero when the run never reserved budget', async () => {
    vi.spyOn(AiBudgetReservation, 'find').mockReturnValue({
      session: async () => [],
    } as unknown as ReturnType<typeof AiBudgetReservation.find>);
    await expect(settleRunBudget('org-a', runId, 0)).resolves.toBeUndefined();
  });
  it('still requires reservations when settling a positive amount', async () => {
    vi.spyOn(AiBudgetReservation, 'find').mockReturnValue({
      session: async () => [],
    } as unknown as ReturnType<typeof AiBudgetReservation.find>);
    await expect(settleRunBudget('org-a', runId, 25)).rejects.toThrow('Reservation missing');
  });
  it('does not reserve twice for the same run and scope', async () => {
    vi.mocked(AiBudgetReservation.findOne).mockReturnValue({ session: async () => ({ state: 'reserved', amountMicros: 25 }) } as unknown as ReturnType<typeof AiBudgetReservation.findOne>);
    const update = vi.spyOn(AiBudget, 'updateOne');
    await reserveRunBudget('org-a', runId, [budgetId], 25);
    expect(update).not.toHaveBeenCalled(); expect(AiBudgetReservation.create).not.toHaveBeenCalled();
  });
});
