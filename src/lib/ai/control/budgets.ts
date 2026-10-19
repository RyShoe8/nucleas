import 'server-only';
import { Types, type ClientSession } from 'mongoose';
import { AiBudget, AiBudgetReservation, AiRun } from '@/lib/models/AiControl';
import { assertBudgetReservation } from '@nucleas/ai-core/governance';
import { aiTransaction } from './transaction';

export class BudgetAdmissionError extends Error {
  constructor(message: string) { super(message); this.name = 'BudgetAdmissionError'; }
}

/** Not exposed as an HTTP endpoint. The future dispatcher supplies all required policy scopes. */
export async function reserveRunBudget(organizationId: string, runId: Types.ObjectId, budgetIds: Types.ObjectId[], amountMicros: number, existingSession?: ClientSession) {
  assertBudgetReservation(Number.MAX_SAFE_INTEGER, 0, 0, amountMicros);
  if (!budgetIds.length || new Set(budgetIds.map(String)).size !== budgetIds.length) throw new Error('Budget scopes required.');
  await aiTransaction(async (session) => {
      if (!await AiRun.exists({ _id: runId, organizationId, status: 'queued' }).session(session)) throw new Error('Run unavailable.');
      for (const budgetId of [...budgetIds].sort((a, b) => String(a).localeCompare(String(b)))) {
        const existing = await AiBudgetReservation.findOne({ organizationId, runId, budgetId }).session(session);
        if (existing) {
          if (existing.state !== 'reserved' || existing.amountMicros !== amountMicros) throw new Error('Reservation mismatch.');
          continue;
        }
        const result = await AiBudget.updateOne({ _id: budgetId, organizationId,
          $expr: { $lte: [{ $add: ['$spentMicros', '$reservedMicros', amountMicros] }, '$limitMicros'] },
        }, { $inc: { reservedMicros: amountMicros } }, { session });
        if (result.matchedCount !== 1) {
          const budget = await AiBudget.findOne({ _id: budgetId, organizationId }).session(session).lean();
          const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
          throw new BudgetAdmissionError(budget
            ? `AI budget cannot reserve ${usd(amountMicros)}: ${usd(Math.max(0, budget.limitMicros - budget.spentMicros - budget.reservedMicros))} available, ${usd(budget.spentMicros)} spent and ${usd(budget.reservedMicros)} held for unconfirmed usage, within a ${usd(budget.limitMicros)} monthly limit. Check AI spending and outstanding reservations.`
            : 'AI budget scope is unavailable. Check AI budget settings.');
        }
        await AiBudgetReservation.create([{ organizationId, runId, budgetId, amountMicros }], { session });
      }
  }, existingSession);
}

/** Unknown usage retains reservations for reconciliation; it is never treated as zero. */
export async function settleRunBudget(organizationId: string, runId: Types.ObjectId, actualMicros: number | null, existingSession?: ClientSession) {
  if (actualMicros === null) return;
  assertBudgetReservation(Number.MAX_SAFE_INTEGER, 0, 0, actualMicros);
  await aiTransaction(async (session) => {
      const reservations = await AiBudgetReservation.find({ organizationId, runId }).session(session);
      // Free/local chats often reserve $0 and create no reservation rows; settling 0 is a no-op.
      if (!reservations.length) {
        if (actualMicros === 0) return;
        throw new Error('Reservation missing.');
      }
      for (const reservation of reservations) {
        if (reservation.state === 'settled') {
          if (reservation.actualMicros !== actualMicros) throw new Error('Usage mismatch.');
          continue;
        }
        const result = await AiBudget.updateOne({ _id: reservation.budgetId, organizationId,
          reservedMicros: { $gte: reservation.amountMicros },
        }, { $inc: { reservedMicros: -reservation.amountMicros, spentMicros: actualMicros } }, { session });
        if (result.matchedCount !== 1) throw new Error('Budget ledger inconsistent.');
        reservation.state = 'settled'; reservation.actualMicros = actualMicros;
        await reservation.save({ session });
      }
  }, existingSession);
}
