import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readBudgetSettings } from './settings';

/**
 * The cap on any single piece of work: one question, one run, one plan, one code change.
 *
 * An organization has two spending limits and only two: its monthly budget, and this. Whatever starts
 * a piece of work opens a scope; every paid model call made inside it, however deep (members, interns,
 * research, review), adds to one running total. Once the total reaches the organization's cap no
 * further paid call starts. Free models are not stopped, so work that can finish on them still does.
 */
export const DEFAULT_ITEM_CAP_MICROS = 2_000_000;

interface Scope {
  label: string;
  /** The organization's cap, read the first time a paid call is about to start. */
  capMicros?: number;
  spentMicros: number;
  costUnknown?: boolean;
  parent?: Scope;
  stopOnUnknown?: boolean;
}
const scopes = new AsyncLocalStorage<Scope>();

/** The organization's own cap, or the default until it sets one. */
export async function readItemCapMicros(organizationId: string): Promise<number> {
  const settings = await readBudgetSettings(organizationId).catch(() => null);
  const cap = settings?.value.itemCapMicros;
  return typeof cap === 'number' && cap > 0 ? cap : DEFAULT_ITEM_CAP_MICROS;
}

/** Runs one piece of work under the cap. Work started inside another piece counts toward the outer one. */
export function withItemCap<T>(label: string, work: () => Promise<T>, capMicros?: number): Promise<T> {
  if (scopes.getStore()) return work();
  return scopes.run({ label, capMicros, spentMicros: 0 }, work);
}

export function recordItemSpend(micros: number | null | undefined): void {
  for (let scope = scopes.getStore(); scope; scope = scope.parent) {
    if (typeof micros === 'number' && Number.isFinite(micros) && micros >= 0) scope.spentMicros += micros;
    else scope.costUnknown = true;
  }
}

/** A durable target's remaining allowance, also charged to any enclosing request. */
export function withItemAllowance<T>(label: string, capMicros: number, work: () => Promise<T>): Promise<T> {
  return scopes.run({ label, capMicros, spentMicros: 0, parent: scopes.getStore(), stopOnUnknown: true }, work);
}
export function itemCostUnknown(): boolean { return scopes.getStore()?.costUnknown === true; }

/** The message a paid call gets instead of running, or null while there is room. Worded as a budget refusal so callers stop retrying on paid models. */
export async function itemCapRefusal(organizationId: string): Promise<string | null> {
  for (let scope = scopes.getStore(); scope; scope = scope.parent) {
    scope.capMicros ??= await readItemCapMicros(organizationId);
    if (scope.stopOnUnknown && scope.costUnknown) return `AI budget cannot reserve more for this ${scope.label}: a paid model did not report its cost. Free models can still finish it; its reservation is retained for reconciliation.`;
    if (scope.spentMicros < scope.capMicros) continue;
    const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
    return `AI budget cannot reserve more for this ${scope.label}: it has spent ${usd(scope.spentMicros)} of the ${usd(scope.capMicros)} allowed for this piece of work. Free models can still finish it; review its allowance and the organization cap before retrying.`;
  }
  return null;
}

export function itemSpend(): { spentMicros: number; capMicros?: number } | null {
  const scope = scopes.getStore();
  return scope ? { spentMicros: scope.spentMicros, capMicros: scope.capMicros } : null;
}
