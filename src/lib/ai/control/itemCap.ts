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
  const scope = scopes.getStore();
  if (scope && micros && micros > 0) scope.spentMicros += micros;
}

/** The message a paid call gets instead of running, or null while there is room. Worded as a budget refusal so callers stop retrying on paid models. */
export async function itemCapRefusal(organizationId: string): Promise<string | null> {
  const scope = scopes.getStore();
  if (!scope) return null;
  scope.capMicros ??= await readItemCapMicros(organizationId);
  if (scope.spentMicros < scope.capMicros) return null;
  const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
  return `AI budget cannot reserve more for this ${scope.label}: it has spent ${usd(scope.spentMicros)} of the ${usd(scope.capMicros)} your organization allows for any single piece of work. Free models can still finish it; raise the cap in AI budgets to allow more.`;
}

export function itemSpend(): { spentMicros: number; capMicros?: number } | null {
  const scope = scopes.getStore();
  return scope ? { spentMicros: scope.spentMicros, capMicros: scope.capMicros } : null;
}
