import type { DealMetrics } from './types';

/** "$20 → 26 SC (~30% bonus)": a deal in one readable line, for the feed and for post copy. */
export function formatDealLine(dm: DealMetrics): string {
  const amount = (value: number | undefined, unit: string | undefined) => (value == null ? null : unit === 'USD' ? `$${value}` : `${value}${unit ? ` ${unit}` : ''}`);
  const pay = amount(dm.you_pay, dm.pay_unit);
  const credit = amount(dm.baseline_value, dm.credit_unit);
  const amounts = pay && credit ? `${pay} → ${credit}` : pay ?? credit ?? 'promotional offer';
  if (dm.units_comparable === false && dm.bonus_pct != null) return `${amounts} (~${Math.round(dm.bonus_pct * 100)}% bonus)`;
  const pct = Math.round(Math.max(dm.effective_savings_pct ?? 0, dm.bonus_pct ?? 0) * 100);
  return `${amounts} (~${pct}% deal strength)`;
}

/** Stable key for one deal tier inside an email, so a post is made once per tier. */
export function buildDealKey(dm: DealMetrics): string {
  return `${dm.you_pay ?? ''}-${dm.baseline_value ?? ''}-${(dm.credit_unit ?? '').toLowerCase()}-${dm.mode}`;
}
