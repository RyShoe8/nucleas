/** Shared shapes for content Watches: scanned emails, deals found in them, and the key points pulled out. */

export type DealMetricsMode = 'retail_list_vs_sale' | 'pay_vs_credited_value' | 'unknown';
export type DealMetricsSource = 'regex' | 'llm' | 'merged' | 'none';

export interface DealMetrics {
  mode: DealMetricsMode;
  you_pay?: number;
  baseline_value?: number;
  pay_unit?: string;
  credit_unit?: string;
  /** False when what is paid and what is credited are in different units (USD vs a token): only the bonus is meaningful. */
  units_comparable: boolean;
  effective_savings_pct: number;
  bonus_pct?: number;
  value_ratio?: number;
  confidence: number;
  source: DealMetricsSource;
}

export const KEY_POINT_CATEGORIES = ['deadline', 'eligibility', 'offer', 'requirement', 'terms', 'other'] as const;
export type KeyPointCategory = (typeof KEY_POINT_CATEGORIES)[number];
export interface KeyPoint {
  category: KeyPointCategory;
  text: string;
}
