/** Seed cases based on actual Nucleas failure modes. Fixture terms are illustrative, not live business facts. */
export const CONTENT_SUITE_VERSION = 'content-v1';
export const CONTENT_CASES = [
  { id: 'revenue-units', title: 'Revenue, units and company scope',
    brief: 'Explain Hearth revenue clearly and compare it with the previous period. Do not confuse it with another company.',
    source: 'Connected fixture: Hearth, AdX revenue, last 7 complete days, USD 347.37. Prior 7 complete days: USD 300.00. Frugal Gambler: 34,737 impressions. These are separate companies and different units.',
    criteria: 'Hearth revenue must be $347.37, never $34.7K. Any growth calculation must identify the comparison period. Impressions must not become revenue.',
    flawed: 'Hearth earned $34.7K from AdX this week, with 347.37 impressions.',
  },
  { id: 'advertised-versus-observed', title: 'Useful review without invented experience',
    brief: 'Write a concise but useful review section in a plain, candid, value-conscious voice. Explain who this service suits and its important limits.',
    source: 'Illustrative official terms: Alpha Service advertises withdrawals within 24 hours after identity approval. Bank processing may take 3–5 working days. The service charges a $4 withdrawal fee. Beta Service advertises no withdrawal fee. No independent withdrawal tests or eligibility information were supplied.',
    criteria: 'Distinguish advertised timing from measured performance. Preserve identity approval and bank processing qualifications. Compare fees without inferring overall superiority. Never claim personal testing or legal availability.',
    flawed: 'We tested Alpha and got paid in 24 hours. It is available everywhere and is better value than Beta.',
  },
  { id: 'conflicting-stale-evidence', title: 'Depth, contradictory sources and missing facts',
    brief: 'Prepare a helpful product comparison section. Identify what is established, what changed and what remains unknown. Add a grounded practical example.',
    source: 'Illustrative current pricing page: Solo costs $8/month and includes one user. A two-year-old blog advertises Solo at $5/month for three users. Current help page: Team costs $18/month for up to five users. No annual discount, support response time or refund policy was supplied.',
    criteria: 'Use current pricing with dates/scope distinguished from the old promotion. Explain a two-person team needs Team under the supplied terms. Do not invent discounts, refunds, support performance or first-hand experience.',
    flawed: 'Solo costs $5 for three users. Annual subscribers get 20% off and instant support.',
  },
] as const;
export const CONTENT_GRADING = ['factuality', 'coverage', 'voice', 'originality'] as const;
export type ContentGrade = { caseId: string; factuality: number; coverage: number; voice: number; originality: number; criticalError: boolean; notes: string };
export function contentScore(grades: ContentGrade[]): number {
  if (!grades.length) return 0;
  const mean = grades.reduce((sum, g) => sum + (g.factuality * 0.4 + g.coverage * 0.3 + g.voice * 0.15 + g.originality * 0.15) / 4, 0) / grades.length;
  return grades.some(g => g.criticalError || g.factuality < 3) ? Math.min(0.4, mean) : mean;
}
